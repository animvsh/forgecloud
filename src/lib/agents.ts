import { getDb, type Agent, type Project, type Task, type PullRequest, type RecoveryEvent } from "./db";
import { ensureSeed, ids } from "./seed";
import { classifyRisk, generatePrSummary, narrateRecovery } from "./ai";
import { getProvider } from "./providers";
import { createNotification, findOrCreateBranchByName, recordCommit } from "./vcs";

const PRIMARY_MODEL = getProvider()?.primaryModel ?? "MiniMax-Text-01";
const FALLBACK_MODEL = getProvider()?.fallbackModel ?? "MiniMax-M1";

export const AGENT_DEFS = [
  { type: "product", name: "Product Agent", role: "Turns user requests into features and tasks", defaultModel: PRIMARY_MODEL },
  { type: "design", name: "Design Agent", role: "Creates UI layout and design direction", defaultModel: PRIMARY_MODEL },
  { type: "frontend", name: "Frontend Agent", role: "Builds React components and pages", defaultModel: PRIMARY_MODEL },
  { type: "backend", name: "Backend Agent", role: "Builds APIs, database schema, and auth (uses InsForge)", defaultModel: PRIMARY_MODEL },
  { type: "qa", name: "QA Agent", role: "Tests the app and catches bugs before they ship", defaultModel: PRIMARY_MODEL },
  { type: "devops", name: "DevOps Agent", role: "Builds, deploys, and rolls back on Railway", defaultModel: PRIMARY_MODEL },
  { type: "auth", name: "Auth Agent", role: "Wires up team access and login", defaultModel: PRIMARY_MODEL },
  { type: "safety", name: "Safety Agent", role: "Blocks secrets, dangerous commands, and risky deploys", defaultModel: PRIMARY_MODEL },
  { type: "recovery", name: "Recovery Agent", role: "Handles failures, retries, and rollbacks", defaultModel: FALLBACK_MODEL },
] as const;

export type AgentType = (typeof AGENT_DEFS)[number]["type"];

const AGENT_PERMS: Record<string, { allowed: string[]; needsApproval: string[] }> = {
  product: { allowed: ["create_tasks", "edit_specs"], needsApproval: ["delete_tasks"] },
  design: { allowed: ["edit_ui_files"], needsApproval: ["major_brand_changes"] },
  frontend: { allowed: ["edit_frontend_files"], needsApproval: ["production_deploy"] },
  backend: { allowed: ["create_backend_functions", "edit_database"], needsApproval: ["database_migrations"] },
  qa: { allowed: ["run_tests"], needsApproval: [] },
  devops: { allowed: ["create_preview_deploys"], needsApproval: ["production_deploy"] },
  auth: { allowed: ["edit_auth_files"], needsApproval: ["auth_changes"] },
  safety: { allowed: ["block_risky_actions"], needsApproval: [] },
  recovery: { allowed: ["retry_runs", "rollback_deployments"], needsApproval: [] },
};

export function createAgentsForProject(projectId: string): Agent[] {
  ensureSeed();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO agents (id, project_id, name, type, role, permissions, status, model_primary, model_fallback)
     VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
  );
  const created: Agent[] = [];
  for (const def of AGENT_DEFS) {
    const id = ids.newAgent();
    insert.run(
      id,
      projectId,
      def.name,
      def.type,
      def.role,
      JSON.stringify(AGENT_PERMS[def.type] ?? { allowed: [], needsApproval: [] }),
      def.defaultModel,
      FALLBACK_MODEL,
    );
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
    created.push(agent);
  }
  return created;
}

export function getAgents(projectId: string): Agent[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Agent[];
}

export function getAgentByType(projectId: string, type: string): Agent | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM agents WHERE project_id = ? AND type = ?")
    .get(projectId, type) as Agent | undefined;
}

export function updateAgentStatus(
  agentId: string,
  status: string,
  lastAction?: string,
): void {
  const db = getDb();
  if (lastAction) {
    db.prepare(
      `UPDATE agents SET status = ?, last_action = ?, last_action_at = ? WHERE id = ?`,
    ).run(status, lastAction, Date.now(), agentId);
  } else {
    db.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run(status, agentId);
  }
}

export type PlanFeatureInput = {
  title: string;
  description: string;
  ownerAgent: string;
  riskLevel: "low" | "med" | "high";
  estimatedFiles: number;
};

const AGENT_TYPE_MAP: Record<string, AgentType> = {
  "Product Agent": "product",
  "Design Agent": "design",
  "Frontend Agent": "frontend",
  "Backend Agent": "backend",
  "QA Agent": "qa",
  "DevOps Agent": "devops",
  "Auth Agent": "auth",
  "Safety Agent": "safety",
  "Ops Agent": "backend",
  "Recovery Agent": "recovery",
};

export function createTasksFromPlan(
  projectId: string,
  plan: { features: PlanFeatureInput[] },
  reviewerNames: string | string[] = "Animesh",
): Task[] {
  const db = getDb();
  // Accept either a single name (back-compat) or an array; we round-robin
  // across the array so multiple reviewers actually get used.
  const reviewers = Array.isArray(reviewerNames)
    ? reviewerNames.filter((r) => r && r.trim().length > 0)
    : [reviewerNames];
  const finalReviewers = reviewers.length > 0 ? reviewers : ["Animesh"];
  const insert = db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, risk_level,
      requester_id, requester_name, assigned_agent_id, reviewer_id, reviewer_name, created_at)
     VALUES (?, ?, ?, ?, 'backlog', 'med', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tasks: Task[] = [];
  plan.features.forEach((f, idx) => {
    const agentType = AGENT_TYPE_MAP[f.ownerAgent] ?? "frontend";
    const agent = getAgentByType(projectId, agentType);
    const id = ids.newTask();
    const prReviewerName = finalReviewers[idx % finalReviewers.length];
    insert.run(
      id,
      projectId,
      f.title,
      f.description,
      f.riskLevel,
      ids.user,
      "Animesh",
      agent?.id ?? null,
      null,
      prReviewerName,
      Date.now(),
    );
    tasks.push(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task);
  });
  return tasks;
}

export async function runAgentOnTask(
  taskId: string,
  failureType?: string,
): Promise<{ task: Task; pr?: PullRequest; recovery?: RecoveryEvent }> {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
  if (!task) throw new Error(`Task ${taskId} not found`);

  const agent = task.assigned_agent_id
    ? (db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as Agent | undefined)
    : undefined;

  db.prepare(`UPDATE tasks SET status = 'building' WHERE id = ?`).run(taskId);
  if (agent) {
    updateAgentStatus(agent.id, "working", `Building: ${task.title}`);
  }

  const runId = ids.newRun();
  db.prepare(
    `INSERT INTO agent_runs (id, project_id, agent_id, task_id, status, input_prompt, model_used, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
  ).run(
    runId,
    task.project_id,
    agent?.id ?? "unknown",
    taskId,
    `Build feature: ${task.title}`,
    agent?.model_primary ?? PRIMARY_MODEL,
    Date.now(),
  );

  if (failureType === "model_timeout") {
    const recovery = await triggerFailure(
      task.project_id,
      runId,
      "model_timeout",
      `${agent?.name ?? "Agent"} timed out on "${task.title}"`,
      `Switched to fallback model (${FALLBACK_MODEL}) and continued from saved state`,
    );
    db.prepare(
      `UPDATE agent_runs SET status = 'recovered', fallback_used = 1, completed_at = ? WHERE id = ?`,
    ).run(Date.now(), runId);
    return { task, recovery };
  }

  if (failureType === "build_failed") {
    const recovery = await triggerFailure(
      task.project_id,
      runId,
      "build_failed",
      `Build failed on "${task.title}" — TypeScript or lint error`,
      "QA Agent isolated the bad file, Frontend Agent shipped a fix, build re-ran successfully",
    );
    db.prepare(
      `UPDATE agent_runs SET status = 'recovered', completed_at = ? WHERE id = ?`,
    ).run(Date.now(), runId);
    return { task, recovery };
  }

  const summary = await generatePrSummary(
    task.title,
    task.description ?? "",
    agent?.name ?? "Agent",
  );
  const modifiesDb = task.risk_level === "high" || /database|schema|table|column|migration/i.test(task.title + " " + (task.description ?? ""));
  const modifiesAuth = /auth|login|password|signup/i.test(task.title);
  const risk = await classifyRisk(task.title, task.description ?? "", modifiesDb, modifiesAuth, false);

  const prNumber = nextPrNumber(task.project_id);
  const prId = ids.newPR();
  const sourceBranch = `feature/${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  const previewUrl = `https://preview-${prNumber}.forgecloud.dev`;
  const requiresApproval = risk === "high" || risk === "med" || modifiesDb;

  db.prepare(
    `INSERT INTO pull_requests (id, project_id, task_id, number, title, summary, status, risk_level,
      source_branch, target_branch, preview_url, requires_approval, created_by_agent_id, files_changed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'main', ?, ?, ?, ?, ?)`,
  ).run(
    prId,
    task.project_id,
    taskId,
    prNumber,
    task.title,
    summary,
    risk,
    sourceBranch,
    previewUrl,
    requiresApproval ? 1 : 0,
    agent?.id ?? null,
    Math.max(1, Math.floor(Math.random() * 8) + 1),
    Date.now(),
  );

  const fileAreas = risk === "high" ? ["Database", "API", "UI"] : risk === "med" ? ["UI", "API"] : ["UI"];
  const changeInsert = db.prepare(
    `INSERT INTO changes (id, pr_id, file_path, technical_diff, plain_english_summary, risk_explanation, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const area of fileAreas) {
    changeInsert.run(
      ids.newChange(),
      prId,
      `${area.toLowerCase()}/${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`,
      `+ added ${area} support for "${task.title}"\n- removed placeholder`,
      `Added ${area.toLowerCase()} changes for "${task.title}"`,
      risk === "high" ? "Modifies database schema — review carefully" : null,
      agent?.id ?? null,
    );
  }

  // Branch + commit for the git-like primitives.
  const branch = findOrCreateBranchByName(task.project_id, sourceBranch, agent?.id ?? null, prId);
  recordCommit({
    projectId: task.project_id,
    branchId: branch.id,
    prId,
    message: summary.split("\n")[0].slice(0, 100),
    author: agent?.name ?? "Agent",
    filesChanged: fileAreas.length,
  });

  // Notify the workspace.
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as
    | { workspace_id: string }
    | undefined;
  if (project) {
    createNotification({
      workspaceId: project.workspace_id,
      projectId: task.project_id,
      kind: "pr_opened",
      title: `PR #${prNumber} opened: ${task.title}`,
      body: summary.slice(0, 200),
      link: "/app/changes",
    });
  }

  db.prepare(
    `UPDATE tasks SET status = 'review', linked_pr_id = ? WHERE id = ?`,
  ).run(prId, taskId);

  if (requiresApproval) {
    const reason = modifiesDb
      ? "Database schema change — affects existing data"
      : risk === "high"
        ? "High-risk change to production behavior"
        : "Medium-risk change requires human review";
    const details = modifiesDb
      ? `Backend Agent wants to modify the database. Adding new column "${extractColumnHint(task.title, task.description ?? "")}" and updating affected forms.`
      : `Agent wants to ${risk === "high" ? "deploy to production" : "merge a change that affects how the app works"}.`;
    db.prepare(
      `INSERT INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(ids.newApproval(), task.project_id, prId, reason, risk, details, Date.now());
    if (project) {
      createNotification({
        workspaceId: project.workspace_id,
        projectId: task.project_id,
        kind: "approval_needed",
        title: `Approval needed: PR #${prNumber}`,
        body: reason,
        link: "/app/changes",
      });
    }
  }

  if (agent) {
    updateAgentStatus(agent.id, "idle", `Shipped PR #${prNumber}: ${task.title}`);
  }
  db.prepare(
    `UPDATE agent_runs SET status = 'completed', output_summary = ?, completed_at = ? WHERE id = ?`,
  ).run(`Shipped PR #${prNumber}`, Date.now(), runId);

  const pr = db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(prId) as PullRequest;
  return { task, pr };
}

function extractColumnHint(title: string, desc: string): string {
  const text = `${title} ${desc}`.toLowerCase();
  const match = text.match(/add(?:ing)?\s+(?:a\s+)?(\w+)\s+(?:column|field)/);
  return match ? match[1] : "new field";
}

function nextPrNumber(projectId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COALESCE(MAX(number), 0) AS max FROM pull_requests WHERE project_id = ?")
    .get(projectId) as { max: number };
  return row.max + 1;
}

export async function triggerFailure(
  projectId: string,
  agentRunId: string | null,
  failureType: string,
  failureMessage: string,
  recoveryAction: string,
): Promise<RecoveryEvent> {
  const db = getDb();
  const id = ids.newRecovery();
  const narration = await narrateRecovery(failureType, failureMessage, recoveryAction);
  db.prepare(
    `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'recovered', ?)`,
  ).run(id, projectId, agentRunId, failureType, failureMessage, narration, Date.now());
  return db.prepare("SELECT * FROM recovery_events WHERE id = ?").get(id) as RecoveryEvent;
}

export function recordSecretBlock(projectId: string, prId: string | null, secret: string): void {
  const db = getDb();
  const id = ids.newRecovery();
  db.prepare(
    `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
     VALUES (?, ?, NULL, 'secret_detected', ?, 'Safety Agent blocked the PR before merge — secrets never reach production', 'blocked', ?)`,
  ).run(
    id,
    projectId,
    `Safety Agent detected a hardcoded ${secret.match(/sk-|pk-|api[_-]?key/i)?.[0] ?? "credential"} in the generated code`,
    Date.now(),
  );
  if (prId) {
    db.prepare(
      `UPDATE pull_requests SET status = 'blocked' WHERE id = ?`,
    ).run(prId);
  }
}

const SECRET_PATTERNS = [
  /(?:sk|pk|api[_-]?key|secret|token)[_-][a-zA-Z0-9]{20,}/i,
  /AIza[0-9A-Za-z\\-_]{35}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /xox[abp]-[a-zA-Z0-9-]+/,
];

export function detectSecret(text: string): string | null {
  for (const pat of SECRET_PATTERNS) {
    const m = text.match(pat);
    if (m) return m[0];
  }
  return null;
}

export function listRecoveryEvents(projectId: string): RecoveryEvent[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM recovery_events WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as RecoveryEvent[];
}

export function listPullRequests(projectId: string): PullRequest[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM pull_requests WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as PullRequest[];
}

export function getApprovalQueue(projectId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM approvals WHERE project_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .all(projectId);
}

function workspaceOfProject(projectId: string): string | undefined {
  const row = getDb()
    .prepare("SELECT workspace_id FROM projects WHERE id = ?")
    .get(projectId) as { workspace_id: string } | undefined;
  return row?.workspace_id;
}

export function decideApproval(
  approvalId: string,
  decision: "approve" | "reject",
  approverName: string,
): { approval: unknown; pr: PullRequest | null } {
  const db = getDb();
  db.prepare(
    `UPDATE approvals SET status = ?, approver_name = ?, decided_at = ? WHERE id = ?`,
  ).run(decision === "approve" ? "approved" : "rejected", approverName, Date.now(), approvalId);
  const approval = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as { pr_id: string | null; project_id: string };
  let pr: PullRequest | null = null;
  if (approval?.pr_id) {
    if (decision === "approve") {
      db.prepare(
        `UPDATE pull_requests SET status = 'approved', approver_name = ?, approved_at = ? WHERE id = ?`,
      ).run(approverName, Date.now(), approval.pr_id);
      db.prepare(
        `UPDATE tasks SET status = 'done' WHERE linked_pr_id = ?`,
      ).run(approval.pr_id);
    } else {
      db.prepare(
        `UPDATE pull_requests SET status = 'rejected' WHERE id = ?`,
      ).run(approval.pr_id);
    }
    pr = db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(approval.pr_id) as PullRequest;
    const wsId = workspaceOfProject(approval.project_id);
    if (wsId && pr) {
      createNotification({
        workspaceId: wsId,
        projectId: approval.project_id,
        kind: decision === "approve" ? "pr_approved" : "pr_rolled_back",
        title: decision === "approve" ? `PR #${pr.number} approved by ${approverName}` : `PR #${pr.number} rejected by ${approverName}`,
        body: pr.title,
        link: "/app/changes",
      });
    }
  }
  return { approval: db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId), pr };
}

export function approvePr(prId: string, approverName: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE pull_requests SET status = 'approved', approver_name = ?, approved_at = ? WHERE id = ?`,
  ).run(approverName, Date.now(), prId);
  db.prepare(`UPDATE tasks SET status = 'done' WHERE linked_pr_id = ?`).run(prId);
  const pr = db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(prId) as PullRequest | undefined;
  if (pr) {
    const wsId = workspaceOfProject(pr.project_id);
    if (wsId) {
      createNotification({
        workspaceId: wsId,
        projectId: pr.project_id,
        kind: "pr_approved",
        title: `PR #${pr.number} approved by ${approverName}`,
        body: pr.title,
        link: "/app/changes",
      });
    }
  }
}

function notifyDeployment(
  projectId: string,
  environment: string,
  status: string,
  url?: string,
  failureMessage?: string,
): void {
  const wsId = workspaceOfProject(projectId);
  if (!wsId) return;
  if (status === "live") {
    createNotification({
      workspaceId: wsId,
      projectId,
      kind: "deploy_live",
      title: `${environment} deploy live`,
      body: url ?? "Deployment is live.",
      link: "/app/deployments",
    });
  } else if (status === "failed") {
    createNotification({
      workspaceId: wsId,
      projectId,
      kind: "deploy_failed",
      title: `${environment} deploy failed`,
      body: failureMessage ?? "Deploy failed. Previous version still live.",
      link: "/app/deployments",
    });
  }
}

export function recordDeployment(
  projectId: string,
  prId: string | null,
  environment: "preview" | "staging" | "production",
  status: string,
  url?: string,
  failureMessage?: string,
): string {
  const db = getDb();
  const id = ids.newDeployment();
  db.prepare(
    `INSERT INTO deployments (id, project_id, pr_id, environment, status, railway_url, cloudflare_url, build_logs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    prId,
    environment,
    status,
    environment === "preview" ? url ?? `https://preview-${Date.now()}.forgecloud.dev` : null,
    null,
    failureMessage ?? `Build succeeded at ${new Date().toISOString()}`,
    Date.now(),
  );
  if (status === "failed") {
    db.prepare(
      `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
       VALUES (?, ?, NULL, 'deploy_failed', ?, 'Kept previous live version running, saved failed attempt for review', 'recovered', ?)`,
    ).run(
      ids.newRecovery(),
      projectId,
      `${environment} deploy failed: ${failureMessage ?? "hosting timeout"}`,
      Date.now(),
    );
  }
  return id;
}

export function listDeployments(projectId: string) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
}

export function getProject(projectId: string): Project | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined;
}
