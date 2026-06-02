/**
 * Plain HTTP API handler for ForgeCloud.
 *
 * Replaces the broken `createServerFn` system (Seroval serialization bug in
 * @tanstack/react-start 1.167.50). Each endpoint is a plain JSON HTTP route.
 *
 * Bundled by `npm run build:api` to `dist/server/api-handler.mjs` and loaded by
 * `server-entry.mjs` for any URL that starts with `/api/`.
 *
 * Middleware applied in order: request ID + log → rate limit → Zod validation
 * → handler → log completion.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { ensureSeed, ids, seedDemoProject } from "../lib/seed";
import { getDb, type Change, type Project, type Task, type User, type Workspace } from "../lib/db";
import {
  approvePr,
  createAgentsForProject,
  createTasksFromPlan,
  decideApproval,
  detectSecret,
  detectGuardrailViolation,
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
import {
  activeProviderName,
  commentToTask,
  explainRiskyChange,
  generateBuildPlan,
  isAiAvailable,
} from "../lib/ai";
import type { BuildPlan } from "../lib/ai";
import { log, newRequestId } from "../lib/logger";
import { clientKey, consume, RATE_CONFIGS, type RateLimitConfig } from "../lib/rate-limit";
import {
  archiveBranch,
  createNotification,
  listBranches,
  listCommits,
  listNotifications,
  listWorktrees,
  markAllRead,
  markNotificationRead,
  mergeBranch,
  recordCommit,
  spawnWorktree,
  unreadCount,
} from "../lib/vcs";
import { getProvider } from "../lib/providers";

const SERVER_STARTED_AT = Date.now();
const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";
const DEMO_PROJECT_ID = "proj-pleasure-pizza";

// ---------- shared helpers ---------------------------------------------------

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

function sendJson(res: ServerResponse, status: number, body: unknown, requestId?: string): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(json)),
    "cache-control": "no-store",
  };
  if (requestId) headers["x-request-id"] = requestId;
  res.writeHead(status, headers);
  res.end(json);
}

function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  requestId?: string,
  extra?: Record<string, unknown>,
): void {
  sendJson(res, status, { error: message, ...(extra ?? {}) }, requestId);
}

async function getCurrentProjectId(): Promise<string> {
  ensureSeed();
  const d = getDb();
  const demo = d.prepare("SELECT * FROM projects WHERE id = ?").get(ids.demoProject) as
    | Project
    | undefined;
  if (demo) return demo.id;
  const row = d.prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT 1").get() as
    | Project
    | undefined;
  if (row) return row.id;
  const id = ids.newProject();
  d.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status) VALUES (?, ?, ?, ?, 'intake')`,
  ).run(id, ids.workspace, "Untitled Project", "Created automatically");
  createAgentsForProject(id);
  return id;
}

// Compute risk-check matrix for a PR from recovery_events + approvals.
type RiskCheckResult = "pass" | "fail" | "pending" | "n/a";
function computeRiskChecks(prId: string): {
  build: RiskCheckResult;
  qa: RiskCheckResult;
  secretScan: RiskCheckResult;
  migration: RiskCheckResult;
} {
  const d = getDb();
  const pr = d.prepare("SELECT * FROM pull_requests WHERE id = ?").get(prId) as
    | {
        project_id: string;
        task_id: string | null;
        risk_level: string;
        requires_approval: number;
        status: string;
      }
    | undefined;
  if (!pr) return { build: "n/a", qa: "n/a", secretScan: "n/a", migration: "n/a" };

  const isBlocked = pr.status === "blocked";
  const isRolledBack = pr.status === "rolled_back";

  const pendingApproval = d
    .prepare("SELECT * FROM approvals WHERE pr_id = ? AND status = 'pending'")
    .get(prId) as { id: string } | undefined;
  const approvedThisPr = pr.status === "approved";

  const task = pr.task_id
    ? (d.prepare("SELECT title, description FROM tasks WHERE id = ?").get(pr.task_id) as
        | { title?: string; description?: string }
        | undefined)
    : undefined;
  const taskText = `${task?.title ?? ""} ${task?.description ?? ""}`;
  // Strict DB-impact detection: needs a clear signal, not just the word "table".
  const touchesDb =
    /database|schema migration|db migration|add(?:ing)? \w+ column|drop \w+ table|alter table|migration|rls policy/i.test(
      taskText,
    );
  const isHighRisk = pr.risk_level === "high" || touchesDb;

  return {
    build: isBlocked || isRolledBack ? "fail" : "pass",
    qa: isBlocked ? "fail" : "pass",
    // Per-PR scan: only the actually-blocked PR fails the scan.
    secretScan: isBlocked ? "fail" : "pass",
    migration: isHighRisk
      ? approvedThisPr
        ? "pass"
        : pendingApproval
          ? "pending"
          : "pending"
      : "n/a",
  };
}

// ---------- route handlers ---------------------------------------------------

async function handleGetHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  let dbOk = false;
  try {
    d.prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  sendJson(
    res,
    dbOk ? 200 : 503,
    {
      ok: dbOk,
      db: dbOk ? "up" : "down",
      provider: activeProviderName(),
      aiAvailable: isAiAvailable(),
      uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      version: APP_VERSION,
      time: new Date().toISOString(),
    },
    requestId,
  );
}

async function handleGetState(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
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

  // Per-PR changes + risk checks (enriches PRs for the Changes screen).
  const prsEnriched = prs.map((p) => {
    const changes = d
      .prepare("SELECT * FROM changes WHERE pr_id = ? ORDER BY id ASC")
      .all(p.id) as Change[];
    return { ...p, changes, riskChecks: computeRiskChecks(p.id) };
  });

  const previewComments = d
    .prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);

  // New vibecoding primitives.
  const connections = d
    .prepare("SELECT * FROM connections WHERE workspace_id = ? ORDER BY status DESC, created_at ASC")
    .all(ids.workspace);
  const discoveries = d
    .prepare(
      "SELECT * FROM discoveries WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at ASC",
    )
    .all(ids.workspace, projectId);
  const suggestedApps = d
    .prepare(
      "SELECT * FROM suggested_apps WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at ASC",
    )
    .all(ids.workspace, projectId);
  const branches = listBranches(projectId);
  const commits = listCommits(projectId);
  const worktrees = listWorktrees(projectId);
  const notifications = listNotifications(ids.workspace, 30);
  const notificationsUnread = unreadCount(ids.workspace);
  const allProjects = d
    .prepare(
      "SELECT id, name, description, status, created_at FROM projects WHERE workspace_id = ? ORDER BY created_at DESC",
    )
    .all(ids.workspace);

  sendJson(
    res,
    200,
    {
      user,
      workspace,
      project,
      projects: allProjects,
      agents: agentsList,
      tasks,
      prs: prsEnriched,
      recovery,
      deployments,
      approvals,
      teamMembers,
      chatMessages,
      previewComments,
      connections,
      discoveries,
      suggestedApps,
      branches,
      commits,
      worktrees,
      notifications,
      notificationsUnread,
      aiAvailable: isAiAvailable(),
      providerName: activeProviderName(),
      serverVersion: APP_VERSION,
    },
    requestId,
  );
}

const IntakeSchema = z.object({
  projectName: z.string().min(1).max(120),
  userType: z.string().min(1).max(200),
  firstVersion: z.string().min(1).max(500),
  style: z.string().min(1).max(200),
  needsLogin: z.boolean().optional(),
  reviewers: z.array(z.string().min(1).max(60)).max(20).optional(),
  rawPrompt: z.string().max(2000).optional(),
});

async function handleIntake(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = IntakeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid intake payload", requestId, {
      issues: parsed.error.issues,
    });
  const data = parsed.data;

  ensureSeed();
  const projectId = await getCurrentProjectId();
  const project = getProject(projectId)!;
  const d = getDb();
  d.prepare(`UPDATE projects SET name = ?, description = ?, status = 'planning' WHERE id = ?`).run(
    data.projectName || project.name,
    `${data.userType} • ${data.firstVersion} • ${data.style}`,
    projectId,
  );
  createAgentsForProject(projectId);
  const prompt =
    data.rawPrompt ?? `Build a ${data.firstVersion} for ${data.userType}. Style: ${data.style}.`;
  const plan: BuildPlan = await generateBuildPlan(prompt);
  const tasks = createTasksFromPlan(projectId, plan, data.reviewers ?? ["Animesh"]);
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(
    ids.newMessage(),
    projectId,
    `I created a plan for ${data.projectName}. ${plan.summary} ${tasks.length} tasks, all assigned.`,
    JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
  );
  sendJson(res, 200, { project: getProject(projectId), plan, tasks }, requestId);
}

const ChatSchema = z.object({ message: z.string().min(1).max(4000) });

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = ChatSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid chat payload", requestId, { issues: parsed.error.issues });
  const { message } = parsed.data;

  const d = getDb();
  const projectId = await getCurrentProjectId();
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, 'user', ?)`,
  ).run(ids.newMessage(), projectId, message);

  const hit = detectGuardrailViolation(message);
  if (hit) {
    // Map the broader guardrail rules onto the existing recovery_events model.
    if (hit.kind === "secret") {
      recordSecretBlock(projectId, null, hit.match);
    } else {
      const dDb = getDb();
      dDb.prepare(
        `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
         VALUES (?, ?, NULL, 'guardrail_blocked', ?, 'Safety Agent blocked this — flagged as dangerous before any agent ran it.', 'blocked', ?)`,
      ).run(ids.newRecovery(), projectId, `${hit.title}: matched "${hit.match.slice(0, 60)}"`, Date.now());
      // Notify the workspace bell too.
      const wsRow = dDb
        .prepare("SELECT workspace_id FROM projects WHERE id = ?")
        .get(projectId) as { workspace_id: string } | undefined;
      if (wsRow) {
        const { createNotification } = await import("../lib/vcs");
        createNotification({
          workspaceId: wsRow.workspace_id,
          projectId,
          kind: "secret_blocked",
          title: `Safety Agent blocked: ${hit.title}`,
          body: `Matched "${hit.match.slice(0, 80)}". Edit your request and try again.`,
          link: "/app/failures",
        });
      }
    }
    const reply =
      hit.kind === "secret"
        ? "Safety Agent blocked this — looks like a hardcoded credential in your message. Use environment variables instead."
        : `Safety Agent blocked this — it looked like: ${hit.title}. Rewrite your request without that pattern.`;
    d.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(
      ids.newMessage(),
      projectId,
      reply,
      JSON.stringify({ kind: hit.kind === "secret" ? "secret_block" : "guardrail_block", rule: hit.kind, title: hit.title }),
    );
    return sendJson(res, 200, { reply, blocked: true, rule: hit }, requestId);
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
    return sendJson(res, 200, { reply, plan, tasks }, requestId);
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
  sendJson(res, 200, { reply, tasks: newTasks }, requestId);
}

const RunTaskSchema = z.object({
  taskId: z.string().min(1),
  failureType: z.string().min(1).optional(),
});

async function handleRunTask(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = RunTaskSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid run-task payload", requestId, {
      issues: parsed.error.issues,
    });
  const result = await runAgentOnTask(parsed.data.taskId, parsed.data.failureType);
  sendJson(res, 200, result, requestId);
}

const RunAllSchema = z.object({
  failureAt: z.number().int().nonnegative().optional(),
  failureType: z.string().min(1).optional(),
});

async function handleRunAll(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = RunAllSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid run-all payload", requestId, {
      issues: parsed.error.issues,
    });
  const { failureAt, failureType } = parsed.data;
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
    const failure = failureAt === i ? (failureType ?? "build_failed") : undefined;
    results.push(await runAgentOnTask(t.id, failure));
  }
  sendJson(res, 200, { results }, requestId);
}

async function handleRunFullDemo(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
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
  await triggerFailure(
    projectId,
    null,
    "model_timeout",
    "Frontend Agent timeout",
    "Switched to fallback model",
  );
  await triggerFailure(
    projectId,
    null,
    "secret_detected",
    "Hardcoded API key found",
    "Safety Agent blocked the PR before merge",
  );
  recordDeployment(projectId, null, "preview", "live", `https://preview-demo.forgecloud.dev`);
  sendJson(res, 200, { ok: true }, requestId);
}

async function handleSkipToDemo(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  // Wipe any non-canonical projects so the switcher doesn't accumulate phantom
  // entries from past /api/intake or /api/projects calls.
  const nonCanonical = d
    .prepare(`SELECT id FROM projects WHERE id != ?`)
    .all(DEMO_PROJECT_ID) as { id: string }[];
  for (const { id: pid } of nonCanonical) {
    d.prepare(
      `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
    ).run(pid);
    for (const t of [
      "chat_messages",
      "approvals",
      "deployments",
      "recovery_events",
      "agent_runs",
      "pull_requests",
      "tasks",
      "agents",
      "preview_comments",
      "worktrees",
      "commits",
      "branches",
    ])
      d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(pid);
    d.prepare(`DELETE FROM notifications WHERE project_id = ?`).run(pid);
    d.prepare(`DELETE FROM projects WHERE id = ?`).run(pid);
  }
  // Re-seed the canonical demo project to a known good state. This restores
  // its PRD-canonical name + fresh tasks/PRs/agents so the rest of the app
  // (Tasks, Agents, PRs, Preview) shows the same content the demo screenshot
  // walkthrough uses.
  ensureSeed();
  try {
    seedDemoProject();
  } catch (err) {
    // If re-seed fails (e.g. data race), the project still exists from ensureSeed.
  }
  sendJson(res, 200, { ok: true, project: "proj-pleasure-pizza" }, requestId);
}

const InjectFailureSchema = z.object({
  type: z.enum([
    "model_timeout",
    "build_failed",
    "secret_detected",
    "unsafe_db_migration",
    "deploy_failed",
    "bad_output",
    "rate_limit",
    "agent_conflict",
  ]),
  message: z.string().max(400).optional(),
});

async function handleInjectFailure(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = InjectFailureSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid inject-failure payload", requestId, {
      issues: parsed.error.issues,
    });
  const { type, message } = parsed.data;

  const projectId = await getCurrentProjectId();
  const d = getDb();

  const defaults: Record<string, { msg: string; recovery: string }> = {
    model_timeout: {
      msg: "Primary model timed out on Frontend Agent",
      recovery: "Switched to fallback model and continued from saved state",
    },
    build_failed: {
      msg: "Build failed on the latest PR — TypeScript error in Form.tsx",
      recovery:
        "QA Agent isolated the bad file, Frontend Agent shipped a fix, build re-ran successfully",
    },
    secret_detected: {
      msg: "Hardcoded API key found in src/lib/email.ts",
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
      msg: "LLM provider rate limit hit during agent run",
      recovery: "Exponential backoff retry, succeeded on attempt 3",
    },
    agent_conflict: {
      msg: "Two agents tried to edit routes/app.tsx simultaneously",
      recovery: "Created merge conflict review — QA Agent will resolve safely",
    },
  };
  const d2 = defaults[type];
  if (!d2) return sendError(res, 400, `unknown failure type: ${type}`, requestId);

  if (type === "secret_detected") {
    recordSecretBlock(projectId, null, "sk-live-EXAMPLE-DETECTED");
    return sendJson(res, 200, { event: listRecoveryEvents(projectId)[0] }, requestId);
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
    return sendJson(res, 200, { event }, requestId);
  }
  const event = await triggerFailure(projectId, null, type, message ?? d2.msg, d2.recovery);
  sendJson(res, 200, { event }, requestId);
}

const ApprovalSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  approverName: z.string().min(1).max(60).optional(),
});

async function handleApproval(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = ApprovalSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid approval payload", requestId, {
      issues: parsed.error.issues,
    });
  const result = decideApproval(
    parsed.data.approvalId,
    parsed.data.decision,
    parsed.data.approverName ?? "Animesh",
  );
  sendJson(res, 200, result, requestId);
}

const ApprovePrSchema = z.object({
  prId: z.string().min(1),
  approverName: z.string().min(1).max(60).optional(),
});

async function handleApprovePr(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = ApprovePrSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid approve-pr payload", requestId, {
      issues: parsed.error.issues,
    });
  approvePr(parsed.data.prId, parsed.data.approverName ?? "Animesh");
  sendJson(res, 200, { ok: true }, requestId);
}

const RollbackPrSchema = z.object({ prId: z.string().min(1) });

async function handleRollbackPr(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = RollbackPrSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid rollback payload", requestId, {
      issues: parsed.error.issues,
    });
  const d = getDb();
  const pr = d.prepare("SELECT * FROM pull_requests WHERE id = ?").get(parsed.data.prId) as
    | { id: string; project_id: string; task_id: string | null; title: string; number: number }
    | undefined;
  if (!pr) return sendError(res, 404, "PR not found", requestId);

  d.prepare(`UPDATE pull_requests SET status = 'rolled_back' WHERE id = ?`).run(pr.id);
  if (pr.task_id) {
    d.prepare(`UPDATE tasks SET status = 'backlog' WHERE id = ?`).run(pr.task_id);
  }
  await triggerFailure(
    pr.project_id,
    null,
    "manual_rollback",
    `PR #${pr.number} (${pr.title}) was rolled back by Animesh`,
    "Previous version restored. Task moved back to backlog for re-work.",
  );
  sendJson(res, 200, { ok: true, prId: pr.id }, requestId);
}

const RequestEditsSchema = z.object({
  prId: z.string().min(1),
  message: z.string().min(1).max(1000),
});

async function handleRequestEdits(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = RequestEditsSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid request-edits payload", requestId, {
      issues: parsed.error.issues,
    });
  const d = getDb();
  const pr = d.prepare("SELECT * FROM pull_requests WHERE id = ?").get(parsed.data.prId) as
    | { id: string; project_id: string; task_id: string | null; title: string; number: number }
    | undefined;
  if (!pr) return sendError(res, 404, "PR not found", requestId);

  d.prepare(`UPDATE pull_requests SET status = 'changes_requested' WHERE id = ?`).run(pr.id);
  const tasks = createTasksFromPlan(
    pr.project_id,
    {
      features: [
        {
          title: `Edits requested on PR #${pr.number}`,
          description: parsed.data.message,
          ownerAgent: "Frontend Agent",
          riskLevel: "low",
          estimatedFiles: 2,
        },
      ],
    },
    "Animesh",
  );
  sendJson(res, 200, { ok: true, task: tasks[0] }, requestId);
}

const ExplainSchema = z
  .object({
    approvalId: z.string().min(1).optional(),
    prId: z.string().min(1).optional(),
  })
  .refine((v) => v.approvalId || v.prId, { message: "approvalId or prId required" });

async function handleExplain(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = ExplainSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid explain payload", requestId, {
      issues: parsed.error.issues,
    });

  const d = getDb();
  let reason = "";
  let details = "";
  let riskLevel = "med";

  if (parsed.data.approvalId) {
    const a = d.prepare("SELECT * FROM approvals WHERE id = ?").get(parsed.data.approvalId) as
      | { reason: string; details: string; risk_level: string }
      | undefined;
    if (!a) return sendError(res, 404, "Approval not found", requestId);
    reason = a.reason;
    details = a.details;
    riskLevel = a.risk_level;
  } else if (parsed.data.prId) {
    const p = d.prepare("SELECT * FROM pull_requests WHERE id = ?").get(parsed.data.prId) as
      | { title: string; summary: string; risk_level: string }
      | undefined;
    if (!p) return sendError(res, 404, "PR not found", requestId);
    reason = p.title;
    details = p.summary;
    riskLevel = p.risk_level;
  }

  const explanation = await explainRiskyChange(reason, details, riskLevel);
  sendJson(res, 200, { explanation, provider: activeProviderName() }, requestId);
}

const DeploySchema = z.object({
  prId: z.string().min(1).optional().nullable(),
  environment: z.enum(["preview", "staging", "production"]).optional(),
});

async function handleDeploy(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = DeploySchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid deploy payload", requestId, {
      issues: parsed.error.issues,
    });
  const environment = parsed.data.environment ?? "preview";
  const projectId = await getCurrentProjectId();
  const url = `https://preview-${Math.random().toString(36).slice(2, 8)}.forgecloud.dev`;
  const id = recordDeployment(projectId, parsed.data.prId ?? null, environment, "live", url);
  sendJson(res, 200, { deploymentId: id, url }, requestId);
}

const DeployProdSchema = z.object({ fail: z.boolean().optional() });

async function handleDeployProduction(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = DeployProdSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid deploy-production payload", requestId, {
      issues: parsed.error.issues,
    });
  const projectId = await getCurrentProjectId();
  // PRD §5 Screen 7: production deploy must clear pending human approvals + DB-migration PRs.
  const d = getDb();
  const pendingApprovals = d
    .prepare(`SELECT id, reason, risk_level FROM approvals WHERE project_id = ? AND status = 'pending'`)
    .all(projectId) as { id: string; reason: string; risk_level: string }[];
  if (pendingApprovals.length > 0) {
    return sendJson(
      res,
      409,
      {
        ok: false,
        error: "approval_required",
        message: `${pendingApprovals.length} pending approval(s) must be resolved before production deploy.`,
        pending: pendingApprovals,
      },
      requestId,
    );
  }
  if (parsed.data.fail) {
    const id = recordDeployment(
      projectId,
      null,
      "production",
      "failed",
      undefined,
      "Railway deploy timed out after 90s",
    );
    return sendJson(
      res,
      200,
      {
        deploymentId: id,
        status: "failed",
        message: "Deploy failed but previous version is still live.",
      },
      requestId,
    );
  }
  const url = `https://app-${Math.random().toString(36).slice(2, 6)}.railway.app`;
  const id = recordDeployment(projectId, null, "production", "live", url);
  sendJson(res, 200, { deploymentId: id, status: "live", url }, requestId);
}

async function handleReset(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  // changes is keyed by pr_id, not project_id — wipe it via the PR join first.
  d.prepare(
    `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
  ).run(projectId);
  const tables = [
    "chat_messages",
    "approvals",
    "deployments",
    "recovery_events",
    "agent_runs",
    "pull_requests",
    "tasks",
    "agents",
    "preview_comments",
    "worktrees",
    "commits",
    "branches",
  ];
  for (const t of tables) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
  d.prepare(`DELETE FROM notifications WHERE project_id = ?`).run(projectId);
  d.prepare(`UPDATE projects SET status = 'intake' WHERE id = ?`).run(projectId);
  // Clean up any non-canonical projects created by past /api/intake or /api/projects
  // calls so the demo state stays tidy. The canonical project is preserved.
  const nonCanonical = d
    .prepare(`SELECT id FROM projects WHERE id != ?`)
    .all(DEMO_PROJECT_ID) as { id: string }[];
  if (nonCanonical.length > 0) {
    for (const { id: pid } of nonCanonical) {
      d.prepare(
        `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
      ).run(pid);
      for (const t of tables) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(pid);
      d.prepare(`DELETE FROM notifications WHERE project_id = ?`).run(pid);
      d.prepare(`DELETE FROM projects WHERE id = ?`).run(pid);
    }
  }
  // If the active project is the canonical Pleasure Pizza demo, re-seed it.
  if (projectId === DEMO_PROJECT_ID) {
    try {
      seedDemoProject();
    } catch (err) {
      // If re-seed fails (e.g. data race), leave the project empty — the user can /api/intake to start fresh.
    }
  }
  sendJson(res, 200, { ok: true }, requestId);
}

const CommentSchema = z.object({
  text: z.string().min(1).max(600),
  selector: z.string().max(400).optional().nullable(),
});

async function handleComment(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = CommentSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid comment payload", requestId, {
      issues: parsed.error.issues,
    });
  const { text, selector } = parsed.data;

  const d = getDb();
  const projectId = await getCurrentProjectId();
  const commentId = ids.newComment();
  d.prepare(
    `INSERT INTO preview_comments (id, project_id, pr_id, selector, text, status, created_at) VALUES (?, ?, NULL, ?, ?, 'open', ?)`,
  ).run(commentId, projectId, selector ?? null, text, Date.now());

  // Turn the comment into a task via LLM and persist it.
  const taskSpec = await commentToTask(text, selector ?? null);
  const tasks = createTasksFromPlan(
    projectId,
    {
      features: [
        {
          title: taskSpec.title,
          description: taskSpec.description,
          ownerAgent: taskSpec.ownerAgent,
          riskLevel: taskSpec.riskLevel,
          estimatedFiles: 3,
        },
      ],
    },
    "Animesh",
  );

  // Log the conversion as an assistant chat message so the user sees it.
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(
    ids.newMessage(),
    projectId,
    `Turned your preview comment into a task: "${taskSpec.title}" → ${taskSpec.ownerAgent}.`,
    JSON.stringify({
      kind: "task_created",
      taskIds: tasks.map((t) => t.id),
      source: "preview_comment",
      commentId,
    }),
  );

  const rows = d
    .prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  sendJson(res, 200, { comments: rows, task: tasks[0] }, requestId);
}

// ---------- simple GET helpers ----------------------------------------------

async function handleGetTasks(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  sendJson(res, 200, tasks, requestId);
}

async function handleGetPrs(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listPullRequests(projectId), requestId);
}

async function handleGetAgents(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, getAgents(projectId), requestId);
}

async function handleGetFailures(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listRecoveryEvents(projectId), requestId);
}

async function handleGetApprovals(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, getApprovalQueue(projectId), requestId);
}

async function handleGetTeam(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  sendJson(
    res,
    200,
    d.prepare("SELECT * FROM team_members WHERE workspace_id = ?").all(ids.workspace),
    requestId,
  );
}

async function handleGetChat(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const rows = d
    .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId);
  sendJson(res, 200, rows, requestId);
}

async function handleGetDeployments(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listDeployments(projectId), requestId);
}

async function handleGetAgentRuns(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const url = req.url ?? "";
  const pathname = url.split("?")[0];
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);

  // Accept either /api/agent-runs?agentId=… or /api/agent-runs/:agentId
  let agentId = params.get("agentId") ?? "";
  if (!agentId) {
    const match = pathname.match(/^\/api\/agent-runs\/([^/]+)$/);
    if (match) agentId = decodeURIComponent(match[1]);
  }

  if (!agentId) {
    return sendError(res, 400, "agentId is required", requestId);
  }

  const projectId = await getCurrentProjectId();
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT r.*, (SELECT title FROM tasks WHERE id = r.task_id) AS task_title
       FROM agent_runs r
       WHERE r.agent_id = ? AND r.project_id = ?
       ORDER BY r.started_at DESC`,
    )
    .all(agentId, projectId);
  sendJson(res, 200, rows, requestId);
}

// ---------- new vibecoding endpoints ----------------------------------------

// Notifications
async function handleListNotifications(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const rows = listNotifications(ids.workspace, 50);
  sendJson(res, 200, { notifications: rows, unread: unreadCount(ids.workspace) }, requestId);
}
const NotifReadSchema = z.object({ notificationId: z.string().min(1) });
async function handleMarkNotifRead(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = NotifReadSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  markNotificationRead(parsed.data.notificationId);
  sendJson(res, 200, { ok: true, unread: unreadCount(ids.workspace) }, requestId);
}
async function handleMarkAllNotifRead(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  markAllRead(ids.workspace);
  sendJson(res, 200, { ok: true, unread: 0 }, requestId);
}

// Branches / commits / worktrees
async function handleListBranches(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listBranches(projectId), requestId);
}
async function handleListCommits(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listCommits(projectId, branchId), requestId);
}
const MergeSchema = z.object({ branchId: z.string().min(1) });
async function handleMergeBranch(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = MergeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const branch = mergeBranch(parsed.data.branchId);
  if (!branch) return sendError(res, 404, "Branch not found", requestId);
  const projectId = await getCurrentProjectId();
  recordCommit({
    projectId,
    branchId: branch.id,
    prId: branch.head_pr_id,
    message: `Merged ${branch.name} into ${branch.base_branch}`,
    author: "Sal",
    filesChanged: 0,
  });
  const wsRow = getDb()
    .prepare("SELECT workspace_id FROM projects WHERE id = ?")
    .get(projectId) as { workspace_id: string } | undefined;
  if (wsRow) {
    createNotification({
      workspaceId: wsRow.workspace_id,
      projectId,
      kind: "pr_approved",
      title: `Branch merged: ${branch.name}`,
      body: `Now part of ${branch.base_branch}.`,
      link: "/app/branches",
    });
  }
  sendJson(res, 200, { ok: true, branch }, requestId);
}
async function handleArchiveBranch(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = MergeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const branch = archiveBranch(parsed.data.branchId);
  sendJson(res, 200, { ok: true, branch }, requestId);
}
async function handleListWorktrees(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, listWorktrees(projectId), requestId);
}
const SpawnWtSchema = z.object({ branchId: z.string().min(1).optional(), name: z.string().min(1).max(80) });
async function handleSpawnWorktree(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = SpawnWtSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const projectId = await getCurrentProjectId();
  const wt = spawnWorktree({
    projectId,
    branchId: parsed.data.branchId ?? null,
    name: parsed.data.name,
    previewUrl: `https://wt-${Math.random().toString(36).slice(2, 6)}.forgecloud.dev`,
  });
  sendJson(res, 200, { ok: true, worktree: wt }, requestId);
}

// Connections / discoveries / suggested apps
async function handleListConnections(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const d = getDb();
  sendJson(res, 200, d.prepare("SELECT * FROM connections WHERE workspace_id = ?").all(ids.workspace), requestId);
}
const ConnectSchema = z.object({ provider: z.string().min(1), account: z.string().max(120).optional() });
async function handleConnectTool(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = ConnectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM connections WHERE workspace_id = ? AND provider = ?")
    .get(ids.workspace, parsed.data.provider) as { id: string } | undefined;
  if (!row) return sendError(res, 404, "Connector not found", requestId);
  d.prepare(
    "UPDATE connections SET status = 'connected', account_label = ?, connected_at = ? WHERE id = ?",
  ).run(parsed.data.account ?? "Connected", Date.now(), row.id);
  createNotification({
    workspaceId: ids.workspace,
    projectId: await getCurrentProjectId(),
    kind: "system",
    title: `${parsed.data.provider} connected`,
    body: parsed.data.account ?? "Account linked.",
    link: "/app/connect",
  });
  sendJson(res, 200, { ok: true, connection: d.prepare("SELECT * FROM connections WHERE id = ?").get(row.id) }, requestId);
}
async function handleDisconnectTool(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = ConnectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  d.prepare(
    "UPDATE connections SET status = 'available', account_label = NULL, connected_at = NULL WHERE workspace_id = ? AND provider = ?",
  ).run(ids.workspace, parsed.data.provider);
  sendJson(res, 200, { ok: true }, requestId);
}
async function handleScanConnections(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  // No-op scan that just returns the seeded discoveries (already inserted by seed).
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const rows = d
    .prepare(
      "SELECT * FROM discoveries WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at ASC",
    )
    .all(ids.workspace, projectId);
  sendJson(res, 200, { discoveries: rows }, requestId);
}
async function handleListSuggested(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const rows = d
    .prepare(
      "SELECT * FROM suggested_apps WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at ASC",
    )
    .all(ids.workspace, projectId);
  sendJson(res, 200, { suggestedApps: rows }, requestId);
}
const BuildAppSchema = z.object({ appId: z.string().min(1) });
async function handleBuildSuggestedApp(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = BuildAppSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const app = d
    .prepare("SELECT * FROM suggested_apps WHERE id = ?")
    .get(parsed.data.appId) as { title: string; description: string; sample_features: string } | undefined;
  if (!app) return sendError(res, 404, "App not found", requestId);
  const projectId = await getCurrentProjectId();
  d.prepare("UPDATE projects SET name = ?, description = ?, status = 'planning' WHERE id = ?").run(
    app.title,
    app.description,
    projectId,
  );
  // Spawn tasks from sample_features.
  const features = JSON.parse(app.sample_features) as string[];
  const tasks = createTasksFromPlan(
    projectId,
    {
      features: features.map((title, i) => ({
        title,
        description: `${title} for ${app.title}`,
        ownerAgent: i % 2 === 0 ? "Frontend Agent" : "Backend Agent",
        riskLevel: "low" as const,
        estimatedFiles: 3,
      })),
    },
    ["Sal", "Marco"],
  );
  d.prepare(
    `INSERT INTO chat_messages (id, project_id, role, content, metadata) VALUES (?, ?, 'assistant', ?, ?)`,
  ).run(
    ids.newMessage(),
    projectId,
    `Starting build for ${app.title}. ${tasks.length} tasks queued.`,
    JSON.stringify({ kind: "task_created", taskIds: tasks.map((t) => t.id) }),
  );
  sendJson(res, 200, { ok: true, project: getProject(projectId), tasks }, requestId);
}

// Manual task creation
const AddTaskSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(800).optional(),
  ownerAgent: z.string().min(1).max(60).optional(),
  riskLevel: z.enum(["low", "med", "high"]).optional(),
  reviewer: z.string().max(60).optional(),
});
async function handleAddTask(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = AddTaskSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const projectId = await getCurrentProjectId();
  const tasks = createTasksFromPlan(
    projectId,
    {
      features: [
        {
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          ownerAgent: parsed.data.ownerAgent ?? "Frontend Agent",
          riskLevel: parsed.data.riskLevel ?? "low",
          estimatedFiles: 3,
        },
      ],
    },
    parsed.data.reviewer ?? "Sal",
  );
  createNotification({
    workspaceId: ids.workspace,
    projectId,
    kind: "task_created",
    title: `New task: ${parsed.data.title}`,
    body: parsed.data.description ?? "",
    link: "/app/tasks",
  });
  sendJson(res, 200, { ok: true, task: tasks[0] }, requestId);
}

// Plain-English Blame
const BlameSchema = z.object({
  selector: z.string().max(200).optional(),
  label: z.string().min(1).max(200),
});
async function handleBlame(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = BlameSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const projectId = await getCurrentProjectId();
  const d = getDb();
  // Find the most relevant PR/change by fuzzy match on the label or selector.
  // Token-based fuzzy search: try the full label first, then each word > 3 chars.
  const tokens = [parsed.data.label.toLowerCase(), ...parsed.data.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)];
  const stmt = d.prepare(
    `SELECT c.*, p.number AS pr_number, p.title AS pr_title, p.summary AS pr_summary, a.name AS agent_name
       FROM changes c
       LEFT JOIN pull_requests p ON p.id = c.pr_id
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE p.project_id = ?
         AND (LOWER(c.plain_english_summary) LIKE ? OR LOWER(c.file_path) LIKE ? OR LOWER(p.title) LIKE ? OR LOWER(p.summary) LIKE ?)
       ORDER BY p.created_at DESC LIMIT 1`,
  );
  let change: any;
  for (const tok of tokens) {
    const needle = `%${tok}%`;
    change = stmt.get(projectId, needle, needle, needle, needle);
    if (change) break;
  }
  change = change as
    | { pr_number: number; pr_title: string; pr_summary: string; agent_name: string; plain_english_summary: string }
    | undefined;

  const provider = getProvider();
  if (!change) {
    const reply = `Couldn't find a specific change tied to "${parsed.data.label}". The whole dashboard was built across PRs #1 through #5 by Product, Design, Frontend, Backend, QA, Safety, and DevOps Agents.`;
    return sendJson(res, 200, { explanation: reply, provider: provider?.name ?? "Fallback" }, requestId);
  }
  const promptCtx = `User clicked: "${parsed.data.label}"\nMatched PR #${change.pr_number}: ${change.pr_title}\nPR summary: ${change.pr_summary}\nChange summary: ${change.plain_english_summary}\nAgent who built it: ${change.agent_name}`;
  let reply: string;
  if (!provider) {
    reply = `${change.plain_english_summary} Built by ${change.agent_name} in PR #${change.pr_number} (${change.pr_title}).`;
  } else {
    try {
      reply = await provider.complete({
        system:
          "You are explaining who changed what and why for a non-technical business owner. 2-3 short sentences. No markdown. Reference the PR number and the agent name.",
        messages: [{ role: "user", content: promptCtx }],
        maxTokens: 180,
        intent: "explain",
      });
    } catch {
      reply = `${change.plain_english_summary} Built by ${change.agent_name} in PR #${change.pr_number}.`;
    }
  }
  sendJson(res, 200, { explanation: reply, provider: provider?.name ?? "Fallback", prNumber: change.pr_number }, requestId);
}

// Multi-project
const NewProjectSchema = z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional() });
async function handleNewProject(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = NewProjectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const id = ids.newProject();
  d.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status) VALUES (?, ?, ?, ?, 'intake')`,
  ).run(id, ids.workspace, parsed.data.name, parsed.data.description ?? null);
  createAgentsForProject(id);
  createNotification({
    workspaceId: ids.workspace,
    projectId: id,
    kind: "system",
    title: `New project: ${parsed.data.name}`,
    body: parsed.data.description ?? "Workspace ready.",
    link: "/app/intake",
  });
  sendJson(res, 200, { ok: true, project: getProject(id) }, requestId);
}

// ---------- router ----------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse, requestId: string) => Promise<void>;

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  rate?: RateLimitConfig;
}> = [
  // GET (cheap)
  { method: "GET", pattern: /^\/api\/health$/, handler: handleGetHealth },
  { method: "GET", pattern: /^\/api\/state$/, handler: handleGetState, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/tasks$/, handler: handleGetTasks, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/prs$/, handler: handleGetPrs, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/agents$/, handler: handleGetAgents, rate: RATE_CONFIGS.cheap },
  {
    method: "GET",
    pattern: /^\/api\/failures$/,
    handler: handleGetFailures,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "GET",
    pattern: /^\/api\/approvals$/,
    handler: handleGetApprovals,
    rate: RATE_CONFIGS.cheap,
  },
  { method: "GET", pattern: /^\/api\/team$/, handler: handleGetTeam, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/chat$/, handler: handleGetChat, rate: RATE_CONFIGS.cheap },
  {
    method: "GET",
    pattern: /^\/api\/deployments$/,
    handler: handleGetDeployments,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "GET",
    pattern: /^\/api\/agent-runs(?:\/[^/]+)?$/,
    handler: handleGetAgentRuns,
    rate: RATE_CONFIGS.cheap,
  },
  // POST (expensive — LLM calls or mutations)
  {
    method: "POST",
    pattern: /^\/api\/intake$/,
    handler: handleIntake,
    rate: RATE_CONFIGS.expensive,
  },
  { method: "POST", pattern: /^\/api\/chat$/, handler: handleChat, rate: RATE_CONFIGS.expensive },
  {
    method: "POST",
    pattern: /^\/api\/run-task$/,
    handler: handleRunTask,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/run-all$/,
    handler: handleRunAll,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/run-full-demo$/,
    handler: handleRunFullDemo,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/skip-to-demo$/,
    handler: handleSkipToDemo,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/inject-failure$/,
    handler: handleInjectFailure,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/approval$/,
    handler: handleApproval,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/approve-pr$/,
    handler: handleApprovePr,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/rollback-pr$/,
    handler: handleRollbackPr,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/request-edits$/,
    handler: handleRequestEdits,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/explain$/,
    handler: handleExplain,
    rate: RATE_CONFIGS.expensive,
  },
  { method: "POST", pattern: /^\/api\/deploy$/, handler: handleDeploy, rate: RATE_CONFIGS.cheap },
  {
    method: "POST",
    pattern: /^\/api\/deploy-production$/,
    handler: handleDeployProduction,
    rate: RATE_CONFIGS.cheap,
  },
  { method: "POST", pattern: /^\/api\/reset$/, handler: handleReset, rate: RATE_CONFIGS.cheap },
  {
    method: "POST",
    pattern: /^\/api\/comment$/,
    handler: handleComment,
    rate: RATE_CONFIGS.expensive,
  },
  // Notifications
  { method: "GET", pattern: /^\/api\/notifications$/, handler: handleListNotifications, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/notifications\/read$/, handler: handleMarkNotifRead, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/notifications\/read-all$/, handler: handleMarkAllNotifRead, rate: RATE_CONFIGS.cheap },
  // Branches / commits / worktrees
  { method: "GET", pattern: /^\/api\/branches$/, handler: handleListBranches, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/commits$/, handler: handleListCommits, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/branches\/merge$/, handler: handleMergeBranch, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/branches\/archive$/, handler: handleArchiveBranch, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/worktrees$/, handler: handleListWorktrees, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/worktrees$/, handler: handleSpawnWorktree, rate: RATE_CONFIGS.cheap },
  // Connections + discoveries + suggestions
  { method: "GET", pattern: /^\/api\/connections$/, handler: handleListConnections, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/connect$/, handler: handleConnectTool, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/disconnect$/, handler: handleDisconnectTool, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/scan$/, handler: handleScanConnections, rate: RATE_CONFIGS.cheap },
  { method: "GET", pattern: /^\/api\/suggested-apps$/, handler: handleListSuggested, rate: RATE_CONFIGS.cheap },
  { method: "POST", pattern: /^\/api\/build-app$/, handler: handleBuildSuggestedApp, rate: RATE_CONFIGS.expensive },
  // Manual task add
  { method: "POST", pattern: /^\/api\/add-task$/, handler: handleAddTask, rate: RATE_CONFIGS.cheap },
  // Plain-English Blame
  { method: "POST", pattern: /^\/api\/blame$/, handler: handleBlame, rate: RATE_CONFIGS.expensive },
  // Multi-project
  { method: "POST", pattern: /^\/api\/projects$/, handler: handleNewProject, rate: RATE_CONFIGS.cheap },
];

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;
  const pathname = url.split("?")[0];
  const requestId = newRequestId();
  const startedAt = Date.now();

  for (const route of ROUTES) {
    if (req.method === route.method && route.pattern.test(pathname)) {
      // Rate limit if configured.
      if (route.rate) {
        const key = clientKey(req as unknown as Parameters<typeof clientKey>[0], pathname);
        const { allowed, retryAfterMs } = consume(key, route.rate);
        if (!allowed) {
          res.setHeader("retry-after", Math.ceil(retryAfterMs / 1000).toString());
          log.warn("rate_limited", {
            requestId,
            route: pathname,
            method: req.method,
            retryAfterMs,
          });
          return (
            sendError(res, 429, "Rate limit exceeded — slow down a moment.", requestId, {
              retryAfterMs,
            }),
            true
          );
        }
      }

      log.info("api_start", { requestId, route: pathname, method: req.method });
      try {
        await route.handler(req, res, requestId);
        log.info("api_end", {
          requestId,
          route: pathname,
          ms: Date.now() - startedAt,
          status: res.statusCode,
        });
      } catch (err) {
        const error = err as Error;
        log.error("api_error", {
          requestId,
          route: pathname,
          ms: Date.now() - startedAt,
          error: error?.message,
          stack: error?.stack,
        });
        if (!res.headersSent) sendError(res, 500, error?.message ?? "internal error", requestId);
        else res.end();
      }
      return true;
    }
  }
  sendError(res, 404, `no route for ${req.method} ${pathname}`, requestId);
  return true;
}
