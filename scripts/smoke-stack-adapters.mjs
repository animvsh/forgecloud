import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-stack-smoke-"));
const requests = [];
const remoteChatMessages = [];
const remotePreviewComments = [];
const remoteActivityEvents = [];
const remoteMemoryEntries = [];
const remoteNotifications = [];
const remoteTasks = [];
const remotePullRequests = [];
const remoteChanges = [];
const remoteApprovals = [];
const remoteRecoveryEvents = [];
const remoteAgentRuns = [];
const remoteRuntimeChecks = [];
const remoteRocketRideRuns = [];
const remoteDeployments = [];
const remoteProjects = [
  {
    id: "proj-pleasure-pizza",
    workspace_id: "ws-default",
    name: "Pleasure Pizza Ops",
    description: "Mock Butterbase project row",
    status: "building",
    repo_url: null,
    cloudflare_project_id: null,
    insforge_project_id: null,
    created_at: Date.now(),
  },
];
const remoteUsers = [
  {
    id: "user-animesh",
    name: "Animesh",
    email: "animesh@example.com",
    avatar_url: null,
    role: "owner",
    created_at: Date.now(),
  },
];
const remoteConnections = [];
const remoteDiscoveries = [];
const remoteSuggestedApps = [];
const remoteBranches = [];
const remoteCommits = [];
const remoteWorktrees = [];
const remoteAgents = [];
const remoteTeamMembers = [
  {
    id: "tm-sal",
    workspace_id: "ws-default",
    user_id: "user-sal",
    display_name: "Sal",
    role: "owner",
    permissions: JSON.stringify(["approve", "deploy", "manage_team"]),
    is_ai: 0,
  },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

const mockServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const body = await readBody(req);
  requests.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    authorization: req.headers.authorization ?? null,
    xApiKey: req.headers["x-api-key"] ?? null,
    body,
  });

  if (req.method === "GET" && url.pathname === "/api/forgecloud/health") {
    return send(res, 200, { ok: true, provider: "mock-butterbase" });
  }
  if (
    req.method === "GET" &&
    url.pathname === "/api/forgecloud/workspace-prefs/ws-default/activeProjectId"
  ) {
    return send(res, 200, { value: null });
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/forgecloud/tables/projects/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const project = remoteProjects.find((row) => row.id === id);
    return project ? send(res, 200, project) : send(res, 404, { error: "not_found" });
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/projects") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteProjects.filter((row) => !workspaceId || row.workspace_id === workspaceId),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/projects") {
    const index = remoteProjects.findIndex((project) => project.id === body?.id);
    const row = {
      ...body,
      repo_url: body?.repo_url ?? null,
      cloudflare_project_id: body?.cloudflare_project_id ?? null,
      insforge_project_id: body?.insforge_project_id ?? null,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteProjects[index] = row;
    else remoteProjects.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/forgecloud/tables/users/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const user = remoteUsers.find((row) => row.id === id);
    return user ? send(res, 200, user) : send(res, 404, { error: "not_found" });
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/workspaces/ws-default") {
    return send(res, 200, {
      id: "ws-default",
      name: "Pleasure Pizza",
      slug: "pleasure-pizza",
      plan: "team",
      created_at: Date.now(),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/chat_messages") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteChatMessages
        .filter((message) => !projectId || message.project_id === projectId)
        .sort((a, b) => a.created_at - b.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/chat_messages") {
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    remoteChatMessages.push(row);
    return send(res, 200, row);
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/notifications") {
    const index = remoteNotifications.findIndex((notification) => notification.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteNotifications[index] = row;
    else remoteNotifications.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/notifications") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteNotifications
        .filter((notification) => !workspaceId || notification.workspace_id === workspaceId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/activity_events") {
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    remoteActivityEvents.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/activity_events") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteActivityEvents
        .filter((event) => !projectId || event.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/memory_entries") {
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    remoteMemoryEntries.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/memory_entries") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteMemoryEntries
        .filter((entry) => !projectId || entry.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/users") {
    const index = remoteUsers.findIndex((user) => user.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteUsers[index] = row;
    else remoteUsers.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/team_members") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteTeamMembers.filter((member) => !workspaceId || member.workspace_id === workspaceId),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/team_members") {
    const index = remoteTeamMembers.findIndex((member) => member.id === body?.id);
    const row = {
      ...body,
      is_ai: body?.is_ai ?? 0,
    };
    if (index >= 0) remoteTeamMembers[index] = row;
    else remoteTeamMembers.push(row);
    return send(res, 200, row);
  }
  if (req.method === "DELETE" && url.pathname === "/api/forgecloud/tables/team_members") {
    const before = remoteTeamMembers.length;
    for (let i = remoteTeamMembers.length - 1; i >= 0; i -= 1) {
      if (
        remoteTeamMembers[i].id === body?.id &&
        remoteTeamMembers[i].workspace_id === body?.workspace_id
      ) {
        remoteTeamMembers.splice(i, 1);
      }
    }
    return send(res, 200, { removed: before - remoteTeamMembers.length });
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/connections") {
    const index = remoteConnections.findIndex((connection) => connection.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteConnections[index] = row;
    else remoteConnections.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/connections") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteConnections.filter(
        (connection) => !workspaceId || connection.workspace_id === workspaceId,
      ),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/discoveries") {
    const index = remoteDiscoveries.findIndex((discovery) => discovery.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteDiscoveries[index] = row;
    else remoteDiscoveries.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/discoveries") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteDiscoveries.filter(
        (discovery) => !workspaceId || discovery.workspace_id === workspaceId,
      ),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/suggested_apps") {
    const index = remoteSuggestedApps.findIndex((app) => app.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteSuggestedApps[index] = row;
    else remoteSuggestedApps.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/suggested_apps") {
    const workspaceId = url.searchParams.get("workspace_id");
    return send(
      res,
      200,
      remoteSuggestedApps.filter((app) => !workspaceId || app.workspace_id === workspaceId),
    );
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/forgecloud/tables/branches/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const branch = remoteBranches.find((row) => row.id === id);
    return branch ? send(res, 200, branch) : send(res, 404, { error: "not_found" });
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/branches") {
    const index = remoteBranches.findIndex((branch) => branch.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteBranches[index] = row;
    else remoteBranches.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/branches") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteBranches
        .filter((branch) => !projectId || branch.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/commits") {
    const index = remoteCommits.findIndex((commit) => commit.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteCommits[index] = row;
    else remoteCommits.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/commits") {
    const projectId = url.searchParams.get("project_id");
    const branchId = url.searchParams.get("branch_id");
    return send(
      res,
      200,
      remoteCommits
        .filter((commit) => !projectId || commit.project_id === projectId)
        .filter((commit) => !branchId || commit.branch_id === branchId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/worktrees") {
    const index = remoteWorktrees.findIndex((worktree) => worktree.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteWorktrees[index] = row;
    else remoteWorktrees.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/worktrees") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteWorktrees
        .filter((worktree) => !projectId || worktree.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/agents") {
    const index = remoteAgents.findIndex((agent) => agent.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteAgents[index] = row;
    else remoteAgents.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/agents") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteAgents
        .filter((agent) => !projectId || agent.project_id === projectId)
        .sort((a, b) => a.created_at - b.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/agent_runs") {
    const index = remoteAgentRuns.findIndex((run) => run.id === body?.id);
    const row = {
      ...body,
      started_at: body?.started_at ?? Date.now(),
    };
    if (index >= 0) remoteAgentRuns[index] = row;
    else remoteAgentRuns.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/agent_runs") {
    const projectId = url.searchParams.get("project_id");
    const agentId = url.searchParams.get("agent_id");
    return send(
      res,
      200,
      remoteAgentRuns
        .filter((run) => !projectId || run.project_id === projectId)
        .filter((run) => !agentId || run.agent_id === agentId)
        .sort((a, b) => b.started_at - a.started_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/runtime_checks") {
    const index = remoteRuntimeChecks.findIndex((check) => check.id === body?.id);
    const row = {
      ...body,
      started_at: body?.started_at ?? Date.now(),
    };
    if (index >= 0) remoteRuntimeChecks[index] = row;
    else remoteRuntimeChecks.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/runtime_checks") {
    const projectId = url.searchParams.get("project_id");
    const agentRunId = url.searchParams.get("agent_run_id");
    return send(
      res,
      200,
      remoteRuntimeChecks
        .filter((check) => !projectId || check.project_id === projectId)
        .filter((check) => !agentRunId || check.agent_run_id === agentRunId)
        .sort((a, b) => a.started_at - b.started_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/rocketride_workflow_runs") {
    const index = remoteRocketRideRuns.findIndex((run) => run.id === body?.id);
    const row = {
      ...body,
      started_at: body?.started_at ?? Date.now(),
    };
    if (index >= 0) remoteRocketRideRuns[index] = row;
    else remoteRocketRideRuns.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/rocketride_workflow_runs") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteRocketRideRuns
        .filter((run) => !projectId || run.project_id === projectId)
        .sort((a, b) => b.started_at - a.started_at),
    );
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/tasks") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteTasks
        .filter((task) => !projectId || task.project_id === projectId)
        .sort((a, b) => a.created_at - b.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/tasks") {
    const index = remoteTasks.findIndex((task) => task.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteTasks[index] = row;
    else remoteTasks.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/pull_requests") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remotePullRequests
        .filter((pr) => !projectId || pr.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/pull_requests") {
    const index = remotePullRequests.findIndex((pr) => pr.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remotePullRequests[index] = row;
    else remotePullRequests.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/changes") {
    const projectId = url.searchParams.get("project_id");
    const prIds = new Set(
      remotePullRequests
        .filter((pr) => !projectId || pr.project_id === projectId)
        .map((pr) => pr.id),
    );
    return send(
      res,
      200,
      remoteChanges
        .filter((change) => prIds.has(change.pr_id))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/changes") {
    const index = remoteChanges.findIndex((change) => change.id === body?.id);
    const row = { ...body };
    if (index >= 0) remoteChanges[index] = row;
    else remoteChanges.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/deployments") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteDeployments
        .filter((deployment) => !projectId || deployment.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/approvals") {
    const index = remoteApprovals.findIndex((approval) => approval.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteApprovals[index] = row;
    else remoteApprovals.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/approvals") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteApprovals
        .filter((approval) => !projectId || approval.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/recovery_events") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remoteRecoveryEvents
        .filter((event) => !projectId || event.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/recovery_events") {
    const index = remoteRecoveryEvents.findIndex((event) => event.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteRecoveryEvents[index] = row;
    else remoteRecoveryEvents.push(row);
    return send(res, 200, row);
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/deployments") {
    const index = remoteDeployments.findIndex((deployment) => deployment.id === body?.id);
    const row = {
      ...body,
      created_at: body?.created_at ?? Date.now(),
    };
    if (index >= 0) remoteDeployments[index] = row;
    else remoteDeployments.push(row);
    return send(res, 200, row);
  }
  if (req.method === "GET" && url.pathname === "/api/forgecloud/tables/preview_comments") {
    const projectId = url.searchParams.get("project_id");
    return send(
      res,
      200,
      remotePreviewComments
        .filter((comment) => !projectId || comment.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at),
    );
  }
  if (req.method === "POST" && url.pathname === "/api/forgecloud/tables/preview_comments") {
    const row = {
      ...body,
      pr_id: body?.pr_id ?? null,
      selector: body?.selector ?? null,
      status: body?.status ?? "open",
      created_at: body?.created_at ?? Date.now(),
    };
    remotePreviewComments.push(row);
    return send(res, 200, row);
  }
  if (req.method === "DELETE" && url.pathname === "/api/forgecloud/tables/preview_comments") {
    const projectId = body?.project_id;
    const before = remotePreviewComments.length;
    for (let i = remotePreviewComments.length - 1; i >= 0; i -= 1) {
      if (!projectId || remotePreviewComments[i].project_id === projectId) {
        remotePreviewComments.splice(i, 1);
      }
    }
    return send(res, 200, { removed: before - remotePreviewComments.length });
  }
  if (req.method === "POST" && url.pathname === "/rocketride") {
    return send(res, 200, { ok: true, runId: body?.workflowRunId ?? null });
  }
  if (req.method === "POST" && url.pathname === "/xtrace") {
    return send(res, 200, {
      ok: true,
      records: [
        {
          id: "remote-memory-1",
          title: "Remote XTrace memory",
          body: "Mock XTrace remembered the VIP card change.",
        },
      ],
    });
  }
  if (req.method === "POST" && url.pathname === "/connected_accounts/link") {
    return send(res, 200, {
      connected_account_id: "conn-mock-slack",
      redirect_url: "https://composio.example.test/oauth/slack",
    });
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/connected_accounts/")) {
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: "not_found", path: url.pathname });
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const address = mockServer.address();
if (!address || typeof address === "string") throw new Error("Mock stack server did not bind");
const mockBaseUrl = `http://127.0.0.1:${address.port}`;

process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = "fallback";
process.env.FORGECLOUD_DEPLOY_MODE = "simulation";
process.env.FORGECLOUD_REQUIRE_LIVE_STACK = "true";
process.env.COMPOSIO_BASE_URL = mockBaseUrl;

const { handleApiRequest } = await import("../dist/server/api-handler.mjs");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function makeReq(method, url, body) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url,
    headers: raw ? { "content-type": "application/json" } : {},
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
}

async function call(method, url, body) {
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
  const handled = await handleApiRequest(makeReq(method, url, body), res);
  if (!handled) throw new Error(`${method} ${url} was not handled`);
  return { status: status || res.statusCode, json: responseBody ? JSON.parse(responseBody) : null };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, message, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

function findRequest(path, predicate = () => true) {
  return requests.find((request) => request.path === path && predicate(request));
}

try {
  const seeded = await call("POST", "/api/seed-demo", {});
  assert(seeded.status === 200, `/api/seed-demo expected 200, got ${seeded.status}`);

  const blockedHealth = await call("GET", "/api/health");
  assert(
    blockedHealth.status === 503,
    `/api/health with required but missing live stack expected 503, got ${blockedHealth.status}`,
  );
  assert(
    blockedHealth.json.checks?.some(
      (check) => check.name === "live_stack_config" && check.passed === false,
    ),
    "Health should fail the live_stack_config check when live stack is required but missing",
  );

  process.env.BUTTERBASE_PROJECT_URL = mockBaseUrl;
  process.env.BUTTERBASE_API_KEY = "butterbase-smoke-key";
  process.env.ROCKETRIDE_WORKFLOW_URL = `${mockBaseUrl}/rocketride`;
  process.env.ROCKETRIDE_API_KEY = "rocketride-smoke-key";
  process.env.XTRACE_MEMORY_URL = `${mockBaseUrl}/xtrace`;
  process.env.XTRACE_API_KEY = "xtrace-smoke-key";
  process.env.COMPOSIO_API_KEY = "composio-smoke-key";
  process.env.COMPOSIO_SLACK_AUTH_CONFIG_ID = "slack-auth-config-smoke";

  const health = await call("GET", "/api/health");
  assert(health.status === 200, `/api/health expected 200, got ${health.status}`);
  assert(health.json.butterbase?.mode === "remote", "Butterbase should be in remote mode");
  assert(
    health.json.stack?.liveRequired === true && health.json.stack?.allLiveConfigured === true,
    "Health should expose all live stack services configured",
  );
  assert(
    health.json.stack?.services?.some(
      (service) => service.key === "composio" && service.mode === "api" && service.configured,
    ),
    "Composio should be live-configured through API credentials, not the optional webhook",
  );
  assert(
    health.json.checks?.some(
      (check) => check.name === "butterbase_source_of_truth" && check.passed,
    ),
    "Health should prove remote Butterbase readiness",
  );
  assert(
    findRequest("/api/forgecloud/health")?.authorization === "Bearer butterbase-smoke-key",
    "Butterbase health should use bearer auth",
  );

  const state = await call("GET", "/api/state");
  assert(state.status === 200, `/api/state expected 200, got ${state.status}`);
  assert(state.json.butterbase?.mode === "remote", "State should report remote Butterbase mode");
  assert(
    state.json.connections?.length >= 8 && remoteConnections.length >= 8,
    "State should bootstrap and read connection catalogue from remote Butterbase",
  );
  assert(
    state.json.discoveries?.length >= 1 && remoteDiscoveries.length >= 1,
    "State should bootstrap and read discoveries from remote Butterbase",
  );
  const discoveries = await call("GET", "/api/discoveries");
  assert(discoveries.status === 200, `/api/discoveries expected 200, got ${discoveries.status}`);
  assert(
    discoveries.json.discoveries?.length === remoteDiscoveries.length,
    "/api/discoveries should read the remote Butterbase discovery catalogue",
  );
  assert(
    state.json.suggestedApps?.length >= 1 && remoteSuggestedApps.length >= 1,
    "State should bootstrap and read suggested apps from remote Butterbase",
  );
  assert(
    state.json.notifications?.length >= 1 && remoteNotifications.length >= 1,
    "State should mirror and read notifications from remote Butterbase",
  );
  assert(
    state.json.branches?.length >= 1 && remoteBranches.length >= 1,
    `State should bootstrap and read branches from remote Butterbase (state=${state.json.branches?.length ?? 0}, remote=${remoteBranches.length})`,
  );
  assert(
    state.json.commits?.length >= 1 && remoteCommits.length >= 1,
    "State should bootstrap and read commits from remote Butterbase",
  );
  assert(
    state.json.worktrees?.length >= 1 && remoteWorktrees.length >= 1,
    "State should bootstrap and read worktrees from remote Butterbase",
  );
  assert(
    state.json.agents?.length >= 9 && remoteAgents.length >= 9,
    "State should bootstrap and read agents from remote Butterbase",
  );
  assert(
    state.json.recovery?.length >= 1 && remoteRecoveryEvents.length >= 1,
    "State should bootstrap and read recovery events from remote Butterbase",
  );
  assert(
    state.json.prs?.length >= 1 && remotePullRequests.length >= 1,
    "State should bootstrap and read pull requests from remote Butterbase",
  );
  assert(
    state.json.prs?.some((pr) => (pr.changes ?? []).length > 0) && remoteChanges.length >= 1,
    "State should bootstrap and read PR changes from remote Butterbase",
  );

  const agents = await call("GET", "/api/agents");
  assert(agents.status === 200, `/api/agents expected 200, got ${agents.status}`);
  assert(
    agents.json.length === remoteAgents.length &&
      agents.json.some((agent) => agent.type === "recovery"),
    "/api/agents should read the remote Butterbase agent catalogue",
  );

  const failures = await call("GET", "/api/failures");
  assert(failures.status === 200, `/api/failures expected 200, got ${failures.status}`);
  assert(
    failures.json.length === remoteRecoveryEvents.length,
    "/api/failures should read recovery rows from remote Butterbase",
  );

  const branches = await call("GET", "/api/branches");
  assert(branches.status === 200, `/api/branches expected 200, got ${branches.status}`);
  assert(
    branches.json.length === remoteBranches.length,
    "/api/branches should read branches from remote Butterbase",
  );
  const branchId =
    branches.json.find((branch) => branch.status !== "merged")?.id ?? branches.json[0]?.id;
  assert(branchId, "Expected at least one branch for remote Butterbase branch smoke");
  const commits = await call("GET", `/api/commits?branchId=${encodeURIComponent(branchId)}`);
  assert(commits.status === 200, `/api/commits expected 200, got ${commits.status}`);
  assert(
    commits.json.length === remoteCommits.filter((commit) => commit.branch_id === branchId).length,
    "/api/commits should read branch commits from remote Butterbase",
  );
  const worktrees = await call("GET", "/api/worktrees");
  assert(worktrees.status === 200, `/api/worktrees expected 200, got ${worktrees.status}`);
  assert(
    worktrees.json.length === remoteWorktrees.length,
    "/api/worktrees should read worktrees from remote Butterbase",
  );
  const spawnedWorktree = await call("POST", "/api/worktrees", {
    branchId,
    name: "Remote Butterbase sandbox",
  });
  assert(
    spawnedWorktree.status === 200,
    `/api/worktrees POST expected 200, got ${spawnedWorktree.status}`,
  );
  assert(
    remoteWorktrees.some((worktree) => worktree.id === spawnedWorktree.json.worktree.id),
    "Spawned worktree should sync to remote Butterbase",
  );
  const mergedBranch = await call("POST", "/api/branches/merge", { branchId });
  assert(
    mergedBranch.status === 200,
    `/api/branches/merge expected 200, got ${mergedBranch.status}`,
  );
  assert(
    remoteBranches.find((branch) => branch.id === branchId)?.status === "merged",
    "Merged branch state should sync to remote Butterbase",
  );
  assert(
    remoteCommits.some(
      (commit) => commit.branch_id === branchId && commit.message?.startsWith("Merged "),
    ),
    "Merge commit should sync to remote Butterbase",
  );

  const notifications = await call("GET", "/api/notifications");
  assert(
    notifications.status === 200,
    `/api/notifications expected 200, got ${notifications.status}`,
  );
  assert(
    notifications.json.notifications.length === remoteNotifications.length,
    "/api/notifications should read notification rows from remote Butterbase",
  );
  const unreadNotification = notifications.json.notifications.find(
    (notification) => !notification.read_at,
  );
  assert(unreadNotification, "Expected at least one unread remote notification");
  const readNotification = await call("POST", "/api/notifications/read", {
    notificationId: unreadNotification.id,
  });
  assert(
    readNotification.status === 200,
    `/api/notifications/read expected 200, got ${readNotification.status}`,
  );
  assert(
    remoteNotifications.find((notification) => notification.id === unreadNotification.id)?.read_at,
    "Notification read state should sync to remote Butterbase",
  );

  const connections = await call("GET", "/api/connections");
  assert(connections.status === 200, `/api/connections expected 200, got ${connections.status}`);
  assert(
    connections.json.length === remoteConnections.length,
    "/api/connections should read the catalogue from remote Butterbase",
  );

  const scanned = await call("POST", "/api/scan", {});
  assert(scanned.status === 200, `/api/scan expected 200, got ${scanned.status}`);
  assert(
    scanned.json.discoveries.length === remoteDiscoveries.length,
    "/api/scan should sync Composio discoveries into remote Butterbase",
  );

  const suggested = await call("GET", "/api/suggested-apps");
  assert(suggested.status === 200, `/api/suggested-apps expected 200, got ${suggested.status}`);
  assert(
    suggested.json.suggestedApps.length === remoteSuggestedApps.length,
    "/api/suggested-apps should read from remote Butterbase",
  );

  const chat = await call("POST", "/api/chat", { message: "what is blocked right now?" });
  assert(chat.status === 200, `/api/chat expected 200, got ${chat.status}`);
  const chatRows = await call("GET", "/api/chat");
  assert(chatRows.status === 200, `/api/chat GET expected 200, got ${chatRows.status}`);
  assert(remoteChatMessages.length >= 2, "Chat should write user and assistant rows to Butterbase");
  assert(
    findRequest(
      "/api/forgecloud/tables/chat_messages",
      (request) => request.method === "POST" && request.body?.role === "user",
    )?.authorization === "Bearer butterbase-smoke-key",
    "Butterbase chat writes should use bearer auth",
  );
  assert(
    Array.isArray(chatRows.json) && chatRows.json.length === remoteChatMessages.length,
    "Chat reads should come back from remote Butterbase",
  );
  assert(
    remoteActivityEvents.some((event) => event.event_type === "chat_request"),
    "Chat activity should write to remote Butterbase activity_events",
  );

  const comment = await call("POST", "/api/comment", {
    text: "Make the VIP card easier to scan on mobile.",
    selector: "#vip-card",
  });
  assert(comment.status === 200, `/api/comment expected 200, got ${comment.status}`);
  assert(remotePreviewComments.length === 1, "Preview comments should write to Butterbase");
  assert(remoteTasks.length === 1, "Preview comment task should sync to remote Butterbase tasks");
  await waitFor(
    () => remoteMemoryEntries.some((entry) => entry.source === "XTrace"),
    "Preview comment memory should mirror to Butterbase memory_entries",
  );
  assert(
    findRequest(
      "/api/forgecloud/tables/preview_comments",
      (request) => request.method === "POST" && request.body?.selector === "#vip-card",
    )?.authorization === "Bearer butterbase-smoke-key",
    "Butterbase preview comment writes should use bearer auth",
  );

  const composio = await call("POST", "/api/connect", {
    provider: "slack",
    account: "Pleasure Pizza HQ",
  });
  assert(composio.status === 200, `/api/connect expected 200, got ${composio.status}`);
  assert(
    composio.json.connection?.status === "pending",
    "Live Composio connection should return pending OAuth state",
  );
  assert(
    composio.json.connection?.connect_url?.includes("composio.example.test"),
    "Live Composio connection should expose redirect URL",
  );
  assert(
    findRequest("/connected_accounts/link")?.xApiKey === "composio-smoke-key",
    "Composio link request should use x-api-key",
  );
  assert(
    remoteConnections.some(
      (connection) => connection.provider === "slack" && connection.status === "pending",
    ),
    "Composio connect should sync pending connection state to remote Butterbase",
  );
  const disconnect = await call("POST", "/api/disconnect", { provider: "slack" });
  assert(disconnect.status === 200, `/api/disconnect expected 200, got ${disconnect.status}`);
  assert(
    remoteConnections.find((connection) => connection.provider === "slack")?.status === "available",
    "Composio disconnect should sync available connection state to remote Butterbase",
  );

  const teamAdd = await call("POST", "/api/team", {
    displayName: "Nina Ops",
    role: "reviewer",
    email: "nina@example.com",
  });
  assert(teamAdd.status === 200, `/api/team POST expected 200, got ${teamAdd.status}`);
  const teamMemberId = teamAdd.json.member?.id;
  assert(teamMemberId, "Team invite should return a member id");
  assert(
    remoteUsers.some((user) => user.email === "nina@example.com"),
    "Team invite should sync the invited user to remote Butterbase",
  );
  assert(
    remoteTeamMembers.some((member) => member.id === teamMemberId && member.role === "reviewer"),
    "Team invite should sync the team member to remote Butterbase",
  );
  const teamList = await call("GET", "/api/team");
  assert(teamList.status === 200, `/api/team GET expected 200, got ${teamList.status}`);
  assert(
    teamList.json.some((member) => member.id === teamMemberId),
    "/api/team should read team members from remote Butterbase",
  );
  const teamRemove = await call("DELETE", `/api/team/${encodeURIComponent(teamMemberId)}`);
  assert(teamRemove.status === 200, `/api/team DELETE expected 200, got ${teamRemove.status}`);
  assert(
    !remoteTeamMembers.some((member) => member.id === teamMemberId),
    "Team removal should delete the member from remote Butterbase",
  );

  const db = new Database(process.env.INSFORGE_DB_PATH);
  const backlogTask = db
    .prepare(
      "SELECT id, assigned_agent_id FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC",
    )
    .get("proj-pleasure-pizza");
  assert(backlogTask?.id, "Seeded DB should have a backlog task");

  const run = await call("POST", "/api/run-task", { taskId: backlogTask.id });
  assert(
    run.status === 200,
    `/api/run-task expected 200, got ${run.status}: ${JSON.stringify(run.json)}`,
  );
  const rocketRideRequest = findRequest(
    "/rocketride",
    (request) => request.body?.workflowType === "run_task",
  );
  assert(rocketRideRequest, "Rocket Ride webhook should be called during run-task");
  assert(
    rocketRideRequest.authorization === "Bearer rocketride-smoke-key",
    "Rocket Ride webhook should use bearer auth",
  );
  assert(
    rocketRideRequest.body?.workflowType === "run_task",
    "Rocket Ride webhook should receive run_task workflow type",
  );
  assert(
    remotePullRequests.length >= 1,
    "Run task should sync generated pull requests to remote Butterbase",
  );
  assert(
    remoteChanges.some((change) =>
      remotePullRequests.some((pr) => pr.task_id === backlogTask.id && pr.id === change.pr_id),
    ),
    "Run task should sync generated PR change rows to remote Butterbase",
  );
  assert(
    remoteTasks.some((task) => task.id === backlogTask.id && task.linked_pr_id),
    "Run task should sync updated task PR linkage to remote Butterbase",
  );
  assert(
    remoteAgentRuns.some((run) => run.task_id === backlogTask.id && run.status === "completed"),
    "Run task should sync completed agent_runs to remote Butterbase",
  );
  assert(
    remoteRuntimeChecks.some(
      (check) => check.task_id === backlogTask.id && check.status === "passed",
    ),
    "Run task should sync runtime_checks to remote Butterbase",
  );
  assert(
    remoteRocketRideRuns.some((rr) => rr.workflow_type === "run_task" && rr.status === "completed"),
    "Run task should sync RocketRide workflow runs to remote Butterbase",
  );
  assert(
    findRequest(
      "/api/forgecloud/tables/projects",
      (request) => request.method === "POST" && request.body?.id === "proj-pleasure-pizza",
    ),
    "Run task should sync project metadata/status to remote Butterbase",
  );
  const agentRuns = await call(
    "GET",
    `/api/agent-runs?agentId=${encodeURIComponent(backlogTask.assigned_agent_id)}`,
  );
  assert(agentRuns.status === 200, `/api/agent-runs expected 200, got ${agentRuns.status}`);
  assert(
    agentRuns.json.some(
      (run) =>
        run.task_id === backlogTask.id &&
        run.runtimeChecks?.some((check) => check.status === "passed"),
    ),
    "/api/agent-runs should read agent activity and runtime checks from remote Butterbase",
  );
  const prId = remotePullRequests[0]?.id;
  assert(prId, "Run task should create a PR id");

  const edits = await call("POST", "/api/request-edits", {
    prId,
    message: "Tighten the mobile spacing before approval.",
  });
  assert(edits.status === 200, `/api/request-edits expected 200, got ${edits.status}`);
  assert(
    remotePullRequests.find((pr) => pr.id === prId)?.status === "changes_requested",
    "Request edits should sync PR status to remote Butterbase",
  );
  assert(
    remoteTasks.some((task) => task.title?.startsWith("Edits requested on PR")),
    "Request edits should sync the follow-up task to remote Butterbase",
  );

  const approval = await call("POST", "/api/approve-pr", { prId, approverName: "Sal" });
  assert(approval.status === 200, `/api/approve-pr expected 200, got ${approval.status}`);
  assert(
    remotePullRequests.find((pr) => pr.id === prId)?.status === "approved",
    "Approve PR should sync PR status to remote Butterbase",
  );
  const prs = await call("GET", "/api/prs");
  assert(prs.status === 200, `/api/prs expected 200, got ${prs.status}`);
  assert(
    prs.json.some((pr) => pr.id === prId && pr.status === "approved"),
    "/api/prs should read PR lifecycle state from remote Butterbase",
  );

  const deploy = await call("POST", "/api/deploy", { environment: "preview" });
  assert(deploy.status === 200, `/api/deploy expected 200, got ${deploy.status}`);
  assert(
    remoteDeployments.some((deployment) => deployment.id === deploy.json.deploymentId),
    "Deploy should sync deployment records to remote Butterbase",
  );
  const deployments = await call("GET", "/api/deployments");
  assert(deployments.status === 200, `/api/deployments expected 200, got ${deployments.status}`);
  assert(
    deployments.json.some((deployment) => deployment.id === deploy.json.deploymentId),
    "/api/deployments should read deployment rows from remote Butterbase",
  );

  const blame = await call("POST", "/api/blame", {
    label: "VIP customer card",
    selector: "#vip-card",
  });
  assert(blame.status === 200, `/api/blame expected 200, got ${blame.status}`);
  assert(
    blame.json.xtraceMode === "hybrid",
    "XTrace should report hybrid mode when remote replies",
  );
  assert(
    blame.json.provenance?.some((item) => item.label === "Remote XTrace memory"),
    "Blame provenance should include remote XTrace records",
  );
  const xtraceRequest = findRequest(
    "/xtrace",
    (request) => request.body?.operation === "memory.search",
  );
  assert(xtraceRequest, "XTrace search webhook should be called by blame");
  assert(
    xtraceRequest.authorization === "Bearer xtrace-smoke-key",
    "XTrace search should use bearer auth",
  );

  assert(
    findRequest("/api/forgecloud/tables/projects/proj-pleasure-pizza")?.authorization ===
      "Bearer butterbase-smoke-key",
    "Remote Butterbase project lookup should use bearer auth",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mockBaseUrl,
        butterbase: "remote health and project lookup",
        chatMessages: remoteChatMessages.length,
        previewComments: remotePreviewComments.length,
        tasks: remoteTasks.length,
        pullRequests: remotePullRequests.length,
        changes: remoteChanges.length,
        approvals: remoteApprovals.length,
        recoveryEvents: remoteRecoveryEvents.length,
        agentRuns: remoteAgentRuns.length,
        runtimeChecks: remoteRuntimeChecks.length,
        rocketRideRuns: remoteRocketRideRuns.length,
        deployments: remoteDeployments.length,
        projects: remoteProjects.length,
        teamMembers: remoteTeamMembers.length,
        users: remoteUsers.length,
        connections: remoteConnections.length,
        discoveries: remoteDiscoveries.length,
        suggestedApps: remoteSuggestedApps.length,
        notifications: remoteNotifications.length,
        branches: remoteBranches.length,
        commits: remoteCommits.length,
        worktrees: remoteWorktrees.length,
        agents: remoteAgents.length,
        activityEvents: remoteActivityEvents.length,
        memoryEntries: remoteMemoryEntries.length,
        composio: composio.json.connection.status,
        rocketRide: rocketRideRequest.body.workflowType,
        xtrace: blame.json.xtraceMode,
        requests: requests.length,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
