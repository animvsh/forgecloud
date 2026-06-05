import { getDb, type User, type Workspace } from "./db";
import { randomUUID } from "node:crypto";
import { getProvider } from "./providers";

const DEFAULT_USER_ID = "user-animesh";
const DEFAULT_WORKSPACE_ID = "ws-default";
// Demo project ID kept as a constant; the project title is "Pleasure Pizza Ops".
const DEMO_PROJECT_ID = "proj-pleasure-pizza";

const SEED_PRIMARY_MODEL = getProvider()?.primaryModel ?? "MiniMax-Text-01";
const SEED_FALLBACK_MODEL = getProvider()?.fallbackModel ?? "MiniMax-M1";

// Match the shape returned by AGENT_PERMS in lib/agents.ts so the UI's
// permissions.allowed.length / permissions.needsApproval.length never NPEs.
import { AGENT_PERMS as SEED_AGENT_PERMS } from "./agents";

export function ensureSeed(): { user: User; workspace: Workspace } {
  const db = getDb();
  const existingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(DEFAULT_USER_ID) as
    | User
    | undefined;
  if (existingUser) {
    const demoProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(DEMO_PROJECT_ID);
    if (!demoProject) scaffoldDemoProject();
    // populateDemoData() is opt-in — see /api/seed-demo.
    seedConnectorsAndSuggestions(); // idempotent
    const existingWs = db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(DEFAULT_WORKSPACE_ID) as Workspace;
    return { user: existingUser, workspace: existingWs };
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(DEFAULT_USER_ID, "Sal", "sal@pleasurepizza.com", null, "owner", now);

  db.prepare(
    `INSERT INTO workspaces (id, name, owner_id, plan, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(DEFAULT_WORKSPACE_ID, "Pleasure Pizza", DEFAULT_USER_ID, "pro", now);

  const teamMembers: Array<[string, string, string, string, number]> = [
    ["tm-sal", DEFAULT_WORKSPACE_ID, "Sal", "owner", 0],
    ["tm-marco", DEFAULT_WORKSPACE_ID, "Marco", "manager", 0],
    ["tm-jamie", DEFAULT_WORKSPACE_ID, "Jamie", "staff", 0],
  ];
  const insertTm = db.prepare(
    `INSERT INTO team_members (id, workspace_id, display_name, role, is_ai, permissions) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, ws, name, role, isAi] of teamMembers) {
    insertTm.run(id, ws, name, role, isAi, JSON.stringify(["approve", "request", "view"]));
  }

  scaffoldDemoProject();
  // No auto-populate. The user starts with an empty project and must
  // explicitly call /api/seed-demo (via "Try the demo") or create tasks
  // via the intake wizard.
  seedConnectorsAndSuggestions();

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(DEFAULT_USER_ID) as User;
  const workspace = db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(DEFAULT_WORKSPACE_ID) as Workspace;
  return { user, workspace };
}

function seedConnectorsAndSuggestions() {
  const db = getDb();
  const now = Date.now();

  // Connections (some pre-connected for demo readiness).
  const connectors: Array<
    [string, string, string, string, string | null, string | null, number | null]
  > = [
    [
      "conn-gmail",
      "gmail",
      "Gmail",
      "connected",
      "sal@pleasurepizza.com",
      "✉️",
      now - 1000 * 60 * 60 * 24,
    ],
    [
      "conn-sheets",
      "google_sheets",
      "Google Sheets",
      "connected",
      "Pleasure Pizza – Sales 2026",
      "📊",
      now - 1000 * 60 * 60 * 24,
    ],
    [
      "conn-calendar",
      "google_calendar",
      "Google Calendar",
      "connected",
      "Catering & Events",
      "📅",
      now - 1000 * 60 * 60 * 24,
    ],
    ["conn-slack", "slack", "Slack", "available", null, "💬", null],
    ["conn-stripe", "stripe", "Stripe / POS", "available", null, "💳", null],
    ["conn-notion", "notion", "Notion", "available", null, "🗒", null],
    ["conn-hubspot", "hubspot", "HubSpot", "available", null, "🔁", null],
    ["conn-shopify", "shopify", "Shopify", "available", null, "🛒", null],
  ];
  const insertConn = db.prepare(
    `INSERT OR IGNORE INTO connections (id, workspace_id, provider, label, status, account_label, icon, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, provider, label, status, account, icon, connected_at] of connectors) {
    insertConn.run(id, DEFAULT_WORKSPACE_ID, provider, label, status, account, icon, connected_at);
  }

  // Discoveries (what scanning the connected tools found).
  const discoveries: Array<[string, string, string, string, string, string, number]> = [
    [
      "disc-1",
      "conn-gmail",
      "gmail",
      "Catering requests",
      "12 catering inquiries from the last 30 days",
      "Catering",
      12,
    ],
    [
      "disc-2",
      "conn-gmail",
      "gmail",
      "Customer complaints",
      "3 complaints about slow Friday service",
      "Complaints",
      3,
    ],
    [
      "disc-3",
      "conn-sheets",
      "google_sheets",
      "Daily sales",
      "Sales-by-hour rows for the last 90 days",
      "Sales",
      90,
    ],
    [
      "disc-4",
      "conn-sheets",
      "google_sheets",
      "Staff schedule",
      "Shift assignments for 6 staff members",
      "Staff",
      6,
    ],
    [
      "disc-5",
      "conn-sheets",
      "google_sheets",
      "Slow hours",
      "Recurring quiet window: 2pm–4pm on weekdays",
      "Hours",
      10,
    ],
    [
      "disc-6",
      "conn-calendar",
      "google_calendar",
      "Catering & events",
      "4 confirmed events in the next 30 days",
      "Events",
      4,
    ],
  ];
  const insertDisc = db.prepare(
    `INSERT OR IGNORE INTO discoveries (id, workspace_id, project_id, connection_id, provider, label, detail, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, conn, provider, label, detail, _kind, count] of discoveries) {
    insertDisc.run(id, DEFAULT_WORKSPACE_ID, DEMO_PROJECT_ID, conn, provider, label, detail, count);
  }

  // Suggested apps (cards the user picks from after scanning).
  const apps: Array<[string, string, string, string, string, string[], string[]]> = [
    [
      "app-pizza-ops",
      "pizza-ops-dashboard",
      "Pizza Ops Dashboard",
      "Daily sales, slow hours, staff tasks, complaints, and promos in one screen.",
      "🍕",
      ["gmail", "google_sheets", "google_calendar"],
      ["Sales today", "Slow-hours chart", "Staff tasks", "Promo builder", "Complaint log"],
    ],
    [
      "app-catering",
      "catering-tracker",
      "Catering Order Tracker",
      "Track inbound catering requests from Gmail + Calendar in one queue.",
      "🥪",
      ["gmail", "google_calendar"],
      ["Inbound requests", "Quote builder", "Event calendar", "Win/loss tracking"],
    ],
    [
      "app-complaints",
      "complaint-manager",
      "Complaint Manager",
      "Triage and resolve customer complaints flagged from Gmail.",
      "📮",
      ["gmail"],
      ["Inbox triage", "Resolution status", "Owner sign-off"],
    ],
    [
      "app-staff",
      "staff-task-board",
      "Staff Task Board",
      "Daily checklist with reset, assignments, and completion tracking.",
      "🧹",
      ["google_sheets"],
      ["Daily reset", "Per-staff status", "Closing checklist"],
    ],
    [
      "app-slow-day",
      "slow-day-promo",
      "Slow-Day Promo Tool",
      "Detect quiet hours and propose safe promos with profit estimate.",
      "📣",
      ["google_sheets"],
      ["Slow-day detection", "Promo composer", "Profit estimate", "Owner approval"],
    ],
    // The PRD's canonical demo template — "Build a simple CRM for my sales team."
    // (forgecloud.pdf section 14 — Demo script.) Keeping it here means the CRM
    // demo flow from the spec is one click away from the Suggested Apps screen.
    [
      "app-simple-crm",
      "simple-crm",
      "Simple CRM",
      "Lead dashboard, add lead form, notes, follow-up date, login. The PRD's reference demo.",
      "📇",
      ["gmail", "google_sheets"],
      ["Lead dashboard", "Add lead form", "Lead status", "Notes + follow-up", "Search", "Login"],
    ],
  ];
  const insertApp = db.prepare(
    `INSERT OR IGNORE INTO suggested_apps (id, workspace_id, project_id, slug, title, description, icon, uses_connections, sample_features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, slug, title, description, icon, uses, features] of apps) {
    insertApp.run(
      id,
      DEFAULT_WORKSPACE_ID,
      DEMO_PROJECT_ID,
      slug,
      title,
      description,
      icon,
      JSON.stringify(uses),
      JSON.stringify(features),
    );
  }
}

export function scaffoldDemoProject() {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `INSERT OR REPLACE INTO projects (id, workspace_id, name, description, status, repo_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    DEMO_PROJECT_ID,
    DEFAULT_WORKSPACE_ID,
    "Pleasure Pizza Ops",
    "Internal dashboard for sales, slow hours, staff tasks, and promos",
    "building",
    "https://github.com/pleasurepizza/ops",
    now - 1000 * 60 * 60 * 24 * 2,
  );

  // Agents (9 agents + a Data Agent extra is handled by Backend; keep AGENT_DEFS shape).
  const agentDefs = [
    ["Product Agent", "product", "Turns user requests into features and tasks"],
    ["Design Agent", "design", "Creates UI layout and design direction"],
    ["Frontend Agent", "frontend", "Builds React components and pages"],
    ["Backend Agent", "backend", "Builds APIs, database schema, and auth (uses InsForge)"],
    ["QA Agent", "qa", "Tests the app and catches bugs before they ship"],
    ["DevOps Agent", "devops", "Builds, deploys, and rolls back on Cloudflare"],
    ["Auth Agent", "auth", "Wires up team access and login"],
    ["Safety Agent", "safety", "Blocks secrets, dangerous commands, and risky deploys"],
    ["Recovery Agent", "recovery", "Handles failures, retries, and rollbacks"],
  ] as const;
  const agentIds: Record<string, string> = {};
  const insertAgent = db.prepare(
    `INSERT OR REPLACE INTO agents (id, project_id, name, type, role, permissions, status, model_primary, model_fallback, last_action, last_action_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [name, type, role] of agentDefs) {
    const id = `agent-${type}-demo`;
    agentIds[type] = id;
    const status = type === "frontend" || type === "design" ? "working" : "idle";
    const lastAction =
      type === "frontend"
        ? "Building: Profit estimate card"
        : type === "design"
          ? "Polishing: Slow-hours chart"
          : type === "safety"
            ? "Blocked '50% off all pizzas' — discount above safe margin"
            : type === "qa"
              ? "Approved PR #3 (closing checklist)"
              : `Shipped: PR #1 (Pizza Ops Dashboard v1)`;
    insertAgent.run(
      id,
      DEMO_PROJECT_ID,
      name,
      type,
      role,
      JSON.stringify(SEED_AGENT_PERMS[type] ?? { allowed: [], needsApproval: [] }),
      status,
      SEED_PRIMARY_MODEL,
      SEED_FALLBACK_MODEL,
      lastAction,
      now - 1000 * 60 * 5,
      0,
    );
  }
  // NOTE: scaffoldDemoProject intentionally does NOT call populateDemoData().
  // Demo data is opt-in via /api/seed-demo. Callers that want the full demo
  // state must call populateDemoData() (with agentIds queried from the
  // agents table) themselves.
}

export function populateDemoData(agentIds: Record<string, string>): void {
  const db = getDb();
  const now = Date.now();

  // Tasks (matching the spec's pizza shop scenario).
  const tasks: Array<[string, string, string, string, string, string, string, number]> = [
    [
      "task-1",
      "Sales dashboard",
      "Cards for today's sales, orders, avg order value",
      "done",
      "low",
      "frontend",
      "tm-sal",
      now - 1000 * 60 * 60 * 24 * 2,
    ],
    [
      "task-2",
      "Slow-hours chart",
      "Highlight low-traffic windows from order timestamps",
      "done",
      "low",
      "backend",
      "tm-sal",
      now - 1000 * 60 * 60 * 36,
    ],
    [
      "task-3",
      "Customer winback table",
      "Repeat customers + last order date + 'eligible' status",
      "done",
      "med",
      "backend",
      "tm-marco",
      now - 1000 * 60 * 60 * 24,
    ],
    [
      "task-4",
      "Promo builder",
      "Compose simple discount campaigns with target + offer",
      "review",
      "med",
      "frontend",
      "tm-sal",
      now - 1000 * 60 * 60 * 12,
    ],
    [
      "task-5",
      "Profit impact on promos",
      "Show revenue / discount cost / expected net before approving",
      "review",
      "med",
      "backend",
      "tm-sal",
      now - 1000 * 60 * 60 * 6,
    ],
    [
      "task-6",
      "Staff task board",
      "Daily checklist that resets each morning",
      "review",
      "low",
      "frontend",
      "tm-marco",
      now - 1000 * 60 * 60 * 3,
    ],
    [
      "task-7",
      "Closing checklist",
      "Nightly cleanup list staff mark complete; owner sees who did what",
      "review",
      "low",
      "frontend",
      "tm-jamie",
      now - 1000 * 60 * 60 * 2,
    ],
    [
      "task-8",
      "Mask customer phone numbers",
      "Replace full numbers with •••-•••-####; owner-only unmask",
      "review",
      "high",
      "backend",
      "tm-sal",
      now - 1000 * 60 * 60 * 1,
    ],
    [
      "task-9",
      "Complaint log",
      "Inbox-style triage for Gmail-flagged complaints",
      "backlog",
      "low",
      "backend",
      "tm-marco",
      now - 1000 * 60 * 45,
    ],
    [
      "task-10",
      "Catering tracker",
      "Pull catering inquiries from Gmail + Calendar",
      "backlog",
      "med",
      "backend",
      "tm-sal",
      now - 1000 * 60 * 30,
    ],
    [
      "task-11",
      "Inventory tracker",
      "Restock alerts driven by supplier emails",
      "backlog",
      "low",
      "backend",
      "tm-marco",
      now - 1000 * 60 * 20,
    ],
    [
      "task-12",
      "Deploy to Cloudflare",
      "Production deploy of v1 dashboard",
      "backlog",
      "med",
      "devops",
      "tm-sal",
      now - 1000 * 60 * 10,
    ],
  ];
  const insertTask = db.prepare(
    `INSERT OR REPLACE INTO tasks (id, project_id, title, description, status, priority, risk_level, requester_id, requester_name, assigned_agent_id, reviewer_id, reviewer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, title, desc, status, risk, agentType, reviewer, createdAt] of tasks) {
    const priority = risk === "high" ? "high" : risk === "med" ? "med" : "low";
    insertTask.run(
      id,
      DEMO_PROJECT_ID,
      title,
      desc,
      status,
      priority,
      risk,
      "user-animesh",
      "Sal",
      agentIds[agentType] ?? null,
      reviewer,
      reviewer === "tm-sal" ? "Sal" : reviewer === "tm-marco" ? "Marco" : "Jamie",
      createdAt,
    );
  }

  // PRs — five PRs per spec.
  const prs: Array<
    [
      string,
      string | null,
      number,
      string,
      string,
      string,
      string,
      string | null,
      number,
      number,
      string | null,
      number,
    ]
  > = [
    [
      "pr-1",
      "task-1",
      1,
      "Create Pizza Ops Dashboard v1",
      "First version of the internal dashboard: sales, customers, staff tasks, promo builder, and login.",
      "approved",
      "med",
      "Sal",
      8,
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 45,
      "https://preview-1.forgecloud.dev",
      1,
    ],
    [
      "pr-2",
      "task-5",
      2,
      "Add Profit Impact to Promos",
      "Promo Builder now estimates revenue, discount cost, and expected net before the owner approves a campaign.",
      "open",
      "med",
      null,
      4,
      now - 1000 * 60 * 60 * 6,
      "https://preview-2.forgecloud.dev",
      1,
    ],
    [
      "pr-3",
      "task-7",
      3,
      "Add Closing Checklist",
      "Nightly checklist staff mark complete; tasks reset each morning and the owner sees who did what.",
      "open",
      "low",
      null,
      3,
      now - 1000 * 60 * 60 * 2,
      "https://preview-3.forgecloud.dev",
      0,
    ],
    [
      "pr-4",
      "task-8",
      4,
      "Mask Customer Phone Numbers",
      "Customer table now shows masked phone numbers (•••-•••-####). Only owner-role accounts can unmask.",
      "open",
      "high",
      null,
      2,
      now - 1000 * 60 * 60 * 1,
      "https://preview-4.forgecloud.dev",
      1,
    ],
    [
      "pr-5",
      "task-12",
      5,
      "Deploy Pizza Ops to Cloudflare",
      "Publishes the approved dashboard to production and saves the previous version as a rollback point.",
      "open",
      "med",
      null,
      1,
      now - 1000 * 60 * 20,
      "https://preview-5.forgecloud.dev",
      1,
    ],
  ];
  const insertPr = db.prepare(
    `INSERT OR REPLACE INTO pull_requests (id, project_id, task_id, number, title, summary, status, risk_level, source_branch, target_branch, preview_url, requires_approval, approver_name, approved_at, created_by_agent_id, files_changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [
    id,
    taskId,
    num,
    title,
    summary,
    status,
    risk,
    approver,
    filesChanged,
    createdAt,
    previewUrl,
    requiresApproval,
  ] of prs) {
    insertPr.run(
      id,
      DEMO_PROJECT_ID,
      taskId,
      num,
      title,
      summary,
      status,
      risk,
      `feature/${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40)}`,
      previewUrl,
      requiresApproval,
      approver,
      approver ? createdAt + 1000 * 60 * 30 : null,
      agentIds["frontend"] ?? null,
      filesChanged,
      createdAt,
    );
  }

  // Screenshot URLs per PR (PRD §10 requires every PR to include a screenshot).
  const prScreenshots: Array<[string, string]> = [
    ["pr-1", "https://images.unsplash.com/photo-1556745757-8d76bdb6984b?w=900&q=70"],
    ["pr-2", "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=900&q=70"],
    ["pr-3", "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=900&q=70"],
    ["pr-4", "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=900&q=70"],
    ["pr-5", "https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&q=70"],
  ];
  const updatePrScreenshot = db.prepare(`UPDATE pull_requests SET screenshot_url = ? WHERE id = ?`);
  for (const [prId, url] of prScreenshots) {
    updatePrScreenshot.run(url, prId);
  }
  db.prepare(
    `UPDATE pull_requests
       SET merged_at = COALESCE(merged_at, approved_at)
     WHERE status = 'approved' AND approved_at IS NOT NULL`,
  ).run();

  // Per-file change rows for the 5 PRs.
  const changeRows: Array<[string, string, string, string, string, string | null]> = [
    // PR #1 Pizza Ops Dashboard v1
    [
      "chg-1a",
      "pr-1",
      "ui/dashboard/SalesCards.tsx",
      "+ daily sales, orders, average order, slowest hour cards",
      "Top-row cards showing today's sales, orders, average order value, and the slowest hour.",
      null,
    ],
    [
      "chg-1b",
      "pr-1",
      "ui/dashboard/SlowHoursChart.tsx",
      "+ slow hours from order timestamps",
      "Highlights the 2-hour window with the fewest orders so the owner knows when to run promos.",
      null,
    ],
    [
      "chg-1c",
      "pr-1",
      "ui/customers/CustomerTable.tsx",
      "+ customer winback table with last-order date",
      "Repeat customers and how long since their last order.",
      null,
    ],
    [
      "chg-1d",
      "pr-1",
      "ui/staff/StaffTaskBoard.tsx",
      "+ daily staff task board",
      "Today's staff tasks with owner and completion status.",
      null,
    ],
    [
      "chg-1e",
      "pr-1",
      "ui/promos/PromoBuilder.tsx",
      "+ promo composer (target, offer, time window)",
      "Form to compose a quick discount campaign for slow days.",
      null,
    ],
    [
      "chg-1f",
      "pr-1",
      "ui/complaints/ComplaintList.tsx",
      "+ inbox of customer complaints",
      "Customer complaints flagged from Gmail.",
      null,
    ],
    [
      "chg-1g",
      "pr-1",
      "api/auth/staff.ts",
      "+ staff login + owner role guard",
      "Basic login for staff. Only owner accounts can approve discounts.",
      null,
    ],
    [
      "chg-1h",
      "pr-1",
      "migrations/0001_pizza_ops.sql",
      "+ orders, customers, promos, tasks, complaints tables",
      "Created the database tables the dashboard reads from.",
      "Adds 5 new tables to InsForge. Additive only.",
    ],

    // PR #2 Profit Impact
    [
      "chg-2a",
      "pr-2",
      "ui/promos/ProfitEstimate.tsx",
      "+ shows revenue / discount cost / expected net",
      "Before approving a promo, owner sees estimated revenue, discount cost, and expected net.",
      null,
    ],
    [
      "chg-2b",
      "pr-2",
      "api/promos/estimate.ts",
      "+ promo math",
      "Calculates the financial impact of a proposed promo from sales history.",
      null,
    ],
    [
      "chg-2c",
      "pr-2",
      "ui/promos/ApprovalBanner.tsx",
      "+ approval required if discount > 25%",
      "Discounts above 25% trigger an inline approval prompt.",
      "Affects pricing decisions — review the threshold.",
    ],
    [
      "chg-2d",
      "pr-2",
      "lib/opt-out.ts",
      "+ exclude opted-out customers",
      "Promos cannot be sent to customers who opted out.",
      null,
    ],

    // PR #3 Closing Checklist
    [
      "chg-3a",
      "pr-3",
      "ui/staff/ClosingChecklist.tsx",
      "+ nightly checklist",
      "Nightly closing checklist with checkbox items.",
      null,
    ],
    [
      "chg-3b",
      "pr-3",
      "api/staff/checklist-reset.ts",
      "+ daily 5am reset",
      "Checklist items reset every morning.",
      null,
    ],
    [
      "chg-3c",
      "pr-3",
      "ui/dashboard/ChecklistStatus.tsx",
      "+ per-staff completion view",
      "Owner sees who completed each closing task.",
      null,
    ],

    // PR #4 Phone masking — HIGH RISK
    [
      "chg-4a",
      "pr-4",
      "ui/customers/PhoneCell.tsx",
      "+ render masked phone numbers",
      "Customer table now shows •••-•••-#### by default.",
      null,
    ],
    [
      "chg-4b",
      "pr-4",
      "api/customers/unmask.ts",
      "+ owner-only unmask endpoint",
      "Only owner-role accounts can unmask a phone number.",
      "Customer-data privacy: owner-only access guarded server-side.",
    ],

    // PR #5 Cloudflare deploy
    [
      "chg-5a",
      "pr-5",
      "deploy/cloudflare.toml",
      "+ production target + rollback target",
      "Production deploy on Cloudflare with the previous version saved as a rollback point.",
      "Publishes the internal tool to production.",
    ],
  ];
  const insertChange = db.prepare(
    `INSERT OR REPLACE INTO changes (id, pr_id, file_path, technical_diff, plain_english_summary, risk_explanation, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, prId, filePath, diff, summary, riskExplanation] of changeRows) {
    insertChange.run(
      id,
      prId,
      filePath,
      diff,
      summary,
      riskExplanation,
      agentIds["frontend"] ?? null,
    );
  }

  // Branches + commits derived from the PRs.
  const insertBranch = db.prepare(
    `INSERT OR REPLACE INTO branches (id, project_id, name, base_branch, head_pr_id, status, created_by_agent_id, created_at, merged_at) VALUES (?, ?, ?, 'main', ?, ?, ?, ?, ?)`,
  );
  const insertCommit = db.prepare(
    `INSERT OR REPLACE INTO commits (id, project_id, branch_id, pr_id, sha, message, author, files_changed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const branchSpecs: Array<[string, string, string, string, string, number, number | null]> = [
    [
      "branch-1",
      "feature/create-pizza-ops-dashboard-v1",
      "pr-1",
      "merged",
      agentIds["frontend"],
      now - 1000 * 60 * 60 * 24 * 2,
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 60,
    ],
    [
      "branch-2",
      "feature/add-profit-impact-to-promos",
      "pr-2",
      "active",
      agentIds["backend"],
      now - 1000 * 60 * 60 * 6,
      null,
    ],
    [
      "branch-3",
      "feature/add-closing-checklist",
      "pr-3",
      "active",
      agentIds["frontend"],
      now - 1000 * 60 * 60 * 2,
      null,
    ],
    [
      "branch-4",
      "feature/mask-customer-phone-numbers",
      "pr-4",
      "active",
      agentIds["backend"],
      now - 1000 * 60 * 60 * 1,
      null,
    ],
    [
      "branch-5",
      "feature/deploy-pizza-ops-to-cloudflare",
      "pr-5",
      "active",
      agentIds["devops"],
      now - 1000 * 60 * 20,
      null,
    ],
  ];
  for (const [id, name, prId, status, agentId, createdAt, mergedAt] of branchSpecs) {
    insertBranch.run(id, DEMO_PROJECT_ID, name, prId, status, agentId, createdAt, mergedAt);
  }
  // One commit per PR; branch-1 has two commits (initial + fixup).
  const commitSpecs: Array<[string, string, string, string, string, string, number, number]> = [
    [
      "commit-1a",
      "branch-1",
      "pr-1",
      "a17f02b3",
      "Add sales cards + slow-hours chart + customer table",
      "Frontend Agent",
      4,
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 30,
    ],
    [
      "commit-1b",
      "branch-1",
      "pr-1",
      "b29cd148",
      "Wire InsForge tables + owner auth guard",
      "Backend Agent",
      4,
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 55,
    ],
    [
      "commit-2",
      "branch-2",
      "pr-2",
      "c30f2a7d",
      "Add profit estimate + 25% discount approval rule",
      "Backend Agent",
      4,
      now - 1000 * 60 * 60 * 6 + 1000 * 60 * 12,
    ],
    [
      "commit-3",
      "branch-3",
      "pr-3",
      "d41a83f9",
      "Add nightly closing checklist with daily reset",
      "Frontend Agent",
      3,
      now - 1000 * 60 * 60 * 2 + 1000 * 60 * 8,
    ],
    [
      "commit-4",
      "branch-4",
      "pr-4",
      "e52b91ac",
      "Mask phone numbers; owner-only unmask endpoint",
      "Backend Agent",
      2,
      now - 1000 * 60 * 60 * 1 + 1000 * 60 * 5,
    ],
    [
      "commit-5",
      "branch-5",
      "pr-5",
      "f63c08eb",
      "Cloudflare prod target + rollback point",
      "DevOps Agent",
      1,
      now - 1000 * 60 * 20 + 1000 * 60 * 3,
    ],
  ];
  for (const [id, branchId, prId, sha, msg, author, files, createdAt] of commitSpecs) {
    insertCommit.run(id, DEMO_PROJECT_ID, branchId, prId, sha, msg, author, files, createdAt);
  }

  // Worktrees — parallel sandboxes assigned to specific agents.
  const insertWorktree = db.prepare(
    `INSERT OR REPLACE INTO worktrees (id, project_id, branch_id, name, status, assigned_agent_id, preview_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const worktreeSpecs: Array<[string, string, string, string, string, string]> = [
    [
      "wt-1",
      "branch-2",
      "wt/profit-impact",
      "active",
      agentIds["backend"],
      "https://preview-2.forgecloud.dev",
    ],
    [
      "wt-2",
      "branch-3",
      "wt/closing-checklist",
      "active",
      agentIds["frontend"],
      "https://preview-3.forgecloud.dev",
    ],
    [
      "wt-3",
      "branch-4",
      "wt/phone-masking",
      "active",
      agentIds["backend"],
      "https://preview-4.forgecloud.dev",
    ],
  ];
  for (const [id, branchId, name, status, agentId, previewUrl] of worktreeSpecs) {
    insertWorktree.run(
      id,
      DEMO_PROJECT_ID,
      branchId,
      name,
      status,
      agentId,
      previewUrl,
      now - 1000 * 60 * 30,
    );
  }

  // Recovery events from the demo spec.
  const recoveries: Array<[string, string, string, string, string, number]> = [
    [
      "rec-1",
      "model_timeout",
      "Frontend Agent failed: primary coding model timed out",
      `Switched to backup coding model (${SEED_FALLBACK_MODEL}) and continued from last saved step`,
      "recovered",
      now - 1000 * 60 * 60 * 18,
    ],
    [
      "rec-2",
      "build_failed",
      "Build failed because PromoEstimate had a missing import",
      "QA Agent caught the broken build. Frontend Agent fixed the import. New preview deployed.",
      "recovered",
      now - 1000 * 60 * 60 * 10,
    ],
    [
      "rec-3",
      "unsafe_discount",
      "AI tried to create '50% off all pizzas' campaign",
      "Safety Agent blocked: discount exceeds safe margin threshold. Owner approval required.",
      "blocked",
      now - 1000 * 60 * 60 * 5,
    ],
    [
      "rec-4",
      "privacy_violation",
      "Backend Agent tried to expose customer phone numbers",
      "Safety Agent blocked: showing masked numbers (•••-•••-####) to all-staff views.",
      "blocked",
      now - 1000 * 60 * 60 * 4,
    ],
    [
      "rec-5",
      "deploy_failed",
      "Cloudflare preview deploy timed out",
      "Kept previous preview live, retried with optimized build, created new preview URL.",
      "recovered",
      now - 1000 * 60 * 60 * 2,
    ],
  ];
  const insertRecovery = db.prepare(
    `INSERT OR REPLACE INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (const [id, type, msg, action, status, createdAt] of recoveries) {
    insertRecovery.run(id, DEMO_PROJECT_ID, type, msg, action, status, createdAt);
  }

  // Approval (pending — phone masking is high risk).
  db.prepare(
    `INSERT OR REPLACE INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    "apr-1",
    DEMO_PROJECT_ID,
    "pr-4",
    "Customer data privacy — masking phone numbers",
    "high",
    "Backend Agent wants to mask customer phone numbers in the staff view. Only owner-role accounts can unmask. Affects how staff sees customer records.",
    now - 1000 * 60 * 60 * 1,
  );

  // Live preview deployment.
  db.prepare(
    `INSERT OR REPLACE INTO deployments (id, project_id, pr_id, environment, status, railway_url, cloudflare_url, build_logs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "dep-1",
    DEMO_PROJECT_ID,
    "pr-1",
    "preview",
    "live",
    null,
    "https://preview-pleasure-pizza.forgecloud.dev",
    "Build succeeded at " + new Date(now - 1000 * 60 * 60 * 2).toISOString() + " (38s)",
    now - 1000 * 60 * 60 * 2,
  );

  // Historical staging + production deploys so the Deployments screen
  // shows realistic activity on a fresh seed (audit finding #1).
  const historicalDeploys: Array<
    [string, string, "staging" | "production", "live" | "failed", string | null, number]
  > = [
    [
      "dep-2",
      "pr-2",
      "staging",
      "live",
      "https://staging-pleasure-pizza.railway.app",
      now - 1000 * 60 * 60 * 5,
    ],
    [
      "dep-3",
      "pr-1",
      "production",
      "live",
      "https://app-pleasure-pizza.railway.app",
      now - 1000 * 60 * 60 * 3,
    ],
    ["dep-4", "pr-3", "production", "failed", null, now - 1000 * 60 * 30],
  ];
  for (const [id, prId, env, status, url, ts] of historicalDeploys) {
    db.prepare(
      `INSERT OR REPLACE INTO deployments (id, project_id, pr_id, environment, status, railway_url, cloudflare_url, build_logs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      DEMO_PROJECT_ID,
      prId,
      env,
      status,
      url,
      null,
      status === "failed"
        ? "Railway deploy timed out after 90s — kept previous live version"
        : "Build succeeded at " + new Date(ts).toISOString(),
      ts,
    );
  }

  // Chat messages seeded.
  const chatMsgs: Array<[string, string, string, string | null, number]> = [
    [
      "msg-1",
      "user",
      "Build me an internal dashboard for my pizza shop. I want to see today's sales, slow hours, top customers, repeat orders, employee tasks, and a way to create simple promo campaigns for slow days.",
      null,
      now - 1000 * 60 * 60 * 24 * 2,
    ],
    [
      "msg-2",
      "assistant",
      "I'll build the Pizza Ops Dashboard. I scanned your Gmail, Sheets, and Calendar and found 12 catering requests, 90 days of sales rows, 6 staff members, and your 2pm–4pm slow window. Here's the plan — review before I start.",
      JSON.stringify({
        kind: "plan",
        plan: {
          summary:
            "A complete internal dashboard for Pleasure Pizza: sales, customers, slow hours, staff tasks, and promos.",
          suggestedProjectName: "Pleasure Pizza Ops",
          suggestedStyle: "Warm Notion-clean",
          features: [
            {
              title: "Sales Dashboard",
              description: "Today's sales, orders, average order value",
              ownerAgent: "Product Agent",
              riskLevel: "low",
              estimatedFiles: 3,
            },
            {
              title: "Slow-Hours Chart",
              description: "Highlights low-traffic time windows",
              ownerAgent: "Backend Agent",
              riskLevel: "low",
              estimatedFiles: 2,
            },
            {
              title: "Customer Winback",
              description: "Repeat customers + last order date + eligibility",
              ownerAgent: "Backend Agent",
              riskLevel: "med",
              estimatedFiles: 3,
            },
            {
              title: "Promo Builder",
              description: "Compose discount campaigns for slow days",
              ownerAgent: "Frontend Agent",
              riskLevel: "med",
              estimatedFiles: 3,
            },
            {
              title: "Staff Tasks",
              description: "Daily checklist with reset",
              ownerAgent: "Frontend Agent",
              riskLevel: "low",
              estimatedFiles: 2,
            },
            {
              title: "Complaints Log",
              description: "Inbox-style triage from Gmail-flagged complaints",
              ownerAgent: "Backend Agent",
              riskLevel: "low",
              estimatedFiles: 2,
            },
            {
              title: "Catering Tracker",
              description: "Pull catering inquiries from Gmail + Calendar",
              ownerAgent: "Backend Agent",
              riskLevel: "med",
              estimatedFiles: 3,
            },
            {
              title: "Approval System",
              description: "Owner approval for discounts above 25%",
              ownerAgent: "Safety Agent",
              riskLevel: "med",
              estimatedFiles: 1,
            },
            {
              title: "Cloudflare Deploy",
              description: "Publish to production with rollback point",
              ownerAgent: "DevOps Agent",
              riskLevel: "med",
              estimatedFiles: 1,
            },
          ],
        },
        taskIds: [],
      }),
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 4,
    ],
    ["msg-3", "user", "Approve plan", null, now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 5],
    [
      "msg-4",
      "assistant",
      "Building. PR #1 went up 45 minutes after kickoff. Preview is live at preview-pleasure-pizza.forgecloud.dev.",
      JSON.stringify({ kind: "system" }),
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 50,
    ],
    [
      "msg-5",
      "user",
      "On the Promo Builder, I want to see how much money we might lose before I approve a discount.",
      null,
      now - 1000 * 60 * 60 * 6 - 1000 * 60 * 2,
    ],
    [
      "msg-6",
      "assistant",
      "Got it. Created task 'Profit impact on promos' → Backend Agent. PR #2 is up with revenue, discount cost, and expected net before approval. Discounts above 25% now require your sign-off.",
      JSON.stringify({ kind: "task_created", taskIds: ["task-5"] }),
      now - 1000 * 60 * 60 * 6,
    ],
  ];
  const insertChat = db.prepare(
    `INSERT OR REPLACE INTO chat_messages (id, project_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, role, content, metadata, createdAt] of chatMsgs) {
    insertChat.run(id, DEMO_PROJECT_ID, role, content, metadata, createdAt);
  }

  // Agent runs.
  const runs: Array<[string, string, string, string, string, number, number | null]> = [
    [
      "run-1",
      "frontend",
      "task-1",
      "completed",
      SEED_PRIMARY_MODEL,
      now - 1000 * 60 * 60 * 24 * 2,
      now - 1000 * 60 * 60 * 24 * 2 + 1000 * 60 * 60,
    ],
    [
      "run-2",
      "backend",
      "task-2",
      "completed",
      SEED_PRIMARY_MODEL,
      now - 1000 * 60 * 60 * 36,
      now - 1000 * 60 * 60 * 36 + 1000 * 60 * 40,
    ],
    [
      "run-3",
      "frontend",
      "task-4",
      "recovered",
      SEED_FALLBACK_MODEL,
      now - 1000 * 60 * 60 * 18,
      now - 1000 * 60 * 60 * 18 + 1000 * 60 * 12,
    ],
    [
      "run-4",
      "backend",
      "task-5",
      "completed",
      SEED_PRIMARY_MODEL,
      now - 1000 * 60 * 60 * 6,
      now - 1000 * 60 * 60 * 6 + 1000 * 60 * 25,
    ],
    [
      "run-5",
      "frontend",
      "task-7",
      "completed",
      SEED_PRIMARY_MODEL,
      now - 1000 * 60 * 60 * 2,
      now - 1000 * 60 * 60 * 2 + 1000 * 60 * 15,
    ],
    [
      "run-6",
      "backend",
      "task-8",
      "completed",
      SEED_PRIMARY_MODEL,
      now - 1000 * 60 * 60 * 1,
      now - 1000 * 60 * 60 * 1 + 1000 * 60 * 18,
    ],
    ["run-7", "devops", "task-12", "running", SEED_PRIMARY_MODEL, now - 1000 * 60 * 15, null],
  ];
  const insertRun = db.prepare(
    `INSERT OR REPLACE INTO agent_runs (id, project_id, agent_id, task_id, status, input_prompt, model_used, fallback_used, started_at, completed_at, output_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      model === SEED_FALLBACK_MODEL ? 1 : 0,
      startedAt,
      completedAt,
      completedAt ? `Shipped PR` : null,
    );
  }

  // Notifications for the workspace (so the bell has content out of the box).
  const insertNotif = db.prepare(
    `INSERT OR REPLACE INTO notifications (id, workspace_id, project_id, user_id, kind, title, body, link, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const notifs: Array<[string, string, string, string, string | null, number | null, number]> = [
    [
      "notif-1",
      "pr_opened",
      "PR #2 opened: Add Profit Impact to Promos",
      "Backend Agent shipped a new version of the promo builder.",
      "/app/changes",
      null,
      now - 1000 * 60 * 60 * 6,
    ],
    [
      "notif-2",
      "approval_needed",
      "Approval needed: PR #4",
      "Customer privacy — masking phone numbers.",
      "/app/changes",
      null,
      now - 1000 * 60 * 60 * 1,
    ],
    [
      "notif-3",
      "secret_blocked",
      "Safety Agent blocked an unsafe discount",
      "'50% off all pizzas' exceeded the safe margin threshold.",
      "/app/failures",
      now - 1000 * 60 * 60 * 4,
      now - 1000 * 60 * 60 * 5,
    ],
    [
      "notif-4",
      "deploy_live",
      "Preview live for Pizza Ops Dashboard",
      "https://preview-pleasure-pizza.forgecloud.dev",
      "/app/preview",
      null,
      now - 1000 * 60 * 60 * 2,
    ],
    [
      "notif-5",
      "comment",
      "Sal commented on the Promo Builder",
      "“I want this to show how much money we might lose before I approve a discount.”",
      "/app/preview",
      now - 1000 * 60 * 60 * 6,
      now - 1000 * 60 * 60 * 6 - 1000 * 60 * 5,
    ],
  ];
  for (const [id, kind, title, body, link, readAt, createdAt] of notifs) {
    insertNotif.run(
      id,
      DEFAULT_WORKSPACE_ID,
      DEMO_PROJECT_ID,
      DEFAULT_USER_ID,
      kind,
      title,
      body,
      link,
      readAt,
      createdAt,
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
