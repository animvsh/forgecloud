import { getDb, type User, type Workspace } from "./db";
import { randomUUID } from "node:crypto";

const DEFAULT_USER_ID = "user-animesh";
const DEFAULT_WORKSPACE_ID = "ws-default";
const DEMO_PROJECT_ID = "proj-pielot-waitlist";

export function ensureSeed(): { user: User; workspace: Workspace } {
  const db = getDb();
  const existingUser = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(DEFAULT_USER_ID) as User | undefined;
  if (existingUser) {
    // Re-seed the demo project if it was deleted (e.g. after a reset)
    const demoProject = db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(DEMO_PROJECT_ID);
    if (!demoProject) {
      seedDemoProject();
    }
    const existingWs = db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(DEFAULT_WORKSPACE_ID) as Workspace;
    return { user: existingUser, workspace: existingWs };
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_USER_ID,
    "Animesh",
    "animesh@forgecloud.dev",
    null,
    "owner",
    now,
  );

  db.prepare(
    `INSERT INTO workspaces (id, name, owner_id, plan, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_WORKSPACE_ID,
    "Animesh's Workspace",
    DEFAULT_USER_ID,
    "pro",
    now,
  );

  const teamMembers: Array<[string, string, string, string, number]> = [
    ["tm-animesh", DEFAULT_WORKSPACE_ID, "Animesh", "owner", 0],
    ["tm-sarah", DEFAULT_WORKSPACE_ID, "Sarah", "reviewer", 0],
    ["tm-david", DEFAULT_WORKSPACE_ID, "David", "reviewer", 0],
  ];
  const insertTm = db.prepare(
    `INSERT INTO team_members (id, workspace_id, display_name, role, is_ai, permissions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, ws, name, role, isAi] of teamMembers) {
    insertTm.run(id, ws, name, role, isAi, JSON.stringify(["approve", "request", "view"]));
  }

  seedDemoProject();

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(DEFAULT_USER_ID) as User;
  const workspace = db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(DEFAULT_WORKSPACE_ID) as Workspace;
  return { user, workspace };
}

function seedDemoProject() {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `INSERT OR REPLACE INTO projects (id, workspace_id, name, description, status, repo_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    DEMO_PROJECT_ID,
    DEFAULT_WORKSPACE_ID,
    "Pielot Waitlist",
    "Early-access waitlist for the Pielot launch",
    "building",
    "https://github.com/pielot/waitlist",
    now - 1000 * 60 * 60 * 24 * 2,
  );

  // Agents
  const agentDefs = [
    ["Product Agent", "product", "Turns user requests into features and tasks"],
    ["Design Agent", "design", "Creates UI layout and design direction"],
    ["Frontend Agent", "frontend", "Builds React components and pages"],
    ["Backend Agent", "backend", "Builds APIs, database schema, and auth (uses InsForge)"],
    ["QA Agent", "qa", "Tests the app and catches bugs before they ship"],
    ["DevOps Agent", "devops", "Builds, deploys, and rolls back on Railway"],
    ["Auth Agent", "auth", "Wires up team access and login"],
    ["Safety Agent", "safety", "Blocks secrets, dangerous commands, and risky deploys"],
    ["Recovery Agent", "recovery", "Handles failures, retries, and rollbacks"],
  ] as const;
  const agentIds: Record<string, string> = {};
  const insertAgent = db.prepare(
    `INSERT OR REPLACE INTO agents (id, project_id, name, type, role, permissions, status, model_primary, model_fallback, last_action, last_action_at, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [name, type, role] of agentDefs) {
    const id = `agent-${type}-demo`;
    agentIds[type] = id;
    const status = type === "frontend" || type === "design" ? "working" : "idle";
    const lastAction = type === "frontend"
      ? "Building: Email confirmation page"
      : type === "design"
        ? "Building: Hero section polish"
        : type === "qa"
          ? "Approved PR #3 (signup form validation)"
          : `Shipped: Waitlist sign-up`;
    insertAgent.run(
      id,
      DEMO_PROJECT_ID,
      name,
      type,
      role,
      JSON.stringify(["approve", "request", "view"]),
      status,
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      lastAction,
      now - 1000 * 60 * 5,
      0,
    );
  }

  // Tasks
  const tasks: Array<[string, string, string, string, string, string, string, number]> = [
    ["task-1", "Waitlist landing page", "Hero section, signup form, and feature highlights. The first thing visitors see.", "done", "med", "frontend", "tm-sarah", now - 1000 * 60 * 60 * 24 * 2],
    ["task-2", "Email confirmation flow", "Send a welcome email when a user joins. Resend button on the thank-you page.", "done", "low", "backend", "tm-sarah", now - 1000 * 60 * 60 * 24],
    ["task-3", "Admin dashboard", "View total signups, referrers, and a table of recent signups with export.", "building", "med", "frontend", "tm-david", now - 1000 * 60 * 60 * 12],
    ["task-4", "Referral tracking", "Add a '?ref=' link that credits a signup to the referrer; show a leaderboard on the landing page.", "backlog", "med", "backend", "tm-david", now - 1000 * 60 * 60 * 6],
    ["task-5", "Add position to waitlist", "Show each user their position in line based on signup order.", "review", "low", "frontend", "tm-sarah", now - 1000 * 60 * 60 * 3],
    ["task-6", "Database migration: add referrer_code column", "Add referrer_code column to waitlist_signups table. Required for the new referral tracking feature.", "review", "high", "backend", "tm-david", now - 1000 * 60 * 60 * 2],
    ["task-7", "Mobile responsive polish", "Make the landing page work well on small screens. Test on iPhone SE, Pixel 7, etc.", "backlog", "low", "design", "tm-sarah", now - 1000 * 60 * 60 * 1],
    ["task-8", "Privacy policy + terms", "Generate plain-English privacy policy and terms of service. Footer links on every page.", "backlog", "low", "frontend", "tm-david", now - 1000 * 60 * 30],
  ];
  const insertTask = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, project_id, title, description, status, priority, risk_level, requester_id, requester_name, assigned_agent_id, reviewer_id, reviewer_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, title, desc, status, risk, agentType, reviewer, createdAt] of tasks) {
    const priority = risk === "high" ? "high" : risk === "med" ? "med" : "low";
    const agentId = agentIds[agentType] ?? null;
    insertTask.run(
      id,
      DEMO_PROJECT_ID,
      title,
      desc,
      status,
      priority,
      risk,
      "user-animesh",
      "Animesh",
      agentId,
      reviewer,
      "Sarah",
      createdAt,
    );
  }

  // PRs
  const prs: Array<[string, string | null, number, string, string, string, string, string, number, number, string | null, number]> = [
    ["pr-1", "task-1", 1, "Add waitlist landing page", "Hero, signup form, and feature highlights. All mobile responsive.", "approved", "low", "Animesh", 4, now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 30, null, 0],
    ["pr-2", "task-2", 2, "Wire up email confirmation", "Resend button, welcome template, and a 30-minute token TTL.", "approved", "low", "Animesh", 3, now - 1000 * 60 * 60 * 24 + 1000 * 60 * 45, null, 0],
    ["pr-3", "task-5", 3, "Show position in line", "Adds a small badge to the thank-you page with the user's current waitlist rank.", "open", "low", null, 2, now - 1000 * 60 * 60 * 3, "https://preview-3.forgecloud.dev", 0],
    ["pr-4", "task-3", 4, "Admin dashboard with signup table", "Cards at the top for total signups, today's count, and top referrer. Filterable table below.", "open", "med", null, 5, now - 1000 * 60 * 60 * 12, "https://preview-4.forgecloud.dev", 1],
    ["pr-5", "task-6", 5, "Add referrer_code column to waitlist_signups", "Backend Agent wants to add a referrer_code column to the waitlist_signups table. Includes a backfill and an index.", "open", "high", null, 1, now - 1000 * 60 * 60 * 2, "https://preview-5.forgecloud.dev", 1],
  ];
  const insertPr = db.prepare(
    `INSERT OR REPLACE INTO pull_requests (id, project_id, task_id, number, title, summary, status, risk_level, source_branch, target_branch, preview_url, requires_approval, approver_name, approved_at, created_by_agent_id, files_changed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, taskId, num, title, summary, status, risk, approver, filesChanged, createdAt, previewUrl, requiresApproval] of prs) {
    insertPr.run(
      id,
      DEMO_PROJECT_ID,
      taskId,
      num,
      title,
      summary,
      status,
      risk,
      `feature/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
      previewUrl,
      requiresApproval,
      approver,
      approver ? createdAt + 1000 * 60 * 30 : null,
      agentIds["frontend"] ?? null,
      filesChanged,
      createdAt,
    );
  }

  // Recovery events
  const recoveries: Array<[string, string, string, string, string, number]> = [
    ["rec-1", "model_timeout", "Primary model timed out on Frontend Agent while rendering the signup form", "Switched to fallback model (claude-haiku-4-5) and continued from saved state", "recovered", now - 1000 * 60 * 60 * 18],
    ["rec-2", "build_failed", "Build failed on the latest PR — TypeScript error in Form.tsx", "QA Agent isolated the bad file, Frontend Agent shipped a fix, build re-ran successfully", "recovered", now - 1000 * 60 * 60 * 8],
    ["rec-3", "secret_detected", "Safety Agent detected a hardcoded sk- credential in the email-template generator", "Safety Agent blocked the PR before merge — secrets never reach production", "blocked", now - 1000 * 60 * 60 * 4],
  ];
  const insertRecovery = db.prepare(
    `INSERT OR REPLACE INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (const [id, type, msg, action, status, createdAt] of recoveries) {
    insertRecovery.run(id, DEMO_PROJECT_ID, type, msg, action, status, createdAt);
  }

  // Approval (pending unsafe DB migration)
  db.prepare(
    `INSERT OR REPLACE INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    "apr-1",
    DEMO_PROJECT_ID,
    "pr-5",
    "Database schema change — affects existing data",
    "high",
    "Backend Agent wants to add a referrer_code column to the waitlist_signups table. This migration is safe to run (additive only, no rows dropped) but still requires your sign-off.",
    now - 1000 * 60 * 60 * 2,
  );

  // Live preview deploy
  db.prepare(
    `INSERT OR REPLACE INTO deployments (id, project_id, pr_id, environment, status, railway_url, cloudflare_url, build_logs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "dep-1",
    DEMO_PROJECT_ID,
    "pr-3",
    "preview",
    "live",
    null,
    "https://preview-pielot-waitlist.forgecloud.dev",
    "Build succeeded at " + new Date(now - 1000 * 60 * 60 * 2).toISOString() + " (45s)",
    now - 1000 * 60 * 60 * 2,
  );

  // Chat messages
  const chatMsgs: Array<[string, string, string, string | null, number]> = [
    ["msg-1", "user", "Build a waitlist app for Pielot. I want a clean landing page, an email signup form, and an admin view for tracking signups.", null, now - 1000 * 60 * 60 * 24 * 2],
    ["msg-2", "assistant", "Got it. Here's the build plan. Review the features below, then I'll start building once you approve.", JSON.stringify({ kind: "plan", plan: { summary: "A complete waitlist app for Pielot with landing page, signup form, admin dashboard, and email confirmation.", suggestedProjectName: "Pielot Waitlist", suggestedStyle: "Stripe-modern", features: [
      { title: "Landing page", description: "Hero, features, and call-to-action", ownerAgent: "Design Agent", riskLevel: "low", estimatedFiles: 3 },
      { title: "Waitlist form", description: "Email signup with confirmation", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 2 },
      { title: "Admin dashboard", description: "View signups and export to CSV", ownerAgent: "Frontend Agent", riskLevel: "low", estimatedFiles: 3 },
      { title: "Email confirmation", description: "Send welcome email on signup", ownerAgent: "Backend Agent", riskLevel: "med", estimatedFiles: 2 },
      { title: "Preview deploy", description: "Live preview URL", ownerAgent: "DevOps Agent", riskLevel: "low", estimatedFiles: 1 },
    ] }, taskIds: [] }), now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 5],
    ["msg-3", "user", "Looks good. Add a position-in-line badge to the thank-you page.", null, now - 1000 * 60 * 60 * 3],
    ["msg-4", "assistant", "Done. Created task \"Show position in line\" and assigned it to the Frontend Agent. Watch it on the Tasks screen.", JSON.stringify({ kind: "task_created" }), now - 1000 * 60 * 60 * 3 + 1000 * 60 * 2],
  ];
  const insertChat = db.prepare(
    `INSERT OR REPLACE INTO chat_messages (id, project_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, role, content, metadata, createdAt] of chatMsgs) {
    insertChat.run(id, DEMO_PROJECT_ID, role, content, metadata, createdAt);
  }

  // Agent runs
  const runs: Array<[string, string, string, string, string, number, number | null]> = [
    ["run-1", "frontend", "task-1", "completed", "claude-sonnet-4-6", now - 1000 * 60 * 60 * 24 * 2, now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 60],
    ["run-2", "frontend", "task-1", "recovered", "claude-haiku-4-5-20251001", now - 1000 * 60 * 60 * 18, now - 1000 * 60 * 60 * 18 + 1000 * 60 * 10],
    ["run-3", "frontend", "task-2", "completed", "claude-sonnet-4-6", now - 1000 * 60 * 60 * 24, now - 1000 * 60 * 60 * 24 + 1000 * 60 * 30],
    ["run-4", "frontend", "task-5", "running", "claude-sonnet-4-6", now - 1000 * 60 * 60 * 3, null],
  ];
  const insertRun = db.prepare(
    `INSERT OR REPLACE INTO agent_runs (id, project_id, agent_id, task_id, status, input_prompt, model_used, fallback_used, started_at, completed_at, output_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, agentType, taskId, status, model, startedAt, completedAt] of runs) {
    insertRun.run(
      id,
      DEMO_PROJECT_ID,
      agentIds[agentType] ?? agentIds.frontend,
      taskId,
      status,
      `Build feature: ${taskId}`,
      model,
      model === "claude-haiku-4-5-20251001" ? 1 : 0,
      startedAt,
      completedAt,
      completedAt ? `Shipped PR` : null,
    );
  }
}

export const ids = {
  user: DEFAULT_USER_ID,
  workspace: DEFAULT_WORKSPACE_ID,
  demoProject: DEMO_PROJECT_ID,
  newProject: () => `proj-${randomUUID()}`,
  newAgent: () => `agent-${randomUUID()}`,
  newTask: () => `task-${randomUUID()}`,
  newPR: () => `pr-${randomUUID()}`,
  newChange: () => `chg-${randomUUID()}`,
  newRun: () => `run-${randomUUID()}`,
  newRecovery: () => `rec-${randomUUID()}`,
  newDeployment: () => `dep-${randomUUID()}`,
  newApproval: () => `apr-${randomUUID()}`,
  newMessage: () => `msg-${randomUUID()}`,
  newComment: () => `cmt-${randomUUID()}`,
};
