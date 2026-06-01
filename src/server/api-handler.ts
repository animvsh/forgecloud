/**
 * Plain HTTP API handler for ForgeCloud.
 *
 * Replaces the broken `createServerFn` system (Seroval serialization bug in
 * @tanstack/react-start 1.167.50). This module exposes the same business
 * logic as plain HTTP JSON endpoints so the client can call them via fetch().
 *
 * It is bundled by the `build:api` script to `dist/server/api-handler.mjs` and
 * loaded by `server-entry.mjs` for any URL that starts with `/api/`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { ensureSeed, ids } from "../lib/seed";
import { getDb, type Project, type Task, type User, type Workspace } from "../lib/db";
import {
  approvePr,
  createAgentsForProject,
  createTasksFromPlan,
  decideApproval,
  detectSecret,
  getAgents,
  getApprovalQueue,
  getProject,
  listDeployments,
  listPullRequests,
  listRecoveryEvents,
  recordDeployment,
  recordSecretBlock,
  runAgentOnTask,
  triggerFailure,
} from "../lib/agents";
import { generateBuildPlan, isAiAvailable } from "../lib/ai";
import type { BuildPlan } from "../lib/ai";

// ---------- shared helpers ---------------------------------------------------

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function getCurrentProjectId(): Promise<string> {
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
  createAgentsForProject(id);
  return id;
}

// ---------- route handlers ---------------------------------------------------

async function handleGetState(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  ensureSeed();
  const projectId = await getCurrentProjectId();
  const d = getDb();
  const project = getProject(projectId)!;
  const agentsList = getAgents(projectId);
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Task[];
  const prs = listPullRequests(projectId);
  const recovery = listRecoveryEvents(projectId);
  const deployments = listDeployments(projectId);
  const approvals = getApprovalQueue(projectId);
  const teamMembers = d
    .prepare("SELECT * FROM team_members WHERE workspace_id = ?")
    .all(ids.workspace);
  const chatMessages = d
    .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  const user = d.prepare("SELECT * FROM users WHERE id = ?").get(ids.user) as User;
  const workspace = d
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(ids.workspace) as Workspace;
  sendJson(res, 200, {
    user,
    workspace,
    project,
    agents: agentsList,
    tasks,
    prs,
    recovery,
    deployments,
    approvals,
    teamMembers,
    chatMessages,
    aiAvailable: isAiAvailable(),
  });
}

async function handleIntake(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const projectName = String(data.projectName ?? "").trim();
  const userType = String(data.userType ?? "").trim();
  const firstVersion = String(data.firstVersion ?? "").trim();
  const style = String(data.style ?? "").trim();
  if (!projectName || !userType || !firstVersion || !style) {
    return sendError(res, 400, "projectName, userType, firstVersion, style are required");
  }
  const needsLogin = Boolean(data.needsLogin);
  const reviewers: string[] = Array.isArray(data.reviewers) ? data.reviewers : [];
  const rawPrompt: string | undefined =
    typeof data.rawPrompt === "string" ? data.rawPrompt : undefined;

  ensureSeed();
  const projectId = await getCurrentProjectId();
  const project = getProject(projectId)!;
  const d = getDb();
  d.prepare(`UPDATE projects SET name = ?, description = ?, status = 'planning' WHERE id = ?`).run(
    projectName || project.name,
    `${userType} • ${firstVersion} • ${style}`,
    projectId,
  );
  createAgentsForProject(projectId);
  const prompt = rawPrompt ?? `Build a ${firstVersion} for ${userType}. Style: ${style}.`;
  const plan: BuildPlan = await generateBuildPlan(prompt);
  const tasks = createTasksFromPlan(projectId, plan, reviewers[0] ?? "Animesh");
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(
    ids.newMessage(),
    projectId,
    `I created a plan for ${projectName}. ${plan.summary} ${tasks.length} tasks, all assigned.`,
    JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
  );
  sendJson(res, 200, { project: getProject(projectId), plan, tasks });
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const message = String(data.message ?? "").trim();
  if (!message) return sendError(res, 400, "message is required");

  const d = getDb();
  const projectId = await getCurrentProjectId();
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, 'user', ?)`,
  ).run(ids.newMessage(), projectId, message);

  const secret = detectSecret(message);
  if (secret) {
    recordSecretBlock(projectId, null, secret);
    const reply =
      "Safety Agent blocked this — looks like a hardcoded credential in your message. Use environment variables instead.";
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(ids.newMessage(), projectId, reply, JSON.stringify({ kind: "secret_block" }));
    return sendJson(res, 200, { reply, blocked: true });
  }

  const project = getProject(projectId)!;
  if (project.status === "intake") {
    const plan: BuildPlan = await generateBuildPlan(message);
    d.prepare(`UPDATE projects SET name = ?, status = 'planning' WHERE id = ?`).run(
      plan.suggestedProjectName,
      projectId,
    );
    createAgentsForProject(projectId);
    const tasks = createTasksFromPlan(projectId, plan, "Animesh");
    const reply = `I created a plan. Review before I start building.\n\n${tasks.length} tasks across ${getAgents(projectId).length} agents.`;
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(
      ids.newMessage(),
      projectId,
      reply,
      JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
    );
    return sendJson(res, 200, { reply, plan, tasks });
  }

  const newTasks = createTasksFromPlan(
    projectId,
    {
      features: [
        {
          title: message.slice(0, 60),
          description: message,
          ownerAgent: "Frontend Agent",
          riskLevel: "low",
          estimatedFiles: 3,
        },
      ],
    },
    "Animesh",
  );
  const reply = `Got it. Created task "${newTasks[0]?.title}" and assigned the Frontend Agent.`;
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(
    ids.newMessage(),
    projectId,
    reply,
    JSON.stringify({ kind: "task_created", taskIds: newTasks.map((t) => t.id) }),
  );
  sendJson(res, 200, { reply, tasks: newTasks });
}

async function handleRunTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const taskId = String(data.taskId ?? "").trim();
  if (!taskId) return sendError(res, 400, "taskId is required");
  const failureType = data.failureType ? String(data.failureType) : undefined;
  const result = await runAgentOnTask(taskId, failureType);
  sendJson(res, 200, result);
}

async function handleRunAll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const failureAt = typeof data.failureAt === "number" ? data.failureAt : undefined;
  const failureType = data.failureType ? String(data.failureType) : undefined;
  const projectId = await getCurrentProjectId();
  const d = getDb();
  const backlog = d
    .prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC",
    )
    .all(projectId) as Task[];
  const results = [];
  for (let i = 0; i < backlog.length; i++) {
    const t = backlog[i];
    const failure = failureAt === i ? failureType ?? "build_failed" : undefined;
    results.push(await runAgentOnTask(t.id, failure));
  }
  sendJson(res, 200, { results });
}

async function handleRunFullDemo(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  const d = getDb();
  const backlog = d
    .prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC",
    )
    .all(projectId) as Task[];
  for (let i = 0; i < backlog.length; i++) {
    const failure = i === 2 ? "build_failed" : undefined;
    await runAgentOnTask(backlog[i].id, failure);
  }
  await triggerFailure(projectId, null, "model_timeout", "Frontend Agent timeout", "Switched to fallback model");
  await triggerFailure(
    projectId,
    null,
    "secret_detected",
    "Hardcoded API key found",
    "Safety Agent blocked the PR before merge",
  );
  recordDeployment(projectId, null, "preview", "live", `https://preview-demo.forgecloud.dev`);
  sendJson(res, 200, { ok: true });
}

async function handleSkipToDemo(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  ensureSeed();
  sendJson(res, 200, { ok: true });
}

async function handleInjectFailure(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const type = String(data.type ?? "").trim();
  const message = data.message ? String(data.message) : undefined;
  const projectId = await getCurrentProjectId();
  const d = getDb();

  const defaults: Record<string, { msg: string; recovery: string }> = {
    model_timeout: {
      msg: "Primary model timed out on Frontend Agent",
      recovery: "Switched to fallback model (claude-haiku-4-5) and continued from saved state",
    },
    build_failed: {
      msg: "Build failed on the latest PR — TypeScript error in Form.tsx",
      recovery:
        "QA Agent isolated the bad file, Frontend Agent shipped a fix, build re-ran successfully",
    },
    secret_detected: {
      msg: "Hardcoded API key found in src/lib/api.ts",
      recovery: "Safety Agent blocked the PR before merge — secrets never reach production",
    },
    unsafe_db_migration: {
      msg: "Backend Agent attempted to drop the users table",
      recovery: "Required human approval — migration paused until Animesh reviews",
    },
    deploy_failed: {
      msg: "Railway deploy timed out after 90s",
      recovery: "Kept previous live version running, saved failed attempt for review",
    },
    bad_output: {
      msg: "Backend Agent returned invalid JSON on the /leads endpoint",
      recovery: "Regenerated only the failed step — no need to rebuild from scratch",
    },
    rate_limit: {
      msg: "Anthropic API rate limit hit during agent run",
      recovery: "Exponential backoff retry, succeeded on attempt 3",
    },
    agent_conflict: {
      msg: "Two agents tried to edit routes/app.tsx simultaneously",
      recovery: "Created merge conflict review — QA Agent will resolve safely",
    },
  };
  const d2 = defaults[type];
  if (!d2) return sendError(res, 400, `unknown failure type: ${type}`);

  if (type === "secret_detected") {
    recordSecretBlock(projectId, null, "sk-live-EXAMPLE-DETECTED");
    return sendJson(res, 200, { event: listRecoveryEvents(projectId)[0] });
  }
  if (type === "unsafe_db_migration") {
    const event = await triggerFailure(projectId, null, type, d2.msg, d2.recovery);
    d.prepare(
      `INSERT INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at)
       VALUES (?, ?, NULL, ?, 'high', ?, 'pending', ?)`,
    ).run(
      ids.newApproval(),
      projectId,
      d2.msg,
      "Backend Agent wants to drop the users table. This would delete all existing users. Approve?",
      Date.now(),
    );
    return sendJson(res, 200, { event });
  }
  const event = await triggerFailure(projectId, null, type, message ?? d2.msg, d2.recovery);
  sendJson(res, 200, { event });
}

async function handleApproval(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const approvalId = String(data.approvalId ?? "").trim();
  const decision = data.decision === "approve" || data.decision === "reject" ? data.decision : null;
  if (!approvalId || !decision) return sendError(res, 400, "approvalId and decision required");
  const approverName = data.approverName ? String(data.approverName) : "Animesh";
  const result = decideApproval(approvalId, decision, approverName);
  sendJson(res, 200, result);
}

async function handleApprovePr(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const prId = String(data.prId ?? "").trim();
  if (!prId) return sendError(res, 400, "prId is required");
  const approverName = data.approverName ? String(data.approverName) : "Animesh";
  approvePr(prId, approverName);
  sendJson(res, 200, { ok: true });
}

async function handleDeploy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const prId = data.prId ? String(data.prId) : null;
  const environment = (data.environment ?? "preview") as "preview" | "staging" | "production";
  const projectId = await getCurrentProjectId();
  const url = `https://preview-${Math.random().toString(36).slice(2, 8)}.forgecloud.dev`;
  const id = recordDeployment(projectId, prId, environment, "live", url);
  sendJson(res, 200, { deploymentId: id, url });
}

async function handleDeployProduction(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const fail = Boolean(data.fail);
  const projectId = await getCurrentProjectId();
  if (fail) {
    const id = recordDeployment(
      projectId,
      null,
      "production",
      "failed",
      undefined,
      "Railway deploy timed out after 90s",
    );
    return sendJson(res, 200, {
      deploymentId: id,
      status: "failed",
      message: "Deploy failed but previous version is still live.",
    });
  }
  const id = recordDeployment(
    projectId,
    null,
    "production",
    "live",
    `https://app-${Math.random().toString(36).slice(2, 6)}.railway.app`,
  );
  sendJson(res, 200, {
    deploymentId: id,
    status: "live",
    url: `https://app-${Math.random().toString(36).slice(2, 6)}.railway.app`,
  });
}

async function handleReset(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const tables = [
    "chat_messages",
    "approvals",
    "deployments",
    "recovery_events",
    "agent_runs",
    "changes",
    "pull_requests",
    "tasks",
    "agents",
  ];
  for (const t of tables) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
  d.prepare(`UPDATE projects SET status = 'intake' WHERE id = ?`).run(projectId);
  sendJson(res, 200, { ok: true });
}

async function handleComment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const data = await readJsonBody(req);
  const text = String(data.text ?? "").trim();
  if (!text) return sendError(res, 400, "text is required");
  const selector = data.selector ? String(data.selector) : null;
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const id = ids.newComment();
  d.prepare(
    `INSERT INTO preview_comments (id, project_id, pr_id, selector, text, status, created_at) VALUES (?, ?, NULL, ?, ?, 'open', ?)`,
  ).run(id, projectId, selector, text, Date.now());
  const rows = d
    .prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  sendJson(res, 200, rows);
}

// ---------- simple GET helpers ----------------------------------------------

async function handleGetTasks(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  sendJson(res, 200, tasks);
}

async function handleGetPrs(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listPullRequests(projectId));
}

async function handleGetAgents(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, getAgents(projectId));
}

async function handleGetFailures(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listRecoveryEvents(projectId));
}

async function handleGetApprovals(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, getApprovalQueue(projectId));
}

async function handleGetTeam(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const d = getDb();
  sendJson(res, 200, d.prepare("SELECT * FROM team_members WHERE workspace_id = ?").all(ids.workspace));
}

async function handleGetChat(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const rows = d
    .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  sendJson(res, 200, rows);
}

async function handleGetDeployments(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listDeployments(projectId));
}

// ---------- router ----------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const ROUTES: Array<{ method: string; pattern: RegExp; handler: RouteHandler }> = [
  // GET
  { method: "GET", pattern: /^\/api\/state$/, handler: handleGetState },
  { method: "GET", pattern: /^\/api\/tasks$/, handler: handleGetTasks },
  { method: "GET", pattern: /^\/api\/prs$/, handler: handleGetPrs },
  { method: "GET", pattern: /^\/api\/agents$/, handler: handleGetAgents },
  { method: "GET", pattern: /^\/api\/failures$/, handler: handleGetFailures },
  { method: "GET", pattern: /^\/api\/approvals$/, handler: handleGetApprovals },
  { method: "GET", pattern: /^\/api\/team$/, handler: handleGetTeam },
  { method: "GET", pattern: /^\/api\/chat$/, handler: handleGetChat },
  { method: "GET", pattern: /^\/api\/deployments$/, handler: handleGetDeployments },
  // POST
  { method: "POST", pattern: /^\/api\/intake$/, handler: handleIntake },
  { method: "POST", pattern: /^\/api\/chat$/, handler: handleChat },
  { method: "POST", pattern: /^\/api\/run-task$/, handler: handleRunTask },
  { method: "POST", pattern: /^\/api\/run-all$/, handler: handleRunAll },
  { method: "POST", pattern: /^\/api\/run-full-demo$/, handler: handleRunFullDemo },
  { method: "POST", pattern: /^\/api\/skip-to-demo$/, handler: handleSkipToDemo },
  { method: "POST", pattern: /^\/api\/inject-failure$/, handler: handleInjectFailure },
  { method: "POST", pattern: /^\/api\/approval$/, handler: handleApproval },
  { method: "POST", pattern: /^\/api\/approve-pr$/, handler: handleApprovePr },
  { method: "POST", pattern: /^\/api\/deploy$/, handler: handleDeploy },
  { method: "POST", pattern: /^\/api\/deploy-production$/, handler: handleDeployProduction },
  { method: "POST", pattern: /^\/api\/reset$/, handler: handleReset },
  { method: "POST", pattern: /^\/api\/comment$/, handler: handleComment },
];

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;
  const pathname = url.split("?")[0];
  for (const route of ROUTES) {
    if (req.method === route.method && route.pattern.test(pathname)) {
      try {
        await route.handler(req, res);
      } catch (err) {
        console.error(`[api] ${route.method} ${pathname} failed:`, err);
        if (!res.headersSent) sendError(res, 500, (err as Error)?.message ?? "internal error");
        else res.end();
      }
      return true;
    }
  }
  sendError(res, 404, `no route for ${req.method} ${pathname}`);
  return true;
}
