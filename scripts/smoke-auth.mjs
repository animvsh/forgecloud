import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-auth-smoke-"));
process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = "fallback";
process.env.AUTH_SESSION_SECRET = "smoke-secret-do-not-use";
process.env.AUTH_REQUIRED = "true";
process.env.AUTH_LOGIN_RETURN_CODE = "true";

const { handleApiRequest, sessionTokenForSmoke } = await import("../dist/server/api-handler.mjs");

function makeReq(method, url, body, auth) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url,
    headers: {
      ...(raw ? { "content-type": "application/json" } : {}),
      ...(typeof auth === "string" && auth.startsWith("fc_session=")
        ? { cookie: auth }
        : auth
          ? { "x-forgecloud-session": auth }
          : {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
}

async function call(method, url, body, auth) {
  let status = 0;
  let responseBody = "";
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    hasHeader(name) {
      return name.toLowerCase() in headers;
    },
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(chunk) {
      responseBody = chunk ? String(chunk) : "";
    },
  };
  const handled = await handleApiRequest(makeReq(method, url, body, auth), res);
  if (!handled) throw new Error(`${method} ${url} was not handled`);
  return { status, json: responseBody ? JSON.parse(responseBody) : null, headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const unauth = await call("GET", "/api/state");
  assert(unauth.status === 401, `/api/state without session expected 401, got ${unauth.status}`);

  process.env.AUTH_LOGIN_RETURN_CODE = "false";
  process.env.NODE_ENV = "production";
  const blockedDelivery = await call("POST", "/api/auth/request-login", {
    email: "sal@pleasurepizza.com",
  });
  assert(
    blockedDelivery.status === 503,
    `/api/auth/request-login without production delivery expected 503, got ${blockedDelivery.status}`,
  );
  process.env.AUTH_LOGIN_RETURN_CODE = "true";
  process.env.NODE_ENV = "test";

  const requested = await call("POST", "/api/auth/request-login", {
    email: "sal@pleasurepizza.com",
  });
  assert(requested.status === 200, `/api/auth/request-login expected 200, got ${requested.status}`);
  assert(requested.json.code?.length === 6, "Login request should return a six-digit test code");
  const loggedIn = await call("POST", "/api/auth/login", {
    email: "sal@pleasurepizza.com",
    workspaceId: requested.json.workspace.id,
    code: requested.json.code,
  });
  assert(loggedIn.status === 200, `/api/auth/login expected 200, got ${loggedIn.status}`);
  const loginCookie = Array.isArray(loggedIn.headers["set-cookie"])
    ? loggedIn.headers["set-cookie"][0]
    : loggedIn.headers["set-cookie"];
  assert(loginCookie?.startsWith("fc_session="), "Login should set fc_session cookie");
  const cookieState = await call("GET", "/api/state", undefined, loginCookie);
  assert(
    cookieState.status === 200,
    `/api/state with login cookie expected 200, got ${cookieState.status}`,
  );
  assert(
    cookieState.json.workspace.id === "ws-default",
    "Login cookie should authenticate the default workspace",
  );
  const reusedCode = await call("POST", "/api/auth/login", {
    email: "sal@pleasurepizza.com",
    workspaceId: requested.json.workspace.id,
    code: requested.json.code,
  });
  assert(
    reusedCode.status === 401,
    `/api/auth/login reused code expected 401, got ${reusedCode.status}`,
  );
  const loggedOut = await call("POST", "/api/auth/logout", {}, loginCookie);
  assert(loggedOut.status === 200, `/api/auth/logout expected 200, got ${loggedOut.status}`);
  const clearCookie = Array.isArray(loggedOut.headers["set-cookie"])
    ? loggedOut.headers["set-cookie"][0]
    : loggedOut.headers["set-cookie"];
  assert(clearCookie?.includes("Max-Age=0"), "Logout should clear fc_session cookie");
  const afterLogout = await call("GET", "/api/state", undefined, clearCookie);
  assert(
    afterLogout.status === 401,
    `/api/state after logout expected 401, got ${afterLogout.status}`,
  );
  const oldCookieAfterLogout = await call("GET", "/api/state", undefined, loginCookie);
  assert(
    oldCookieAfterLogout.status === 401,
    `/api/state with old login cookie after logout expected 401, got ${oldCookieAfterLogout.status}`,
  );

  const defaultToken = sessionTokenForSmoke("user-animesh", "ws-default");
  const seeded = await call("POST", "/api/seed-demo", {}, defaultToken);
  assert(seeded.status === 200, `/api/seed-demo expected 200, got ${seeded.status}`);

  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const db = new Database(process.env.INSFORGE_DB_PATH);
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES ('user-other', 'Other Owner', 'owner@otherco.test', NULL, 'owner', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO workspaces (id, name, owner_id, plan, created_at)
     VALUES ('ws-other', 'Other Co', 'user-other', 'pro', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO team_members (id, workspace_id, user_id, display_name, role, permissions, is_ai)
     VALUES ('tm-other-owner', 'ws-other', 'user-other', 'Other Owner', 'owner', '["approve","request","view"]', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES ('user-reviewer', 'Review User', 'reviewer@otherco.test', NULL, 'reviewer', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES ('user-viewer', 'View User', 'viewer@otherco.test', NULL, 'viewer', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES ('user-staff', 'Staff User', 'staff@otherco.test', NULL, 'staff', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO team_members (id, workspace_id, user_id, display_name, role, permissions, is_ai)
     VALUES ('tm-reviewer', 'ws-other', 'user-reviewer', 'Review User', 'reviewer', '["approve","request","view"]', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO team_members (id, workspace_id, user_id, display_name, role, permissions, is_ai)
     VALUES ('tm-viewer', 'ws-other', 'user-viewer', 'View User', 'viewer', '["view"]', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO team_members (id, workspace_id, user_id, display_name, role, permissions, is_ai)
     VALUES ('tm-staff', 'ws-other', 'user-staff', 'Staff User', 'staff', '["request","view"]', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, status, created_at)
     VALUES ('proj-other', 'ws-other', 'Other Co Portal', 'Should be isolated from default workspace', 'building', ?)`,
  ).run(now);
  const defaultTask = db
    .prepare("SELECT id FROM tasks WHERE project_id = 'proj-pleasure-pizza' LIMIT 1")
    .get();
  const defaultPr = db
    .prepare("SELECT id FROM pull_requests WHERE project_id = 'proj-pleasure-pizza' LIMIT 1")
    .get();
  const defaultBranch = db
    .prepare("SELECT id FROM branches WHERE project_id = 'proj-pleasure-pizza' LIMIT 1")
    .get();
  let defaultApproval = db
    .prepare(
      "SELECT id FROM approvals WHERE project_id = 'proj-pleasure-pizza' AND status = 'pending' LIMIT 1",
    )
    .get();
  if (!defaultApproval) {
    db.prepare(
      `INSERT INTO approvals (id, project_id, pr_id, reason, risk_level, details, status, created_at)
       VALUES ('approval-cross-workspace', 'proj-pleasure-pizza', NULL, 'Cross workspace approval', 'high', 'Should stay private', 'pending', ?)`,
    ).run(now);
    defaultApproval = { id: "approval-cross-workspace" };
  }
  db.prepare(
    `INSERT OR IGNORE INTO notifications (id, workspace_id, project_id, user_id, kind, title, body, link, created_at)
     VALUES ('notif-cross-workspace', 'ws-default', 'proj-pleasure-pizza', NULL, 'system', 'Default workspace only', 'Should not be readable from other workspace', '/app', ?)`,
  ).run(now);
  db.prepare(
    `INSERT OR IGNORE INTO suggested_apps
       (id, workspace_id, project_id, slug, title, description, icon, uses_connections, sample_features, created_at)
     VALUES
       ('suggest-cross-workspace', 'ws-default', NULL, 'cross-workspace', 'Default Suggested App', 'Should not be buildable from other workspace', NULL, '[]', '["Private default feature"]', ?)`,
  ).run(now);
  assert(defaultTask?.id, "Seeded default workspace should have a task for cross-workspace probes");
  assert(defaultPr?.id, "Seeded default workspace should have a PR for cross-workspace probes");
  assert(
    defaultBranch?.id,
    "Seeded default workspace should have a branch for cross-workspace probes",
  );
  assert(
    defaultApproval?.id,
    "Default workspace should have an approval for cross-workspace probes",
  );
  db.close();

  const otherToken = sessionTokenForSmoke("user-other", "ws-other");
  const reviewerToken = sessionTokenForSmoke("user-reviewer", "ws-other");
  const viewerToken = sessionTokenForSmoke("user-viewer", "ws-other");
  const staffToken = sessionTokenForSmoke("user-staff", "ws-other");

  const defaultState = await call("GET", "/api/state", undefined, defaultToken);
  assert(
    defaultState.status === 200,
    `/api/state default expected 200, got ${defaultState.status}`,
  );
  assert(
    defaultState.json.workspace.id === "ws-default",
    "Default session should read default workspace",
  );
  assert(
    !defaultState.json.projects.some((project) => project.id === "proj-other"),
    "Default session should not list other workspace projects",
  );

  const otherState = await call("GET", "/api/state", undefined, otherToken);
  assert(otherState.status === 200, `/api/state other expected 200, got ${otherState.status}`);
  assert(otherState.json.workspace.id === "ws-other", "Other session should read other workspace");
  assert(
    otherState.json.project.id === "proj-other",
    "Other session should select its own project",
  );
  assert(
    !otherState.json.projects.some((project) => project.id === "proj-pleasure-pizza"),
    "Other session should not list default workspace projects",
  );

  const deniedSwitch = await call(
    "POST",
    "/api/projects/switch",
    { projectId: "proj-pleasure-pizza" },
    otherToken,
  );
  assert(
    deniedSwitch.status === 404,
    `/api/projects/switch cross-workspace expected 404, got ${deniedSwitch.status}`,
  );

  const allowedSwitch = await call(
    "POST",
    "/api/projects/switch",
    { projectId: "proj-other" },
    otherToken,
  );
  assert(
    allowedSwitch.status === 200,
    `/api/projects/switch own workspace expected 200, got ${allowedSwitch.status}`,
  );

  const crossApproval = await call(
    "POST",
    "/api/approval",
    { approvalId: defaultApproval.id, decision: "approve", approverName: "Other Owner" },
    otherToken,
  );
  assert(
    crossApproval.status === 404,
    `/api/approval cross-workspace expected 404, got ${crossApproval.status}`,
  );

  const crossExplainApproval = await call(
    "POST",
    "/api/explain",
    { approvalId: defaultApproval.id },
    otherToken,
  );
  assert(
    crossExplainApproval.status === 404,
    `/api/explain approval cross-workspace expected 404, got ${crossExplainApproval.status}`,
  );

  const crossApprovePr = await call(
    "POST",
    "/api/approve-pr",
    { prId: defaultPr.id, approverName: "Other Owner" },
    otherToken,
  );
  assert(
    crossApprovePr.status === 404,
    `/api/approve-pr cross-workspace expected 404, got ${crossApprovePr.status}`,
  );

  const crossRequestEdits = await call(
    "POST",
    "/api/request-edits",
    { prId: defaultPr.id, message: "Cross-workspace edit attempt" },
    otherToken,
  );
  assert(
    crossRequestEdits.status === 404,
    `/api/request-edits cross-workspace expected 404, got ${crossRequestEdits.status}`,
  );

  const crossRollback = await call("POST", "/api/rollback-pr", { prId: defaultPr.id }, otherToken);
  assert(
    crossRollback.status === 404,
    `/api/rollback-pr cross-workspace expected 404, got ${crossRollback.status}`,
  );

  const crossRunTask = await call("POST", "/api/run-task", { taskId: defaultTask.id }, otherToken);
  assert(
    crossRunTask.status === 404,
    `/api/run-task cross-workspace expected 404, got ${crossRunTask.status}`,
  );

  const crossCommits = await call(
    "GET",
    `/api/commits?branchId=${encodeURIComponent(defaultBranch.id)}`,
    undefined,
    otherToken,
  );
  assert(
    crossCommits.status === 404,
    `/api/commits cross-workspace branch expected 404, got ${crossCommits.status}`,
  );

  const crossMergeBranch = await call(
    "POST",
    "/api/branches/merge",
    { branchId: defaultBranch.id },
    otherToken,
  );
  assert(
    crossMergeBranch.status === 404,
    `/api/branches/merge cross-workspace expected 404, got ${crossMergeBranch.status}`,
  );

  const crossArchiveBranch = await call(
    "POST",
    "/api/branches/archive",
    { branchId: defaultBranch.id },
    otherToken,
  );
  assert(
    crossArchiveBranch.status === 404,
    `/api/branches/archive cross-workspace expected 404, got ${crossArchiveBranch.status}`,
  );

  const crossSpawnWorktree = await call(
    "POST",
    "/api/worktrees",
    { branchId: defaultBranch.id, name: "Cross workspace worktree" },
    otherToken,
  );
  assert(
    crossSpawnWorktree.status === 404,
    `/api/worktrees cross-workspace branch expected 404, got ${crossSpawnWorktree.status}`,
  );

  const crossNotificationRead = await call(
    "POST",
    "/api/notifications/read",
    { notificationId: "notif-cross-workspace" },
    otherToken,
  );
  assert(
    crossNotificationRead.status === 404,
    `/api/notifications/read cross-workspace expected 404, got ${crossNotificationRead.status}`,
  );

  const crossBuildApp = await call(
    "POST",
    "/api/build-app",
    { appId: "suggest-cross-workspace" },
    otherToken,
  );
  assert(
    crossBuildApp.status === 404,
    `/api/build-app cross-workspace expected 404, got ${crossBuildApp.status}`,
  );

  const reviewerApprove = await call(
    "POST",
    "/api/approve-pr",
    { prId: "missing-pr", approverName: "Review User" },
    reviewerToken,
  );
  assert(
    reviewerApprove.status === 404,
    `/api/approve-pr reviewer should pass RBAC and hit 404 missing PR, got ${reviewerApprove.status}`,
  );

  const reviewerDeploy = await call("POST", "/api/deploy-production", {}, reviewerToken);
  assert(
    reviewerDeploy.status === 403,
    `/api/deploy-production reviewer expected 403, got ${reviewerDeploy.status}`,
  );

  const staffGenericProductionDeploy = await call(
    "POST",
    "/api/deploy",
    { environment: "production" },
    staffToken,
  );
  assert(
    staffGenericProductionDeploy.status === 403,
    `/api/deploy generic production deploy expected 403, got ${staffGenericProductionDeploy.status}`,
  );

  const viewerRead = await call("GET", "/api/state", undefined, viewerToken);
  assert(viewerRead.status === 200, `/api/state viewer expected 200, got ${viewerRead.status}`);

  const viewerAddTask = await call(
    "POST",
    "/api/add-task",
    { title: "Viewer should not mutate" },
    viewerToken,
  );
  assert(
    viewerAddTask.status === 403,
    `/api/add-task viewer expected 403, got ${viewerAddTask.status}`,
  );

  const viewerInvite = await call(
    "POST",
    "/api/team",
    { displayName: "Blocked Invite", role: "viewer" },
    viewerToken,
  );
  assert(viewerInvite.status === 403, `/api/team viewer expected 403, got ${viewerInvite.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauth: unauth.status,
        productionDeliveryBlocked: blockedDelivery.status,
        loginCookie: cookieState.status,
        reusedCode: reusedCode.status,
        afterLogout: afterLogout.status,
        oldCookieAfterLogout: oldCookieAfterLogout.status,
        defaultWorkspace: defaultState.json.workspace.id,
        otherWorkspace: otherState.json.workspace.id,
        crossWorkspaceSwitch: deniedSwitch.status,
        crossWorkspaceApproval: crossApproval.status,
        crossWorkspaceApprovePr: crossApprovePr.status,
        crossWorkspaceRequestEdits: crossRequestEdits.status,
        crossWorkspaceRollback: crossRollback.status,
        crossWorkspaceRunTask: crossRunTask.status,
        crossWorkspaceBranchCommits: crossCommits.status,
        crossWorkspaceMergeBranch: crossMergeBranch.status,
        crossWorkspaceArchiveBranch: crossArchiveBranch.status,
        crossWorkspaceSpawnWorktree: crossSpawnWorktree.status,
        crossWorkspaceNotificationRead: crossNotificationRead.status,
        crossWorkspaceBuildApp: crossBuildApp.status,
        reviewerApproveMissingPr: reviewerApprove.status,
        reviewerDeployDenied: reviewerDeploy.status,
        staffGenericProductionDeployDenied: staffGenericProductionDeploy.status,
        viewerAddTaskDenied: viewerAddTask.status,
        viewerInviteDenied: viewerInvite.status,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
