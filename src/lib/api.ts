import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Agent, Approval, ChatMessage, Deployment, PreviewComment, Project, PullRequest, Task, TeamMember, User, Workspace } from "./db";
import type { BuildPlan } from "./ai";

// All server-only modules (db, seed, agents, ai) are dynamically imported
// inside handler bodies. The TanStack Start compiler replaces .handler() with
// RPC stubs for the client, so these dynamic imports never execute in the browser.
// This keeps node:fs, node:path, and better-sqlite3 out of the client bundle.

async function getCurrentProjectId(): Promise<string> {
  const { ensureSeed, ids } = await import("./seed");
  const { getDb } = await import("./db");
  const a = await import("./agents");
  ensureSeed();
  const d = getDb();
  const demo = d
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(ids.demoProject) as Project | undefined;
  if (demo) return demo.id;
  const row = d
    .prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT 1")
    .get() as Project | undefined;
  if (row) return row.id;
  const id = ids.newProject();
  d.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status) VALUES (?, ?, ?, ?, 'intake')`,
  ).run(id, ids.workspace, "Untitled Project", "Created automatically");
  a.createAgentsForProject(id);
  return id;
}

export const getInitialState = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureSeed } = await import("./seed");
  const { getDb } = await import("./db");
  const { getProject, getAgents, listPullRequests, listRecoveryEvents, listDeployments, getApprovalQueue } = await import("./agents");
  const { isAiAvailable } = await import("./ai");
  const { ids } = await import("./seed");
  ensureSeed();
  const projectId = await getCurrentProjectId();
  const project = getProject(projectId)!;
  const agentsList = getAgents(projectId);
  const d = getDb();
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Task[];
  const prs = listPullRequests(projectId);
  const recovery = listRecoveryEvents(projectId);
  const deployments = listDeployments(projectId);
  const approvals = getApprovalQueue(projectId) as Approval[];
  const teamMembers = d
    .prepare("SELECT * FROM team_members WHERE workspace_id = ?")
    .all(ids.workspace) as TeamMember[];
  const chatMessages = d
    .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as ChatMessage[];
  const user = d.prepare("SELECT * FROM users WHERE id = ?").get(ids.user) as User;
  const workspace = d
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(ids.workspace) as Workspace;
  return {
    user, workspace, project, agents: agentsList, tasks, prs, recovery,
    deployments, approvals, teamMembers, chatMessages, aiAvailable: isAiAvailable(),
  };
});

export const createProject = createServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(1), description: z.string().optional() }))
  .handler(async ({ data }) => {
    const { ensureSeed, ids } = await import("./seed");
    const { getDb } = await import("./db");
    const { createAgentsForProject, getProject } = await import("./agents");
    ensureSeed();
    const d = getDb();
    const id = ids.newProject();
    d.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, status) VALUES (?, ?, ?, ?, 'intake')`,
    ).run(id, ids.workspace, data.name, data.description ?? null);
    createAgentsForProject(id);
    return getProject(id);
  });

export const startProjectIntake = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      projectName: z.string().min(1),
      userType: z.string().min(1),
      firstVersion: z.string().min(1),
      needsLogin: z.boolean(),
      style: z.string().min(1),
      reviewers: z.array(z.string()),
      rawPrompt: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { ensureSeed, ids } = await import("./seed");
    const { getDb } = await import("./db");
    const { createAgentsForProject, createTasksFromPlan, getProject } = await import("./agents");
    const { generateBuildPlan } = await import("./ai");
    ensureSeed();
    const d = getDb();
    const id = await getCurrentProjectId();
    const project = getProject(id)!;
    d.prepare(
      `UPDATE projects SET name = ?, description = ?, status = 'planning' WHERE id = ?`,
    ).run(
      data.projectName || project.name,
      `${data.userType} • ${data.firstVersion} • ${data.style}`,
      id,
    );
    createAgentsForProject(id);
    const prompt = data.rawPrompt ?? `Build a ${data.firstVersion} for ${data.userType}. Style: ${data.style}.`;
    const plan: BuildPlan = await generateBuildPlan(prompt);
    const tasks = createTasksFromPlan(id, plan, data.reviewers[0] ?? "Animesh");
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(
      ids.newMessage(), id,
      `I created a plan for ${data.projectName}. ${plan.summary} ${tasks.length} tasks, all assigned.`,
      JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
    );
    return { project: getProject(id), plan, tasks };
  });

export const sendChat = createServerFn({ method: "POST" })
  .inputValidator(z.object({ message: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { ids } = await import("./seed");
    const { getDb } = await import("./db");
    const { detectSecret, recordSecretBlock, createAgentsForProject, createTasksFromPlan, getAgents, getProject } = await import("./agents");
    const { generateBuildPlan } = await import("./ai");
    const d = getDb();
    const projectId = await getCurrentProjectId();
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, 'user', ?)`,
    ).run(ids.newMessage(), projectId, data.message);

    const secret = detectSecret(data.message);
    if (secret) {
      recordSecretBlock(projectId, null, secret);
      const reply = "Safety Agent blocked this — looks like a hardcoded credential in your message. Use environment variables instead.";
      d.prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(ids.newMessage(), projectId, reply, JSON.stringify({ kind: "secret_block" }));
      return { reply, blocked: true };
    }

    const project = getProject(projectId)!;
    if (project.status === "intake") {
      const plan: BuildPlan = await generateBuildPlan(data.message);
      d.prepare(`UPDATE projects SET name = ?, status = 'planning' WHERE id = ?`).run(plan.suggestedProjectName, projectId);
      createAgentsForProject(projectId);
      const tasks = createTasksFromPlan(projectId, plan, "Animesh");
      const reply = `I created a plan. Review before I start building.\n\n${tasks.length} tasks across ${getAgents(projectId).length} agents.`;
      d.prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(ids.newMessage(), projectId, reply, JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }));
      return { reply, plan, tasks };
    }

    const newTasks = createTasksFromPlan(
      projectId,
      { features: [{ title: data.message.slice(0, 60), description: data.message, ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 3 }] },
      "Animesh",
    );
    const reply = `Got it. Created task "${newTasks[0]?.title}" and assigned the Frontend Agent.`;
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(ids.newMessage(), projectId, reply, JSON.stringify({ kind: "task_created", taskIds: newTasks.map((t) => t.id) }));
    return { reply, tasks: newTasks };
  });

export const runTask = createServerFn({ method: "POST" })
  .inputValidator(z.object({ taskId: z.string(), failureType: z.string().optional() }))
  .handler(async ({ data }) => {
    const { runAgentOnTask } = await import("./agents");
    return runAgentOnTask(data.taskId, data.failureType);
  });

export const runNextTask = createServerFn({ method: "POST" })
  .inputValidator(z.object({ failureType: z.string().optional() }).optional())
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const { runAgentOnTask } = await import("./agents");
    const d = getDb();
    const projectId = await getCurrentProjectId();
    const next = d
      .prepare("SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC LIMIT 1")
      .get(projectId) as Task | undefined;
    if (!next) return { done: true };
    return runAgentOnTask(next.id, data?.failureType);
  });

export const runAllTasks = createServerFn({ method: "POST" })
  .inputValidator(z.object({ failureAt: z.number().int().min(0).max(20).optional(), failureType: z.string().optional() }).optional())
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const { runAgentOnTask } = await import("./agents");
    const d = getDb();
    const projectId = await getCurrentProjectId();
    const backlog = d
      .prepare("SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC")
      .all(projectId) as Task[];
    const results = [];
    for (let i = 0; i < backlog.length; i++) {
      const t = backlog[i];
      const failure = data?.failureAt === i ? data?.failureType ?? "build_failed" : undefined;
      results.push(await runAgentOnTask(t.id, failure));
    }
    return { results };
  });

export const injectFailure = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      type: z.enum(["model_timeout", "build_failed", "secret_detected", "unsafe_db_migration", "deploy_failed", "bad_output", "rate_limit", "agent_conflict"]),
      message: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const { ids } = await import("./seed");
    const { recordSecretBlock, triggerFailure, listRecoveryEvents } = await import("./agents");
    const d = getDb();
    const projectId = await getCurrentProjectId();
    const defaults: Record<string, { msg: string; recovery: string }> = {
      model_timeout: { msg: "Primary model timed out on Frontend Agent", recovery: "Switched to fallback model (claude-haiku-4-5) and continued from saved state" },
      build_failed: { msg: "Build failed on the latest PR — TypeScript error in Form.tsx", recovery: "QA Agent isolated the bad file, Frontend Agent shipped a fix, build re-ran successfully" },
      secret_detected: { msg: "Hardcoded API key found in src/lib/api.ts", recovery: "Safety Agent blocked the PR before merge — secrets never reach production" },
      unsafe_db_migration: { msg: "Backend Agent attempted to drop the users table", recovery: "Required human approval — migration paused until Animesh reviews" },
      deploy_failed: { msg: "Railway deploy timed out after 90s", recovery: "Kept previous live version running, saved failed attempt for review" },
      bad_output: { msg: "Backend Agent returned invalid JSON on the /leads endpoint", recovery: "Regenerated only the failed step — no need to rebuild from scratch" },
      rate_limit: { msg: "Anthropic API rate limit hit during agent run", recovery: "Exponential backoff retry, succeeded on attempt 3" },
      agent_conflict: { msg: "Two agents tried to edit routes/app.tsx simultaneously", recovery: "Created merge conflict review — QA Agent will resolve safely" },
    };
    const d2 = defaults[data.type];
    if (data.type === "secret_detected") {
      recordSecretBlock(projectId, null, "sk-live-EXAMPLE-DETECTED");
      return { event: listRecoveryEvents(projectId)[0] };
    }
    if (data.type === "unsafe_db_migration") {
      const event = await triggerFailure(projectId, null, data.type, d2.msg, d2.recovery);
      d.prepare(
        `INSERT INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at)
         VALUES (?, ?, NULL, ?, 'high', ?, 'pending', ?)`,
      ).run(
        ids.newApproval(), projectId, d2.msg,
        "Backend Agent wants to drop the users table. This would delete all existing users. Approve?",
        Date.now(),
      );
      return { event };
    }
    const event = await triggerFailure(projectId, null, data.type, data.message ?? d2.msg, d2.recovery);
    return { event };
  });

export const decideApprovalFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ approvalId: z.string(), decision: z.enum(["approve", "reject"]), approverName: z.string().default("Animesh") }),
  )
  .handler(async ({ data }) => {
    const { decideApproval } = await import("./agents");
    return decideApproval(data.approvalId, data.decision, data.approverName);
  });

export const approvePrFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prId: z.string(), approverName: z.string().default("Animesh") }))
  .handler(async ({ data }) => {
    const { approvePr } = await import("./agents");
    approvePr(data.prId, data.approverName);
    return { ok: true };
  });

export const deployPr = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prId: z.string().optional(), environment: z.enum(["preview", "staging", "production"]).default("preview") }))
  .handler(async ({ data }) => {
    const { recordDeployment } = await import("./agents");
    const projectId = await getCurrentProjectId();
    const id = recordDeployment(projectId, data.prId ?? null, data.environment, "live", `https://preview-${Math.random().toString(36).slice(2, 8)}.forgecloud.dev`);
    return { deploymentId: id, url: `https://preview-${Math.random().toString(36).slice(2, 8)}.forgecloud.dev` };
  });

export const deployProduction = createServerFn({ method: "POST" })
  .inputValidator(z.object({ fail: z.boolean().optional() }).optional())
  .handler(async ({ data }) => {
    const { recordDeployment } = await import("./agents");
    const projectId = await getCurrentProjectId();
    if (data?.fail) {
      const id = recordDeployment(projectId, null, "production", "failed", undefined, "Railway deploy timed out after 90s");
      return { deploymentId: id, status: "failed", message: "Deploy failed but previous version is still live." };
    }
    const id = recordDeployment(projectId, null, "production", "live", `https://app-${Math.random().toString(36).slice(2, 6)}.railway.app`);
    return { deploymentId: id, status: "live", url: `https://app-${Math.random().toString(36).slice(2, 6)}.railway.app` };
  });

export const resetProject = createServerFn({ method: "POST" }).handler(async () => {
  const { getDb } = await import("./db");
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const tables = ["chat_messages", "approvals", "deployments", "recovery_events", "agent_runs", "changes", "pull_requests", "tasks", "agents"];
  for (const t of tables) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
  d.prepare(`UPDATE projects SET status = 'intake' WHERE id = ?`).run(projectId);
  return { ok: true };
});

export const runFullDemo = createServerFn({ method: "POST" }).handler(async () => {
  const { getDb } = await import("./db");
  const { runAgentOnTask, triggerFailure, recordDeployment } = await import("./agents");
  const projectId = await getCurrentProjectId();
  const d = getDb();
  const backlog = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC")
    .all(projectId) as Task[];
  for (let i = 0; i < backlog.length; i++) {
    const failure = i === 2 ? "build_failed" : undefined;
    await runAgentOnTask(backlog[i].id, failure);
  }
  await triggerFailure(projectId, null, "model_timeout", "Frontend Agent timeout", "Switched to fallback model");
  await triggerFailure(projectId, null, "secret_detected", "Hardcoded API key found", "Safety Agent blocked the PR before merge");
  recordDeployment(projectId, null, "preview", "live", `https://preview-demo.forgecloud.dev`);
  return { ok: true };
});

export const skipToDemo = createServerFn({ method: "POST" }).handler(async () => {
  const { ensureSeed } = await import("./seed");
  ensureSeed();
  return { ok: true };
});

export const getFailureFeed = createServerFn({ method: "GET" }).handler(async () => {
  const { listRecoveryEvents } = await import("./agents");
  return listRecoveryEvents(await getCurrentProjectId());
});

export const getAgentsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getAgents } = await import("./agents");
  return getAgents(await getCurrentProjectId());
});

export const getTasksFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const d = getDb();
  const projectId = await getCurrentProjectId();
  return d.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Task[];
});

export const getPrsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listPullRequests } = await import("./agents");
  return listPullRequests(await getCurrentProjectId());
});

export const getChanges = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const d = getDb();
  const projectId = await getCurrentProjectId();
  return d.prepare(
    `SELECT c.*, pr.title AS pr_title, pr.number AS pr_number, pr.risk_level AS pr_risk
     FROM changes c JOIN pull_requests pr ON pr.id = c.pr_id
     WHERE pr.project_id = ? ORDER BY pr.created_at DESC, c.id ASC`,
  ).all(projectId);
});

export const getApprovals = createServerFn({ method: "GET" }).handler(async () => {
  const { getApprovalQueue } = await import("./agents");
  return getApprovalQueue(await getCurrentProjectId()) as Approval[];
});

export const getChat = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const { ids } = await import("./seed");
  const d = getDb();
  const projectId = await getCurrentProjectId();
  return d.prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as ChatMessage[];
});

export const getTeam = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const { ids } = await import("./seed");
  const d = getDb();
  return d.prepare("SELECT * FROM team_members WHERE workspace_id = ?").all(ids.workspace) as TeamMember[];
});

export const getDeployments = createServerFn({ method: "GET" }).handler(async () => {
  const { listDeployments } = await import("./agents");
  return listDeployments(await getCurrentProjectId()) as Deployment[];
});

export const addPreviewComment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ text: z.string().min(1), selector: z.string().optional() }))
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const { ids } = await import("./seed");
    const d = getDb();
    const projectId = await getCurrentProjectId();
    const id = ids.newComment();
    d.prepare(
      `INSERT INTO preview_comments (id, project_id, pr_id, selector, text, status, created_at) VALUES (?, ?, NULL, ?, ?, 'open', ?)`,
    ).run(id, projectId, data.selector ?? null, data.text, Date.now());
    return d.prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as PreviewComment[];
  });

export const getPreviewComments = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const d = getDb();
  const projectId = await getCurrentProjectId();
  return d.prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as PreviewComment[];
});

export const setAgentStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ agentId: z.string(), status: z.string(), lastAction: z.string().optional() }))
  .handler(async ({ data }) => {
    const { updateAgentStatus } = await import("./agents");
    updateAgentStatus(data.agentId, data.status, data.lastAction);
    return { ok: true };
  });

export const getAgentById = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(data.id) as Agent | undefined;
  });

export const getAgentByTypeFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ type: z.string() }))
  .handler(async ({ data }) => {
    const { getAgentByType } = await import("./agents");
    return getAgentByType(await getCurrentProjectId(), data.type);
  });
