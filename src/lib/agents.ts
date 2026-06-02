import { getDb, type Agent, type Project, type Task, type PullRequest, type RecoveryEvent } from "./db";
import { ensureSeed, ids } from "./seed";
import { classifyRisk, generatePrSummary, narrateRecovery } from "./ai";
import { getProvider } from "./providers";
import { createNotification, findOrCreateBranchByName, recordCommit } from "./vcs";
import { log as logger } from "./logger";

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

export const AGENT_PERMS: Record<string, { allowed: string[]; needsApproval: string[] }> = {
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
  // M2: refuse to clobber a task that's already done/in-progress — return a recovery event instead.
  if (task.status !== "backlog") {
    const recovery = await triggerFailure(
      task.project_id,
      null,
      "guardrail_blocked",
      `Task "${task.title}" is already in ${task.status} — won't re-run.`,
      `Move it back to backlog first, or open the existing PR for review.`,
    );
    return { task, recovery };
  }

  let agent: Agent | undefined = task.assigned_agent_id
    ? (db.prepare("SELECT * FROM agents WHERE id = ?").get(task.assigned_agent_id) as Agent | undefined)
    : undefined;
  // B2: if the assigned agent is missing (stale FK, etc.), fall back to the project's Frontend Agent
  // so the agent_runs row has a valid agent_id.
  if (!agent) {
    agent = db
      .prepare("SELECT * FROM agents WHERE project_id = ? AND type = 'frontend' LIMIT 1")
      .get(task.project_id) as Agent | undefined;
  }

  db.prepare(`UPDATE tasks SET status = 'building' WHERE id = ?`).run(taskId);
  if (agent) {
    updateAgentStatus(agent.id, "working", `Building: ${task.title}`);
    db.prepare(`UPDATE agents SET current_task_id = ? WHERE id = ?`).run(taskId, agent.id);
  }

  const runId = ids.newRun();
  db.prepare(
    `INSERT INTO agent_runs (id, project_id, agent_id, task_id, status, input_prompt, model_used, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
  ).run(
    runId,
    task.project_id,
    agent?.id ?? null,
    taskId,
    `Build: ${task.title}`,
    agent?.model_primary ?? PRIMARY_MODEL,
    Date.now(),
  );

  let result: { task: Task; pr?: PullRequest; recovery?: RecoveryEvent };
  try {
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
      result = { task, recovery };
    } else if (failureType === "build_failed") {
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
      result = { task, recovery };
    } else {
      try {
        result = await runTaskSuccess(taskId, task, agent, runId);
      } catch (err) {
        // P0-7 reinforcement: if the success path itself throws (code bug, model error, etc.)
        // the task must NOT stay in "building" — return it to backlog with a recovery event
        // so the user can retry it, and the agent's current_task_id is cleared by the finally.
        const msg = (err as Error)?.message ?? String(err);
        logger.error("runTaskSuccess threw — resetting task to backlog", { err, runId, taskId });
        try {
          const recovery = await triggerFailure(
            task.project_id,
            runId,
            "build_failed",
            `${agent?.name ?? "Agent"} encountered an unexpected error on "${task.title}": ${msg}`,
            "Task was returned to the backlog. Review the error, then click Build now to retry.",
          );
          db.prepare(
            `UPDATE agent_runs SET status = 'recovered', output_summary = ?, completed_at = ? WHERE id = ?`,
          ).run(`Error: ${msg.slice(0, 200)}`, Date.now(), runId);
          result = { task, recovery };
        } catch (innerErr) {
          // B1: if the recovery-event path itself fails (DB locked, FK violation, etc.),
          // still record a minimal recovery so the user has something to act on, and
          // surface a useful error to the caller. The finally block will reset the
          // task to backlog.
          logger.error("triggerFailure threw — fallback recovery", { err: innerErr, taskId });
          try {
            db.prepare(
              `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
               VALUES (?, ?, ?, 'build_failed', ?, 'Task reset to backlog.', 'recovered', ?)`,
            ).run(
              ids.newRecovery(),
              task.project_id,
              runId,
              `Nested failure: ${msg.slice(0, 200)}`,
              Date.now(),
            );
          } catch {
            // Last-resort: do nothing — the task reset below is the user's lifeline.
          }
          throw err;
        }
      }
    }
    return result;
  } finally {
    // P0-6 + P0-7 + B1: always clear agent's current_task_id + idle it, AND reset
    // the task to backlog so it never gets stuck in "building" — even if the entire
    // try block threw before reaching a successful return.
    if (agent) {
      try {
        db.prepare(`UPDATE agents SET current_task_id = NULL, status = 'idle' WHERE id = ?`).run(agent.id);
      } catch {
        // best-effort
      }
    }
    try {
      db.prepare(`UPDATE tasks SET status = 'backlog' WHERE id = ? AND status = 'building'`).run(taskId);
    } catch {
      // best-effort
    }
  }
}

async function runTaskSuccess(
  taskId: string,
  task: Task,
  agent: Agent | undefined,
  runId: string,
): Promise<{ task: Task; pr: PullRequest }> {
  const db = getDb();

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

  // Agent idle state and current_task_id clear is handled by the finally block in runAgentOnTask.
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
  const humanLabel = labelForSecret(secret);
  db.prepare(
    `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
     VALUES (?, ?, NULL, 'secret_detected', ?, 'Safety Agent blocked the PR before merge — secrets never reach production', 'blocked', ?)`,
  ).run(
    id,
    projectId,
    `Safety Agent detected a hardcoded ${humanLabel} in the generated code`,
    Date.now(),
  );
  if (prId) {
    db.prepare(
      `UPDATE pull_requests SET status = 'blocked' WHERE id = ?`,
    ).run(prId);
  }
  // M4: surface the block in the bell too (not just recovery_events).
  const wsId = workspaceOfProject(projectId);
  if (wsId) {
    createNotification({
      workspaceId: wsId,
      projectId,
      kind: "secret_blocked",
      title: `Safety Agent blocked a ${humanLabel}`,
      body: `Detected "${secret.slice(0, 40)}${secret.length > 40 ? "…" : ""}" in agent output. Use environment variables instead.`,
      link: "/app/failures",
    });
  }
}

function labelForSecret(secret: string): string {
  if (/^sk-ant/i.test(secret)) return "Anthropic API key";
  if (/^sk-(?:proj|org)/i.test(secret)) return "OpenAI project key";
  if (/^sk_(?:live|test)/i.test(secret)) return "Stripe secret key";
  if (/^pk_(?:live|test)/i.test(secret)) return "Stripe publishable key";
  if (/^AIza/i.test(secret)) return "Google API key";
  if (/^ghp_/i.test(secret)) return "GitHub personal access token";
  if (/^xox[abp]-/i.test(secret)) return "Slack token";
  if (/^AKIA|^ASIA/i.test(secret)) return "AWS access key";
  if (/^eyJ/.test(secret)) return "JWT token";
  if (/sk-|pk-|api[_-]?key/i.test(secret)) return "API key";
  return "credential";
}

const SECRET_PATTERNS = [
  // Generic "sk|pk|api_key|secret|token" + 6+ alphanum
  /(?:sk|pk|api[_-]?key|secret|token)[_-][a-zA-Z0-9]{6,}/i,
  // OpenAI project-style keys: sk-proj-… (20+ alphanum)
  /sk-(?:proj-|ant-|test-|live-|org-)[A-Za-z0-9_\-]{16,}/i,
  // Anthropic API keys: sk-ant-api03-…
  /sk-ant-api03-[A-Za-z0-9_\-]{20,}/i,
  // Stripe live + test + restricted keys (real ones are much longer, but
  // 12 alphanum is the minimum to avoid false positives like "sk_live_xyz123")
  /sk_(?:live|test)_[A-Za-z0-9]{12,}/i,
  /pk_(?:live|test)_[A-Za-z0-9]{12,}/i,
  /rk_(?:live|test)_[A-Za-z0-9]{12,}/i,
  // AWS access key id (AKIA / ASIA prefix + 16 uppercase)
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  // Google API key
  /AIza[0-9A-Za-z\-_]{35}/,
  // GitHub personal access token
  /ghp_[a-zA-Z0-9]{36}/,
  // Slack tokens
  /xox[abp]-[a-zA-Z0-9-]+/,
  // JWT (header.payload.signature, base64url)
  /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/,
  // PEM private key block
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
];

export function detectSecret(text: string): string | null {
  for (const pat of SECRET_PATTERNS) {
    const m = text.match(pat);
    if (m) return m[0];
  }
  return null;
}

// Section 12 of forgecloud.pdf — guardrails the platform must block.
// Each rule has a kind, a friendly title, and a pattern. detectDangerousAction()
// returns null when input is safe, otherwise a structured hit.
export type DangerousActionHit = {
  kind:
    | "shell_command"
    | "drop_table"
    | "delete_database"
    | "billing_change"
    | "external_email"
    | "expose_private_data"
    | "merge_broken_build"
    | "permission_change";
  title: string;
  match: string;
};

const DANGER_RULES: Array<{ kind: DangerousActionHit["kind"]; title: string; pattern: RegExp }> = [
  // Shell / filesystem destruction
  { kind: "shell_command", title: "Dangerous shell command (rm -rf / dd / shutdown)", pattern: /\b(rm\s+-rf\s+\/|sudo\s+rm\s+-rf|dd\s+if=|mkfs\.|shutdown\s+(?:-h|now)|:\(\)\s*\{\s*:\|:&\s*\};:)/i },
  // SQL DDL destruction
  { kind: "drop_table", title: "Dropping a database table", pattern: /\bDROP\s+TABLE\b/i },
  { kind: "delete_database", title: "Deleting an entire database", pattern: /\b(DROP\s+DATABASE|TRUNCATE\s+\w+|DELETE\s+FROM\s+\w+\s*(?:;|$))/i },
  // Money / pricing changes
  { kind: "billing_change", title: "Editing billing / payment logic without approval", pattern: /\b(billing_amount|charge_customer|stripe\.charges\.create|refund|payment_method|invoice_total|price_cents)\b/i },
  // External communication
  { kind: "external_email", title: "Sending external email without approval", pattern: /\b(send(?:_|\s+)mail|sendgrid\.send|resend\.emails\.send|mailgun|aws\.ses\.sendemail|smtp\.send)\b/i },
  // Customer-data exposure
  { kind: "expose_private_data", title: "Exposing private user data (PII unmasked in UI)", pattern: /\b(unmask\w*|show(?:_|\s+)?(?:full(?:_|\s+))?(?:phone|email|ssn|credit_card|address)|return\s+\*\s+from\s+users)\b/i },
  // Build/test bypass
  { kind: "merge_broken_build", title: "Bypassing failing build or tests", pattern: /\b(--no-verify|skip(?:_|\s+)tests?|ignore[-_]?failures?|FORCE_MERGE|allow[-_]failure)\b/i },
  // Permission changes
  { kind: "permission_change", title: "Changing permissions (role escalation)", pattern: /\b(grant\s+all|role\s*=\s*['"]?(admin|owner|root)|chmod\s+[ugoa]?\+?s|setuid)\b/i },
];

export function detectDangerousAction(text: string): DangerousActionHit | null {
  for (const rule of DANGER_RULES) {
    const m = text.match(rule.pattern);
    if (m) return { kind: rule.kind, title: rule.title, match: m[0] };
  }
  return null;
}

// Lightweight profanity guard. We don't try to be exhaustive — just block the
// handful of common English expletives that would otherwise be persisted as
// task titles in the demo. False positives (e.g. technical terms) are
// acceptable since the user can rephrase.
const PROFANITY_WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "dick", "piss", "cunt",
];
export function detectProfanity(text: string): string | null {
  const lc = text.toLowerCase();
  for (const w of PROFANITY_WORDS) {
    // Word boundary on the left, but allow common suffixes (ing, ed, s, er, etc.)
    // so "fucking" still trips on the root "fuck". The right boundary alone is
    // not enough — "ass" should not match "class".
    const re = new RegExp(`\\b${w}[a-z]*\\b`, "i");
    if (re.test(lc)) return w;
  }
  return null;
}

/** Convenience: combined guardrail check used by /api/chat. */
export function detectGuardrailViolation(text: string): { kind: string; title: string; match: string } | null {
  const secret = detectSecret(text);
  if (secret) return { kind: "secret", title: "Hardcoded credential", match: secret };
  const danger = detectDangerousAction(text);
  if (danger) return danger;
  const profanity = detectProfanity(text);
  if (profanity) return { kind: "profanity", title: "Inappropriate language", match: profanity };
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
      // M1: rejection must unstick the task so the user can retry it.
      db.prepare(
        `UPDATE tasks SET status = 'backlog' WHERE linked_pr_id = ?`,
      ).run(approval.pr_id);
    }
    pr = db.prepare("SELECT * FROM pull_requests WHERE id = ?").get(approval.pr_id) as PullRequest;
    const wsId = workspaceOfProject(approval.project_id);
    if (wsId && pr) {
      createNotification({
        workspaceId: wsId,
        projectId: approval.project_id,
        kind: decision === "approve" ? "pr_approved" : "pr_rejected",
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
