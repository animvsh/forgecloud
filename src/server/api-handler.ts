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
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join as pathJoin } from "node:path";
import { z } from "zod";

import { ensureSeed, ids, scaffoldDemoProject, populateDemoData } from "../lib/seed";
import {
  getDb,
  getDbPath,
  type AuthSession,
  type Branch,
  type ChatMessage,
  type Connection,
  type Change,
  type Discovery,
  type Project,
  type PullRequest,
  type SuggestedApp,
  type Task,
  type TeamMember,
  type User,
  type Workspace,
} from "../lib/db";
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
  classifyChatIntent,
  generateBuildPlan,
  isAiAvailable,
} from "../lib/ai";
import type { BuildPlan } from "../lib/ai";
import { log, newRequestId } from "../lib/logger";
import { clientKey, consume, RATE_CONFIGS, type RateLimitConfig } from "../lib/rate-limit";
import {
  getDeploymentConfig,
  getPublicDeploymentConfig,
  getPublicStackConfig,
  isLiveStackRequired,
  type DeployProvider,
} from "../lib/config.server";
import {
  getButterbaseRepository,
  getButterbaseStatus,
  validateButterbaseReadiness,
} from "../lib/butterbase.server";
import {
  connectViaComposio,
  disconnectViaComposio,
  getComposioStatus,
  scanWithComposio,
} from "../lib/composio.server";
import {
  getRocketRideStatus,
  listRocketRideRuns,
  applyRocketRideCallback,
  RocketRideCallbackSchema,
  runRocketRideWorkflow,
  verifyRocketRideCallbackAuth,
} from "../lib/rocketride.server";
import { searchXTraceMemory, storeXTraceMemory } from "../lib/xtrace.server";
import {
  checkEntitlement,
  getEntitlementSnapshot,
  recordUsageEvent,
  type EntitlementAction,
  type UsageKind,
} from "../lib/entitlements";
import { getRuntimeArtifactRoot } from "../lib/runtime";
import {
  archiveBranch,
  createNotification,
  listBranches,
  listCommits,
  listWorktrees,
  mergeBranch,
  recordCommit,
  spawnWorktree,
} from "../lib/vcs";
import { getProvider } from "../lib/providers";
import { emitStackEvent } from "../lib/stack.server";

const SERVER_STARTED_AT = Date.now();
const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";
const DEMO_PROJECT_ID = "proj-pleasure-pizza";

type AuthContext = {
  userId: string;
  workspaceId: string;
  role: string;
  devFallback: boolean;
  sessionId: string | null;
  sessionExpiresAt: number | null;
};

type PublicSession = {
  authenticated: boolean;
  user: { id: string; name: string; email: string; role: string } | null;
  workspace: { id: string; name: string; plan: string } | null;
  role: string | null;
  permissions: Permission[];
  devFallback: boolean;
};

const authContext = new AsyncLocalStorage<AuthContext>();

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseCookie(req: IncomingMessage, name: string): string | undefined {
  const cookie = getHeader(req, "cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function signSessionPayload(
  sessionId: string,
  userId: string,
  workspaceId: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${sessionId}.${userId}.${workspaceId}`)
    .digest("base64url");
}

function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

function hashLoginCode(email: string, workspaceId: string, code: string): string {
  const secret = process.env.AUTH_SESSION_SECRET ?? "dev-login-code-secret";
  return createHmac("sha256", secret)
    .update(`${email.toLowerCase()}.${workspaceId}.${code}`)
    .digest("base64url");
}

function verifySessionToken(
  token: string,
  secret: string,
): { sessionId: string; userId: string; workspaceId: string } | null {
  const [sessionId, userId, workspaceId, signature, ...extra] = token.split(".");
  if (extra.length > 0 || !sessionId || !userId || !workspaceId || !signature) return null;
  const expected = signSessionPayload(sessionId, userId, workspaceId, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  return { sessionId, userId, workspaceId };
}

function createSessionToken(
  userId: string,
  workspaceId: string,
  req?: IncomingMessage,
): { token: string; sessionId: string; expiresAt: number } {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is required to mint a test session");
  ensureSeed();
  const d = getDb();
  const sessionId = `sess-${randomUUID()}`;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = signSessionPayload(sessionId, userId, workspaceId, secret);
  const token = `${sessionId}.${userId}.${workspaceId}.${signature}`;
  d.prepare(
    `INSERT INTO auth_sessions
       (id, user_id, workspace_id, token_hash, created_at, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    userId,
    workspaceId,
    hashSessionToken(token, secret),
    Date.now(),
    expiresAt,
    req ? (getHeader(req, "user-agent") ?? null) : null,
    req
      ? (getHeader(req, "x-forwarded-for")?.split(",")[0]?.trim() ??
          req.socket.remoteAddress ??
          null)
      : null,
  );
  return { token, sessionId, expiresAt };
}

export function sessionTokenForSmoke(userId: string, workspaceId: string): string {
  return createSessionToken(userId, workspaceId).token;
}

function sessionTokenForUser(
  userId: string,
  workspaceId: string,
  req: IncomingMessage,
): { token: string; sessionId: string; expiresAt: number } {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret)
    throw Object.assign(new Error("AUTH_SESSION_SECRET is required"), { statusCode: 500 });
  return createSessionToken(userId, workspaceId, req);
}

function cookieSecureFlag(req: IncomingMessage): boolean {
  const proto = getHeader(req, "x-forwarded-proto");
  return process.env.NODE_ENV === "production" || proto === "https";
}

function sessionCookie(token: string, req: IncomingMessage): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = cookieSecureFlag(req) ? "; Secure" : "";
  return `fc_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie(req: IncomingMessage): string {
  const secure = cookieSecureFlag(req) ? "; Secure" : "";
  return `fc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function isLocalHostHeader(req: IncomingMessage): boolean {
  const host = getHeader(req, "host") ?? "";
  if (!host) return true;
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}

function allowDevAuthFallback(req: IncomingMessage): boolean {
  if (process.env.ALLOW_DEV_AUTH_FALLBACK === "true") return true;
  if (process.env.NODE_ENV === "production" || process.env.AUTH_REQUIRED === "true") return false;
  return isLocalHostHeader(req);
}

async function resolveAuthContext(req: IncomingMessage): Promise<AuthContext> {
  ensureSeed();
  const d = getDb();
  const secret = process.env.AUTH_SESSION_SECRET;
  const token = getHeader(req, "x-forgecloud-session") ?? parseCookie(req, "fc_session");
  const productionAuthRequired =
    process.env.NODE_ENV === "production" || process.env.AUTH_REQUIRED === "true";

  if (secret && token) {
    const parsed = verifySessionToken(token, secret);
    if (!parsed) throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
    const now = Date.now();
    const session = d
      .prepare(
        `SELECT * FROM auth_sessions
          WHERE id = ?
            AND user_id = ?
            AND workspace_id = ?
          LIMIT 1`,
      )
      .get(parsed.sessionId, parsed.userId, parsed.workspaceId) as AuthSession | undefined;
    if (
      !session ||
      session.revoked_at !== null ||
      session.expires_at <= now ||
      session.token_hash !== hashSessionToken(token, secret)
    ) {
      throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
    }
    const membership = d
      .prepare(
        `SELECT tm.role
           FROM team_members tm
           JOIN workspaces w ON w.id = tm.workspace_id
          WHERE tm.workspace_id = ?
            AND (tm.user_id = ? OR w.owner_id = ?)`,
      )
      .get(parsed.workspaceId, parsed.userId, parsed.userId) as { role: string } | undefined;
    if (!membership) throw Object.assign(new Error("Workspace access denied"), { statusCode: 403 });
    d.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
    return {
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      role: membership.role,
      devFallback: false,
      sessionId: session.id,
      sessionExpiresAt: session.expires_at,
    };
  }

  if (productionAuthRequired || !allowDevAuthFallback(req)) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }

  return {
    userId: ids.user,
    workspaceId: ids.workspace,
    role: "owner",
    devFallback: true,
    sessionId: null,
    sessionExpiresAt: null,
  };
}

function currentAuth(): AuthContext {
  const ctx = authContext.getStore();
  if (!ctx)
    return {
      userId: ids.user,
      workspaceId: ids.workspace,
      role: "owner",
      devFallback: true,
      sessionId: null,
      sessionExpiresAt: null,
    };
  return ctx;
}

function currentWorkspaceId(): string {
  return currentAuth().workspaceId;
}

function currentUserId(): string {
  return currentAuth().userId;
}

function mirrorProjectForLocalRuntime(project: Project) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO projects
         (id, workspace_id, name, description, status, repo_url, cloudflare_project_id, insforge_project_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      project.workspace_id,
      project.name,
      project.description ?? null,
      project.status,
      project.repo_url ?? null,
      project.cloudflare_project_id ?? null,
      project.insforge_project_id ?? null,
      project.created_at ?? Date.now(),
    );
}

async function syncTasksToButterbase(tasks: Task[]) {
  if (tasks.length === 0) return;
  const butterbase = getButterbaseRepository();
  if (butterbase.mode !== "remote") return;
  await Promise.all(tasks.map((task) => butterbase.syncTask(task)));
}

async function syncProjectReviewArtifactsToButterbase(projectId: string) {
  const butterbase = getButterbaseRepository();
  if (butterbase.mode !== "remote") return;
  const d = getDb();
  const project = d.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | Project
    | undefined;
  const agents = d
    .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Array<Parameters<typeof butterbase.syncAgent>[0]>;
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Task[];
  const prs = d
    .prepare("SELECT * FROM pull_requests WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as PullRequest[];
  const changes = d
    .prepare(
      `SELECT c.*
         FROM changes c
         JOIN pull_requests pr ON pr.id = c.pr_id
        WHERE pr.project_id = ?
        ORDER BY c.id ASC`,
    )
    .all(projectId) as Change[];
  const approvals = d
    .prepare("SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Array<Parameters<typeof butterbase.syncApproval>[0]>;
  const recoveryEvents = d
    .prepare("SELECT * FROM recovery_events WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Array<Parameters<typeof butterbase.syncRecoveryEvent>[0]>;
  const agentRuns = d
    .prepare("SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC")
    .all(projectId) as Array<Parameters<typeof butterbase.syncAgentRun>[0]>;
  const runtimeChecks = d
    .prepare("SELECT * FROM runtime_checks WHERE project_id = ? ORDER BY started_at ASC")
    .all(projectId) as Array<Parameters<typeof butterbase.syncRuntimeCheck>[0]>;
  const rocketRideWorkflowRuns = listRocketRideRuns(projectId, 100);
  const branches = listBranches(projectId);
  const commits = listCommits(projectId);
  const worktrees = listWorktrees(projectId);
  await Promise.all([
    ...(project ? [butterbase.syncProject(project)] : []),
    ...agents.map((agent) => butterbase.syncAgent(agent)),
    ...tasks.map((task) => butterbase.syncTask(task)),
    ...prs.map((pr) => butterbase.syncPullRequest(pr)),
    ...changes.map((change) => butterbase.syncChange(change)),
    ...approvals.map((approval) => butterbase.syncApproval(approval)),
    ...recoveryEvents.map((event) => butterbase.syncRecoveryEvent(event)),
    ...agentRuns.map((run) => butterbase.syncAgentRun(run)),
    ...runtimeChecks.map((check) => butterbase.syncRuntimeCheck(check)),
    ...rocketRideWorkflowRuns.map((run) => butterbase.syncRocketRideWorkflowRun(run)),
    ...branches.map((branch) => butterbase.syncBranch(branch)),
    ...commits.map((commit) => butterbase.syncCommit(commit)),
    ...worktrees.map((worktree) => butterbase.syncWorktree(worktree)),
  ]);
}

async function syncDeploymentToButterbase(deploymentId: string) {
  const butterbase = getButterbaseRepository();
  if (butterbase.mode !== "remote") return;
  const deployment = getDb().prepare("SELECT * FROM deployments WHERE id = ?").get(deploymentId) as
    | Parameters<typeof butterbase.syncDeployment>[0]
    | undefined;
  if (deployment) await butterbase.syncDeployment(deployment);
}

function recordActivity(input: {
  projectId: string;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  taskId?: string | null;
  prId?: string | null;
  deploymentId?: string | null;
  tool?: "RocketRide" | "Butterbase" | "XTrace" | "Composio" | string | null;
}) {
  void getButterbaseRepository()
    .recordActivity(input)
    .catch((error: Error) => {
      log.warn("activity_record_failed", {
        projectId: input.projectId,
        eventType: input.eventType,
        error: error.message,
      });
    });
  const key = stackKeyForTool(input.tool);
  if (key) {
    emitStackEvent(key, {
      eventType: input.eventType,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      linkedTaskId: input.taskId ?? null,
      linkedPrId: input.prId ?? null,
      linkedDeploymentId: input.deploymentId ?? null,
      metadata: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
      },
    });
  }
}

function recordMemory(input: {
  projectId: string;
  source: "XTrace" | "Butterbase" | "RocketRide" | "Composio" | string;
  title: string;
  body: string;
  taskId?: string | null;
  prId?: string | null;
  confidence?: string;
}) {
  try {
    const butterbase = getButterbaseRepository();
    if (butterbase.mode === "remote") {
      void butterbase.recordMemory(input).catch((error: Error) => {
        log.warn("butterbase_memory_record_failed", {
          projectId: input.projectId,
          source: input.source,
          error: error.message,
        });
      });
    }
    storeXTraceMemory(getDb(), {
      projectId: input.projectId,
      source: input.source,
      title: input.title,
      body: input.body,
      taskId: input.taskId ?? null,
      prId: input.prId ?? null,
      confidence: input.confidence ?? "stored",
    });
  } catch (error) {
    log.warn("memory_record_failed", {
      projectId: input.projectId,
      source: input.source,
      error: (error as Error).message,
    });
  }
  emitStackEvent("xtrace", {
    eventType: "memory_stored",
    projectId: input.projectId,
    title: input.title,
    description: input.body,
    linkedTaskId: input.taskId ?? null,
    linkedPrId: input.prId ?? null,
    metadata: {
      source: input.source,
      confidence: input.confidence ?? "stored",
    },
  });
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function stackKeyForTool(tool: string | null | undefined) {
  if (tool === "RocketRide") return "rocketride";
  if (tool === "Butterbase") return "butterbase";
  if (tool === "XTrace") return "xtrace";
  if (tool === "Composio") return "composio";
  return null;
}

function clientIp(req: IncomingMessage): string | null {
  return (
    getHeader(req, "x-forwarded-for")?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null
  );
}

function allowedCorsOrigins(): Set<string> {
  const explicit = (process.env.FORGECLOUD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const configured = [
    process.env.PUBLIC_APP_URL,
    process.env.CLOUDFLARE_PROJECT_URL,
    process.env.RAILWAY_SERVICE_URL,
  ]
    .map((origin) => origin?.trim().replace(/\/+$/, ""))
    .filter((origin): origin is string => Boolean(origin));
  return new Set([...explicit, ...configured]);
}

function isAllowedCorsOrigin(origin: string, allowed: Set<string>): boolean {
  if (allowed.has(origin)) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  for (const configured of allowed) {
    let configuredUrl: URL;
    try {
      configuredUrl = new URL(configured);
    } catch {
      continue;
    }

    const configuredHost = configuredUrl.hostname;
    const isCloudflarePagesProject = configuredHost.endsWith(".pages.dev");
    const isProjectPreview =
      isCloudflarePagesProject && originUrl.hostname.endsWith(`.${configuredHost}`);

    if (originUrl.protocol === configuredUrl.protocol && isProjectPreview) {
      return true;
    }
  }

  return false;
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = getHeader(req, "origin")?.replace(/\/+$/, "");
  if (!origin) return;
  const allowed = allowedCorsOrigins();
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (
    !isAllowedCorsOrigin(origin, allowed) &&
    process.env.NODE_ENV === "production" &&
    !isLocalhost
  )
    return;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-forgecloud-session");
  res.setHeader("vary", "Origin");
}

type Permission =
  | "member"
  | "build"
  | "review"
  | "deploy_preview"
  | "deploy_production"
  | "manage_team"
  | "manage_integrations"
  | "manage_branches"
  | "admin";

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: [
    "member",
    "build",
    "review",
    "deploy_preview",
    "deploy_production",
    "manage_team",
    "manage_integrations",
    "manage_branches",
    "admin",
  ],
  admin: [
    "member",
    "build",
    "review",
    "deploy_preview",
    "deploy_production",
    "manage_team",
    "manage_integrations",
    "manage_branches",
    "admin",
  ],
  manager: [
    "member",
    "build",
    "review",
    "deploy_preview",
    "manage_integrations",
    "manage_branches",
  ],
  staff: ["member", "build", "deploy_preview"],
  reviewer: ["member", "review"],
  viewer: ["member"],
};

function hasPermission(permission: Permission, role = currentAuth().role): boolean {
  return (ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer).includes(permission);
}

function requirePermission(permission: Permission): void {
  if (!hasPermission(permission)) {
    throw Object.assign(new Error(`Forbidden: requires ${permission}`), { statusCode: 403 });
  }
}

function publicSessionFor(ctx: AuthContext | null): PublicSession {
  if (!ctx) {
    return {
      authenticated: false,
      user: null,
      workspace: null,
      role: null,
      permissions: [],
      devFallback: false,
    };
  }
  const d = getDb();
  const user = d.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(ctx.userId) as
    | { id: string; name: string; email: string; role: string }
    | undefined;
  const workspace = d
    .prepare("SELECT id, name, plan FROM workspaces WHERE id = ?")
    .get(ctx.workspaceId) as { id: string; name: string; plan: string } | undefined;
  return {
    authenticated: true,
    user: user ?? null,
    workspace: workspace ?? null,
    role: ctx.role,
    permissions: ROLE_PERMISSIONS[ctx.role] ?? ROLE_PERMISSIONS.viewer,
    devFallback: ctx.devFallback,
  };
}

async function optionalAuthContext(req: IncomingMessage): Promise<AuthContext | null> {
  try {
    return await resolveAuthContext(req);
  } catch {
    return null;
  }
}

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
  res.statusCode = status;
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

function recordAuditEvent(input: {
  requestId: string;
  req: IncomingMessage;
  route: string;
  permission?: Permission;
  auth?: AuthContext | null;
  outcome: "success" | "failure";
  statusCode: number;
  error?: string | null;
}) {
  if (input.req.method === "GET") return;
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_events (
          id, request_id, workspace_id, user_id, route, method, permission,
          outcome, status_code, error, ip_address, user_agent, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `aud-${randomUUID()}`,
        input.requestId,
        input.auth?.workspaceId ?? null,
        input.auth?.userId ?? null,
        input.route,
        input.req.method ?? "UNKNOWN",
        input.permission ?? null,
        input.outcome,
        input.statusCode,
        input.error ?? null,
        clientIp(input.req),
        getHeader(input.req, "user-agent") ?? null,
        Date.now(),
      );
  } catch (err) {
    log.warn("audit_event_write_failed", {
      requestId: input.requestId,
      route: input.route,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function sendEntitlementDenied(
  res: ServerResponse,
  requestId: string,
  decision: Exclude<ReturnType<typeof checkEntitlement>, { allowed: true }>,
) {
  sendJson(
    res,
    decision.error === "billing_inactive" ? 402 : 429,
    {
      error: decision.error,
      message: decision.message,
      resource: decision.resource,
      plan: decision.plan,
      billingStatus: decision.billingStatus,
      limit: decision.limit,
      used: decision.used,
      requested: decision.requested,
      usage: decision.snapshot.usage,
    },
    requestId,
  );
}

async function entitlementQuantity(action: EntitlementAction, pathname: string): Promise<number> {
  if (action === "create_task") {
    if (pathname === "/api/intake") return 6;
    if (pathname === "/api/build-app") return 3;
    return 1;
  }
  if (action === "run_agent") {
    if (pathname === "/api/run-task") return 1;
    const projectId = await getCurrentProjectId();
    const row = getDb()
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND status = 'backlog'")
      .get(projectId) as { count: number } | undefined;
    return Math.max(1, Number(row?.count ?? 1));
  }
  return 1;
}

function usageKindFor(action?: EntitlementAction): UsageKind | null {
  if (action === "create_task") return "task";
  if (action === "run_agent") return "agent_run";
  return null;
}

async function getCurrentProjectId(): Promise<string> {
  ensureSeed();
  const butterbase = getButterbaseRepository();
  // Honor the workspace's active-project preference if it points at a real project.
  const activeProjectId = await butterbase.getActiveProjectId(currentWorkspaceId());
  if (activeProjectId) {
    const row = await butterbase.getProject(activeProjectId);
    if (row?.workspace_id === currentWorkspaceId()) return row.id;
  }
  const demo = await butterbase.getProject(ids.demoProject);
  if (demo?.workspace_id === currentWorkspaceId()) return demo.id;
  const row = (await butterbase.listProjects(currentWorkspaceId()))[0];
  if (row) return row.id;
  const id = ids.newProject();
  const project = await butterbase.createProject({
    id,
    workspaceId: currentWorkspaceId(),
    name: "Untitled Project",
    description: "Created automatically",
    status: "intake",
  });
  mirrorProjectForLocalRuntime(project);
  await butterbase.setActiveProjectId(currentWorkspaceId(), id);
  const agents = createAgentsForProject(id);
  if (butterbase.mode === "remote") {
    await Promise.all(agents.map((agent) => butterbase.syncAgent(agent)));
  }
  return id;
}

function getScopedApproval(id: string):
  | {
      id: string;
      project_id: string;
      pr_id: string | null;
      reason: string;
      risk_level: string;
      details: string;
      status: string;
    }
  | undefined {
  return getDb()
    .prepare(
      `SELECT a.*
         FROM approvals a
         JOIN projects p ON p.id = a.project_id
        WHERE a.id = ?
          AND p.workspace_id = ?`,
    )
    .get(id, currentWorkspaceId()) as
    | {
        id: string;
        project_id: string;
        pr_id: string | null;
        reason: string;
        risk_level: string;
        details: string;
        status: string;
      }
    | undefined;
}

function getScopedPullRequest(id: string): PullRequest | undefined {
  return getDb()
    .prepare(
      `SELECT pr.*
         FROM pull_requests pr
         JOIN projects p ON p.id = pr.project_id
        WHERE pr.id = ?
          AND p.workspace_id = ?`,
    )
    .get(id, currentWorkspaceId()) as PullRequest | undefined;
}

function getScopedBranch(id: string): Branch | undefined {
  return getDb()
    .prepare(
      `SELECT b.*
         FROM branches b
         JOIN projects p ON p.id = b.project_id
        WHERE b.id = ?
          AND p.workspace_id = ?`,
    )
    .get(id, currentWorkspaceId()) as Branch | undefined;
}

// Compute risk-check matrix for a PR from recovery_events + approvals.
type RiskCheckResult = "pass" | "fail" | "pending" | "n/a";
function computeRiskChecks(prId: string): {
  build: RiskCheckResult;
  qa: RiskCheckResult;
  secretScan: RiskCheckResult;
  migration: RiskCheckResult;
  previewDeploy: RiskCheckResult;
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
  if (!pr)
    return { build: "n/a", qa: "n/a", secretScan: "n/a", migration: "n/a", previewDeploy: "n/a" };

  const isBlocked = pr.status === "blocked";
  const isRolledBack = pr.status === "rolled_back";
  const runtimeChecks = pr.task_id
    ? (d
        .prepare(
          `SELECT check_type, status FROM runtime_checks
            WHERE task_id = ?
            ORDER BY started_at ASC`,
        )
        .all(pr.task_id) as { check_type: string; status: string }[])
    : [];
  const runtimeFailed = runtimeChecks.some((check) => check.status === "failed");
  const checkPassed = (type: string) =>
    runtimeChecks.some((check) => check.check_type === type && check.status === "passed");
  const checkFailed = (type: string) =>
    runtimeChecks.some((check) => check.check_type === type && check.status === "failed");

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

  // Preview deploy: derived from the latest deployment linked to this PR.
  // - fail  -> latest preview deploy failed
  // - pass  -> at least one preview deploy succeeded
  // - pending -> a preview deploy exists but is still queued/building
  // - n/a   -> no preview deploy recorded for this PR yet
  const latestDeployment = d
    .prepare(
      `SELECT environment, status FROM deployments
        WHERE pr_id = ? AND environment = 'preview'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(prId) as { environment: string; status: string } | undefined;
  const previewDeploy: RiskCheckResult = (() => {
    if (!latestDeployment) return "n/a";
    if (latestDeployment.status === "failed") return "fail";
    if (latestDeployment.status === "live") return "pass";
    return "pending";
  })();

  return {
    build:
      isBlocked || isRolledBack || runtimeFailed
        ? "fail"
        : checkPassed("artifact_manifest")
          ? "pass"
          : "pending",
    qa: isBlocked ? "fail" : "pass",
    // Per-PR scan: only the actually-blocked PR fails the scan.
    secretScan:
      isBlocked || checkFailed("secret_scan")
        ? "fail"
        : checkPassed("secret_scan")
          ? "pass"
          : "pending",
    migration: isHighRisk
      ? approvedThisPr
        ? "pass"
        : pendingApproval
          ? "pending"
          : "pending"
      : "n/a",
    previewDeploy,
  };
}

type DeploymentEnvironment = "preview" | "staging" | "production";

type DeploymentCheck = {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  details?: unknown;
};

function getDeploymentReadiness(projectId: string) {
  const d = getDb();
  const config = getPublicDeploymentConfig();
  const pendingApprovals = d
    .prepare(
      `SELECT id, reason, risk_level FROM approvals WHERE project_id = ? AND status = 'pending'`,
    )
    .all(projectId) as { id: string; reason: string; risk_level: string }[];
  const approvedPrs = d
    .prepare(
      `SELECT id, title, risk_level FROM pull_requests
       WHERE project_id = ? AND status IN ('approved', 'merged') AND rolled_back_at IS NULL`,
    )
    .all(projectId) as { id: string; title: string; risk_level: string }[];
  const unresolvedRecovery = d
    .prepare(
      `SELECT id, failure_type, failure_message, status FROM recovery_events
       WHERE project_id = ? AND status != 'recovered'`,
    )
    .all(projectId) as {
    id: string;
    failure_type: string;
    failure_message: string;
    status: string;
  }[];
  const blockedSecretEvents = d
    .prepare(
      `SELECT id, failure_type, failure_message, status FROM recovery_events
       WHERE project_id = ? AND failure_type = 'secret_detected' AND status = 'blocked'`,
    )
    .all(projectId) as {
    id: string;
    failure_type: string;
    failure_message: string;
    status: string;
  }[];

  const checks: DeploymentCheck[] = [
    {
      key: "provider_config",
      label:
        config.mode === "production"
          ? `${config.provider} deploy provider configured`
          : "Production deploys are in simulation mode",
      passed: config.productionReady,
      blocking: true,
      details: config.missing.length > 0 ? { missing: config.missing } : undefined,
    },
    {
      key: "approved_changes",
      label: `${approvedPrs.length} approved change${approvedPrs.length === 1 ? "" : "s"}`,
      passed: approvedPrs.length > 0,
      blocking: true,
    },
    {
      key: "pending_approvals",
      label:
        pendingApprovals.length === 0
          ? "No pending approvals"
          : `${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? "" : "s"}`,
      passed: pendingApprovals.length === 0,
      blocking: true,
      details: pendingApprovals.length > 0 ? pendingApprovals : undefined,
    },
    {
      key: "recovery_clear",
      label:
        unresolvedRecovery.length === 0
          ? "No unresolved recovery events"
          : `${unresolvedRecovery.length} unresolved recovery event${unresolvedRecovery.length === 1 ? "" : "s"}`,
      passed: unresolvedRecovery.length === 0,
      blocking: true,
      details: unresolvedRecovery.length > 0 ? unresolvedRecovery : undefined,
    },
    {
      key: "secrets_clear",
      label:
        blockedSecretEvents.length === 0
          ? "No blocked secrets in approved work"
          : `${blockedSecretEvents.length} blocked secret event${blockedSecretEvents.length === 1 ? "" : "s"}`,
      passed: blockedSecretEvents.length === 0,
      blocking: true,
      details: blockedSecretEvents.length > 0 ? blockedSecretEvents : undefined,
    },
  ];

  return {
    config,
    checks,
    canDeployProduction: checks.every((check) => !check.blocking || check.passed),
  };
}

function simulatedDeployUrl(environment: DeploymentEnvironment): string {
  if (environment === "production") {
    return `https://sim-prod-${Math.random().toString(36).slice(2, 8)}.forgecloud.local`;
  }
  return `https://${environment}-${Math.random().toString(36).slice(2, 8)}.forgecloud.local`;
}

async function runConfiguredDeployment(
  projectId: string,
  prId: string | null,
  environment: DeploymentEnvironment,
): Promise<{
  provider: DeployProvider | "simulation";
  url: string;
  buildLogs: string;
  simulated: boolean;
}> {
  const config = getDeploymentConfig();
  if (config.mode === "simulation") {
    return {
      provider: "simulation",
      url: simulatedDeployUrl(environment),
      buildLogs: `Simulation mode: ${environment} deploy recorded locally. No hosting provider was called.`,
      simulated: true,
    };
  }
  if (!config.productionReady || !config.hookUrl) {
    throw Object.assign(new Error("Deployment provider is not configured"), {
      code: "deploy_not_configured",
      missing: config.missing,
    });
  }

  const deploymentRequestId = `deploy-request-${randomUUID()}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": deploymentRequestId,
  };
  if (config.hookToken) headers.authorization = `Bearer ${config.hookToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(config.hookUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        app: "forgecloud",
        projectId,
        prId,
        environment,
        version: APP_VERSION,
        deploymentRequestId,
        requestedAt: new Date().toISOString(),
      }),
    });
  } catch (err) {
    const timedOut = controller.signal.aborted;
    throw Object.assign(
      new Error(
        timedOut
          ? `${config.provider} deploy hook timed out`
          : `${config.provider} deploy hook failed`,
      ),
      {
        code: timedOut ? "deploy_hook_timeout" : "deploy_hook_unreachable",
        cause: err,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text.slice(0, 1000) };
    }
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(`${config.provider} deploy hook failed with ${response.status}`),
      {
        code: "deploy_hook_failed",
        status: response.status,
        body: parsed,
      },
    );
  }
  const returnedUrl =
    typeof parsed.url === "string"
      ? parsed.url
      : typeof parsed.deploymentUrl === "string"
        ? parsed.deploymentUrl
        : typeof parsed.webUrl === "string"
          ? parsed.webUrl
          : null;
  const providerDeploymentId =
    typeof parsed.deploymentId === "string"
      ? parsed.deploymentId
      : typeof parsed.id === "string"
        ? parsed.id
        : null;
  return {
    provider: config.provider,
    url: returnedUrl ?? config.publicUrl ?? "",
    buildLogs: JSON.stringify(
      {
        provider: config.provider,
        deploymentRequestId,
        providerDeploymentId,
        hookStatus: response.status,
        response: parsed,
      },
      null,
      2,
    ),
    simulated: false,
  };
}

// ---------- route handlers ---------------------------------------------------

type HealthCheck = {
  name: string;
  passed: boolean;
  detail?: string;
};

async function checkWritableDirectory(name: string, dir: string): Promise<HealthCheck> {
  const probePath = pathJoin(dir, `.forgecloud-health-${process.pid}-${Date.now()}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probePath, "ok", "utf8");
    await rm(probePath, { force: true });
    return { name, passed: true, detail: dir };
  } catch (err) {
    return {
      name,
      passed: false,
      detail: `${dir}: ${(err as Error).message}`,
    };
  }
}

function productionAuthReadinessChecks(deploymentMode: DeployMode): HealthCheck[] {
  const productionLike =
    deploymentMode === "production" ||
    process.env.NODE_ENV === "production" ||
    process.env.AUTH_REQUIRED === "true";
  if (!productionLike) {
    return [
      { name: "auth_session_secret", passed: true, detail: "production auth not required" },
      { name: "auth_login_delivery", passed: true, detail: "production auth not required" },
      { name: "auth_dev_fallback", passed: true, detail: "development fallback allowed locally" },
    ];
  }

  const sessionSecret = process.env.AUTH_SESSION_SECRET?.trim() ?? "";
  const loginWebhook = process.env.AUTH_LOGIN_WEBHOOK_URL?.trim() ?? "";
  const returnsLoginCodes = process.env.AUTH_LOGIN_RETURN_CODE === "true";
  const allowsDevFallback = process.env.ALLOW_DEV_AUTH_FALLBACK === "true";

  return [
    {
      name: "auth_session_secret",
      passed: sessionSecret.length >= 32,
      detail:
        sessionSecret.length >= 32
          ? "signed sessions configured"
          : "AUTH_SESSION_SECRET must be at least 32 characters for production",
    },
    {
      name: "auth_login_delivery",
      passed: Boolean(loginWebhook) && !returnsLoginCodes,
      detail: !loginWebhook
        ? "AUTH_LOGIN_WEBHOOK_URL is required for production login"
        : returnsLoginCodes
          ? "AUTH_LOGIN_RETURN_CODE must be false in production"
          : "passwordless login delivery configured",
    },
    {
      name: "auth_dev_fallback",
      passed: !allowsDevFallback,
      detail: allowsDevFallback
        ? "ALLOW_DEV_AUTH_FALLBACK must be false in production"
        : "unsigned dev auth fallback disabled",
    },
  ];
}

async function handleGetHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const d = getDb();
  const checks: HealthCheck[] = [];
  try {
    d.prepare("SELECT 1").get();
    checks.push({ name: "db_read", passed: true, detail: getDbPath() });
  } catch (err) {
    checks.push({ name: "db_read", passed: false, detail: (err as Error).message });
  }
  checks.push(await checkWritableDirectory("db_directory_write", dirname(getDbPath())));
  checks.push(await checkWritableDirectory("runtime_artifact_write", getRuntimeArtifactRoot()));

  const deployment = getPublicDeploymentConfig();
  checks.push(...productionAuthReadinessChecks(deployment.mode));
  const stack = getPublicStackConfig();
  checks.push({
    name: "deploy_config",
    passed: deployment.mode !== "production" || deployment.productionReady,
    detail:
      deployment.mode === "production" && deployment.missing.length > 0
        ? `missing ${deployment.missing.join(", ")}`
        : deployment.mode,
  });
  for (const service of stack.services) {
    const liveStackMissing = isLiveStackRequired() && !service.configured;
    checks.push({
      name: `stack_${service.key}`,
      passed: service.ready && !liveStackMissing,
      detail:
        service.missing.length > 0
          ? `missing ${service.missing.join(", ")}`
          : liveStackMissing
            ? `${service.label} must be configured because FORGECLOUD_REQUIRE_LIVE_STACK=true`
            : service.detail,
    });
  }
  checks.push({
    name: "live_stack_config",
    passed: !stack.liveRequired || stack.allLiveConfigured,
    detail: stack.liveRequired
      ? `${stack.liveConfiguredCount}/${stack.totalCount} live stack services configured`
      : "live stack not required",
  });
  try {
    const butterbaseCheck = await validateButterbaseReadiness();
    checks.push({
      name: "butterbase_source_of_truth",
      passed: butterbaseCheck.passed,
      detail: butterbaseCheck.detail,
    });
  } catch (err) {
    checks.push({
      name: "butterbase_source_of_truth",
      passed: false,
      detail: (err as Error).message,
    });
  }
  const butterbase = getButterbaseStatus();
  const composio = getComposioStatus();
  const rocketRide = getRocketRideStatus();
  const ok = checks.every((check) => check.passed);
  sendJson(
    res,
    ok ? 200 : 503,
    {
      ok,
      db: checks.find((check) => check.name === "db_read")?.passed ? "up" : "down",
      checks,
      provider: activeProviderName(),
      aiAvailable: isAiAvailable(),
      deployment,
      stack,
      butterbase,
      composio,
      rocketRide,
      uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      version: APP_VERSION,
      time: new Date().toISOString(),
    },
    requestId,
  );
}

const RequestLoginSchema = z.object({
  email: z.string().trim().email().max(160),
  workspaceId: z.string().trim().min(1).max(120).optional(),
});

async function deliverLoginCode(email: string, workspaceId: string, code: string): Promise<void> {
  const webhookUrl = process.env.AUTH_LOGIN_WEBHOOK_URL;
  const canReturnCode =
    process.env.AUTH_LOGIN_RETURN_CODE === "true" || process.env.NODE_ENV !== "production";
  if (canReturnCode) return;
  if (!webhookUrl) {
    throw Object.assign(new Error("AUTH_LOGIN_WEBHOOK_URL is required for production login"), {
      statusCode: 503,
    });
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      workspaceId,
      code,
      expiresInMinutes: 10,
    }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Login delivery failed with ${response.status}`), {
      statusCode: 502,
    });
  }
}

async function handleRequestLogin(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  ensureSeed();
  const parsed = RequestLoginSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid login payload", requestId, { issues: parsed.error.issues });
  const email = parsed.data.email.toLowerCase();
  const d = getDb();
  const matches = d
    .prepare(
      `SELECT u.id AS user_id, u.name, u.email, w.id AS workspace_id, w.name AS workspace_name, tm.role
         FROM users u
         JOIN workspaces w ON w.owner_id = u.id
         LEFT JOIN team_members tm ON tm.workspace_id = w.id AND (tm.user_id = u.id OR tm.user_id IS NULL)
        WHERE lower(u.email) = ?
        UNION
       SELECT u.id AS user_id, u.name, u.email, w.id AS workspace_id, w.name AS workspace_name, tm.role
         FROM users u
         JOIN team_members tm ON tm.user_id = u.id
         JOIN workspaces w ON w.id = tm.workspace_id
        WHERE lower(u.email) = ?`,
    )
    .all(email, email) as {
    user_id: string;
    name: string;
    email: string;
    workspace_id: string;
    workspace_name: string;
    role: string | null;
  }[];
  const match = parsed.data.workspaceId
    ? matches.find((row) => row.workspace_id === parsed.data.workspaceId)
    : matches[0];
  if (!match) {
    return sendJson(
      res,
      404,
      {
        ok: false,
        error: "login_not_available",
        message: "No workspace membership found for that email.",
      },
      requestId,
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  d.prepare(
    `INSERT INTO auth_login_codes (id, email, workspace_id, code_hash, expires_at, created_at, requested_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `code-${randomUUID()}`,
    email,
    match.workspace_id,
    hashLoginCode(email, match.workspace_id, code),
    now + 10 * 60_000,
    now,
    getHeader(req, "x-forwarded-for")?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null,
  );
  await deliverLoginCode(email, match.workspace_id, code);

  const canReturnCode =
    process.env.AUTH_LOGIN_RETURN_CODE === "true" || process.env.NODE_ENV !== "production";
  sendJson(
    res,
    200,
    {
      ok: true,
      delivered: !canReturnCode,
      workspace: { id: match.workspace_id, name: match.workspace_name },
      ...(canReturnCode ? { code } : {}),
    },
    requestId,
  );
}

const LoginSchema = z.object({
  email: z.string().trim().email().max(160),
  workspaceId: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  ensureSeed();
  const parsed = LoginSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid login payload", requestId, { issues: parsed.error.issues });
  const email = parsed.data.email.toLowerCase();
  const d = getDb();
  const row = d
    .prepare(
      `SELECT * FROM auth_login_codes
        WHERE email = ?
          AND workspace_id = ?
          AND used_at IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(email, parsed.data.workspaceId, Date.now()) as
    | { id: string; code_hash: string }
    | undefined;
  if (!row || row.code_hash !== hashLoginCode(email, parsed.data.workspaceId, parsed.data.code)) {
    return sendError(res, 401, "Invalid or expired login code", requestId);
  }
  const user = d
    .prepare("SELECT id, name, email, role FROM users WHERE lower(email) = ?")
    .get(email) as { id: string; name: string; email: string; role: string } | undefined;
  if (!user) return sendError(res, 401, "Invalid or expired login code", requestId);
  const membership = d
    .prepare(
      `SELECT tm.role
         FROM team_members tm
         JOIN workspaces w ON w.id = tm.workspace_id
        WHERE tm.workspace_id = ?
          AND (tm.user_id = ? OR w.owner_id = ?)`,
    )
    .get(parsed.data.workspaceId, user.id, user.id) as { role: string } | undefined;
  if (!membership) return sendError(res, 403, "Workspace access denied", requestId);

  d.prepare("UPDATE auth_login_codes SET used_at = ? WHERE id = ?").run(Date.now(), row.id);
  const session = sessionTokenForUser(user.id, parsed.data.workspaceId, req);
  res.setHeader("set-cookie", sessionCookie(session.token, req));
  sendJson(
    res,
    200,
    {
      ok: true,
      session: publicSessionFor({
        userId: user.id,
        workspaceId: parsed.data.workspaceId,
        role: membership.role,
        devFallback: false,
        sessionId: session.sessionId,
        sessionExpiresAt: session.expiresAt,
      }),
    },
    requestId,
  );
}

async function handleLogout(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const secret = process.env.AUTH_SESSION_SECRET;
  const token = getHeader(req, "x-forgecloud-session") ?? parseCookie(req, "fc_session");
  const parsed = secret && token ? verifySessionToken(token, secret) : null;
  if (parsed) {
    getDb()
      .prepare(
        `UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, ?)
          WHERE id = ?
            AND user_id = ?
            AND workspace_id = ?
            AND token_hash = ?`,
      )
      .run(
        Date.now(),
        parsed.sessionId,
        parsed.userId,
        parsed.workspaceId,
        hashSessionToken(token, secret),
      );
  }
  res.setHeader("set-cookie", clearSessionCookie(req));
  sendJson(res, 200, { ok: true }, requestId);
}

async function handleGetSession(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const ctx = await optionalAuthContext(req);
  sendJson(res, 200, { session: publicSessionFor(ctx) }, requestId);
}

async function handleGetState(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  ensureSeed();
  const projectId = await getCurrentProjectId();
  const butterbaseRepository = getButterbaseRepository();
  const d = getDb();
  const project = (await butterbaseRepository.getProject(projectId)) ?? getProject(projectId)!;
  const agentsList = await butterbaseRepository.listAgents(projectId);
  const tasks = await butterbaseRepository.listTasks(projectId);
  const prs = await butterbaseRepository.listPullRequests(projectId);
  const recovery = await butterbaseRepository.listRecoveryEvents(projectId);
  const changesList = await butterbaseRepository.listChanges(projectId);
  const deployments = await butterbaseRepository.listDeployments(projectId);
  const approvals = await butterbaseRepository.listApprovals(projectId);
  const teamMembers = await butterbaseRepository.listTeamMembers(currentWorkspaceId());
  const chatMessages = await butterbaseRepository.listChatMessages(projectId);
  const user =
    (await butterbaseRepository.getUser(currentUserId())) ??
    (d.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId()) as User);
  const workspace =
    (await butterbaseRepository.getWorkspace(currentWorkspaceId())) ??
    (d.prepare("SELECT * FROM workspaces WHERE id = ?").get(currentWorkspaceId()) as Workspace);

  // Per-PR changes + risk checks + linked task / agent / deployment metadata
  // (enriches PRs for the Changes screen and the Build activity panel).
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const agentsById = new Map(agentsList.map((a) => [a.id, a]));
  const latestDeploymentByPrId = new Map<
    string,
    {
      environment: string;
      status: string;
      cloudflare_url: string | null;
      railway_url: string | null;
      created_at: number;
    }
  >();
  for (const dep of deployments) {
    if (!dep.pr_id) continue;
    const prev = latestDeploymentByPrId.get(dep.pr_id);
    if (!prev || dep.created_at > prev.created_at) {
      latestDeploymentByPrId.set(dep.pr_id, {
        environment: dep.environment,
        status: dep.status,
        cloudflare_url: dep.cloudflare_url,
        railway_url: dep.railway_url,
        created_at: dep.created_at,
      });
    }
  }
  const changesByPrId = new Map<string, Change[]>();
  for (const change of changesList) {
    const existing = changesByPrId.get(change.pr_id) ?? [];
    existing.push(change);
    changesByPrId.set(change.pr_id, existing);
  }
  const prsEnriched = prs.map((p) => {
    const changes = changesByPrId.get(p.id) ?? [];
    const linkedTask = p.task_id ? tasksById.get(p.task_id) : undefined;
    const agentOwner = p.created_by_agent_id ? agentsById.get(p.created_by_agent_id) : undefined;
    const latestDeployment = latestDeploymentByPrId.get(p.id);
    return {
      ...p,
      changes,
      riskChecks: computeRiskChecks(p.id),
      task_title: linkedTask?.title ?? null,
      task_status: linkedTask?.status ?? null,
      task_requester_name: linkedTask?.requester_name ?? null,
      task_reviewer_name: linkedTask?.reviewer_name ?? null,
      agent_owner_name: agentOwner?.name ?? null,
      agent_owner_role: agentOwner?.role ?? null,
      latest_deployment_environment: latestDeployment?.environment ?? null,
      latest_deployment_status: latestDeployment?.status ?? null,
      latest_deployment_url:
        latestDeployment?.railway_url ?? latestDeployment?.cloudflare_url ?? null,
    };
  });

  const previewComments = await butterbaseRepository.listPreviewComments(projectId);

  // New vibecoding primitives.
  const connections = await butterbaseRepository.listConnections(currentWorkspaceId());
  const discoveries = await butterbaseRepository.listDiscoveries(currentWorkspaceId(), projectId);
  const suggestedApps = await butterbaseRepository.listSuggestedApps(
    currentWorkspaceId(),
    projectId,
  );
  const branches = await butterbaseRepository.listBranches(projectId);
  const commits = await butterbaseRepository.listCommits(projectId);
  const worktrees = await butterbaseRepository.listWorktrees(projectId);
  const notifications = await butterbaseRepository.listNotifications(currentWorkspaceId(), 30);
  const notificationsUnread = await butterbaseRepository.unreadNotifications(currentWorkspaceId());
  const activityEvents = await butterbaseRepository.listActivityEvents(projectId);
  const memoryEntries = await butterbaseRepository.listMemoryEntries(projectId);
  const rocketRideRuns = await butterbaseRepository.listRocketRideWorkflowRuns(projectId, 25);
  const deploymentReadiness = getDeploymentReadiness(projectId);
  const allProjects = await butterbaseRepository.listProjects(currentWorkspaceId());
  const entitlements = getEntitlementSnapshot(currentWorkspaceId());
  const stack = getPublicStackConfig();
  const butterbase = getButterbaseStatus();
  const composio = getComposioStatus();
  const rocketRide = getRocketRideStatus();

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
      activityEvents,
      memoryEntries,
      rocketRideRuns,
      deploymentReadiness,
      entitlements,
      stack,
      butterbase,
      composio,
      rocketRide,
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
  const butterbaseRepository = getButterbaseRepository();
  // Intake creates a NEW project, named after what the user said they're building.
  // The previous behavior (renaming the active project) made "build a waitlist"
  // overwrite the demo project, which broke the multi-project story.
  const projectId = ids.newProject();
  const project = await butterbaseRepository.createProject({
    id: projectId,
    workspaceId: currentWorkspaceId(),
    name: data.projectName,
    description: `${data.userType} • ${data.firstVersion} • ${data.style}`,
    status: "planning",
  });
  mirrorProjectForLocalRuntime(project);
  // Activate the new project so the user lands on it after submit.
  await butterbaseRepository.setActiveProjectId(currentWorkspaceId(), projectId);
  // Fresh project = fresh 9-agent team.
  const agents = createAgentsForProject(projectId);
  if (butterbaseRepository.mode === "remote") {
    await Promise.all(agents.map((agent) => butterbaseRepository.syncAgent(agent)));
  }
  const prompt =
    data.rawPrompt ??
    `Build a ${data.firstVersion} for ${userTypeLine(data)}. Style: ${data.style}.`;
  const plan: BuildPlan = await generateBuildPlan(prompt);
  const tasks = createTasksFromPlan(projectId, plan, data.reviewers ?? ["Animesh"]);
  await syncTasksToButterbase(tasks);
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content: `I created a plan for ${data.projectName}. ${plan.summary} ${tasks.length} tasks are queued for review. Approve and start when ready.`,
    metadata: JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
  });
  sendJson(res, 200, { project, plan, tasks }, requestId);
}

function userTypeLine(data: { userType: string; firstVersion: string }): string {
  return `${data.userType} (${data.firstVersion})`;
}

const ChatSchema = z.object({ message: z.string().min(1).max(4000) });

type PlanChatMetadata = {
  kind: string;
  plan?: BuildPlan;
  taskIds?: string[];
  refinedFromMessageId?: string;
};

function parsePlanMetadata(raw: string | null): PlanChatMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlanChatMetadata;
    if (parsed?.kind === "plan" && parsed.plan && Array.isArray(parsed.taskIds)) return parsed;
  } catch {
    return null;
  }
  return null;
}

async function latestPlanMessage(
  projectId: string,
): Promise<{ message: ChatMessage; metadata: PlanChatMetadata } | null> {
  const rows = await getButterbaseRepository().listChatMessages(projectId);
  for (const message of [...rows].reverse()) {
    if (message.role !== "assistant" || !message.metadata) continue;
    const metadata = parsePlanMetadata(message.metadata);
    if (metadata) return { message, metadata };
  }
  return null;
}

function meaningfulTokens(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "plan",
    "feature",
    "features",
    "task",
    "tasks",
    "make",
    "more",
    "less",
    "drop",
    "remove",
    "without",
    "exclude",
    "add",
    "current",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stop.has(token))
    .slice(0, 24);
}

function featureScore(feature: BuildPlan["features"][number], tokens: string[]): number {
  const haystack = `${feature.title} ${feature.description}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function refinePlanFromNote(plan: BuildPlan, taskIds: string[], note: string) {
  const trimmedNote = note.trim().replace(/\s+/g, " ");
  const lower = trimmedNote.toLowerCase();
  const tokens = meaningfulTokens(trimmedNote);
  const wantsRemoval = /\b(drop|remove|without|exclude|delete)\b/i.test(trimmedNote);
  const removedTaskIds: string[] = [];
  const touchedTaskIds: string[] = [];

  const features = plan.features
    .map((feature, index) => ({ feature, taskId: taskIds[index] }))
    .filter(({ feature, taskId }) => {
      if (!wantsRemoval || tokens.length === 0) return true;
      const score = featureScore(feature, tokens);
      if (score === 0) return true;
      if (taskId) removedTaskIds.push(taskId);
      return false;
    })
    .map(({ feature, taskId }) => {
      const score = tokens.length > 0 ? featureScore(feature, tokens) : 0;
      const shouldTouch = !wantsRemoval && (score > 0 || lower.includes("overall"));
      if (shouldTouch && taskId) touchedTaskIds.push(taskId);
      return shouldTouch
        ? {
            ...feature,
            description: `${feature.description} Refinement: ${trimmedNote}`,
          }
        : feature;
    });

  const safeFeatures = features.length > 0 ? features : plan.features;
  const refinedPlan: BuildPlan = {
    ...plan,
    summary: `${plan.summary} Refined: ${trimmedNote}`,
    features: safeFeatures,
  };
  const keptTaskIds =
    removedTaskIds.length > 0 ? taskIds.filter((id) => !removedTaskIds.includes(id)) : taskIds;

  return {
    plan: refinedPlan,
    taskIds: keptTaskIds.slice(0, refinedPlan.features.length),
    removedTaskIds,
    touchedTaskIds,
    note: trimmedNote,
  };
}

function extractRefineNote(message: string): string | null {
  const match = message.match(/^refine the plan:\s*([\s\S]*)$/i);
  if (!match) return null;
  return match[1].split(/\n\s*current plan:/i)[0]?.trim() || null;
}

function classifyStatusChatIntent(
  message: string,
): "blocked" | "preview_summary" | "production_review" | "safest_next" | null {
  const lower = message.trim().toLowerCase();
  if (/what(?:'s| is)? blocked|blocked right now|blockers?/.test(lower)) return "blocked";
  if (/summarize.*changed.*preview|changed since.*preview|since the last preview/.test(lower)) {
    return "preview_summary";
  }
  if (/production review|prod review|prepare.*production/.test(lower)) return "production_review";
  if (/ship the safest next change|safest next change|safest thing to ship/.test(lower)) {
    return "safest_next";
  }
  return null;
}

async function insertAssistantMessage(
  projectId: string,
  content: string,
  metadata?: Record<string, unknown>,
) {
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function shortDate(value: number | null | undefined): string {
  if (!value) return "unknown time";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function listLines(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function buildChatStatusReply(
  projectId: string,
  intent: NonNullable<ReturnType<typeof classifyStatusChatIntent>>,
) {
  const d = getDb();
  const tasks = d
    .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Task[];
  const prs = listPullRequests(projectId);
  const recovery = listRecoveryEvents(projectId);
  const deployments = listDeployments(projectId);
  const approvals = getApprovalQueue(projectId);
  const failedRuntime = d
    .prepare(
      `SELECT rc.*, t.title AS task_title
         FROM runtime_checks rc
         LEFT JOIN tasks t ON t.id = rc.task_id
        WHERE rc.project_id = ? AND rc.status = 'failed'
        ORDER BY rc.completed_at DESC, rc.started_at DESC
        LIMIT 5`,
    )
    .all(projectId) as Array<{ check_type: string; summary: string; task_title: string | null }>;

  if (intent === "blocked") {
    const blockers = [
      ...recovery
        .filter((event) => event.status !== "recovered")
        .map((event) => `${event.failure_type}: ${event.failure_message}`),
      ...approvals.map((approval) => `${approval.risk_level} approval: ${approval.reason}`),
      ...prs
        .filter((pr) => pr.status === "blocked" || pr.status === "changes_requested")
        .map((pr) => `PR #${pr.number} ${pr.status}: ${pr.title}`),
      ...failedRuntime.map(
        (check) =>
          `${check.check_type} failed${check.task_title ? ` for ${check.task_title}` : ""}: ${check.summary}`,
      ),
    ].slice(0, 8);
    const reply =
      blockers.length === 0
        ? "Nothing is blocked right now. No unresolved recovery events, pending approvals, blocked PRs, or failed runtime checks are showing for this project."
        : `Current blockers:\n${listLines(blockers)}\n\nClear those before production deploy.`;
    return { reply, metadata: { kind: "status_answer", intent, blockers } };
  }

  if (intent === "preview_summary") {
    const latestPreview = deployments.find((deployment) => deployment.environment === "preview");
    const since = latestPreview?.created_at ?? 0;
    const recentPrs = prs
      .filter((pr) => !since || pr.created_at >= since)
      .slice(0, 5)
      .map((pr) => `PR #${pr.number} ${pr.status}: ${pr.title}`);
    const recentRuns = d
      .prepare(
        `SELECT ar.status, ar.output_summary, t.title AS task_title
           FROM agent_runs ar
           LEFT JOIN tasks t ON t.id = ar.task_id
          WHERE ar.project_id = ? AND ar.started_at >= ?
          ORDER BY ar.started_at DESC
          LIMIT 5`,
      )
      .all(projectId, since) as Array<{
      status: string;
      output_summary: string | null;
      task_title: string | null;
    }>;
    const runLines = recentRuns.map(
      (run) => `${run.status}: ${run.task_title ?? run.output_summary ?? "agent run"}`,
    );
    const reply = latestPreview
      ? `Since the last preview at ${shortDate(latestPreview.created_at)}, I found:\n${listLines([
          ...recentPrs,
          ...runLines,
        ])}`
      : `No preview deployment is recorded yet. Recent project movement:\n${listLines([
          ...prs.slice(0, 5).map((pr) => `PR #${pr.number} ${pr.status}: ${pr.title}`),
          ...tasks.slice(0, 5).map((task) => `${task.status}: ${task.title}`),
        ])}`;
    return {
      reply,
      metadata: {
        kind: "status_answer",
        intent,
        latestPreviewId: latestPreview?.id ?? null,
        recentPrs,
        recentRuns: runLines,
      },
    };
  }

  if (intent === "production_review") {
    const readiness = getDeploymentReadiness(projectId);
    const openHighRisk = prs.filter(
      (pr) => pr.risk_level === "high" && !["approved", "merged"].includes(pr.status),
    );
    const failedRuntimeLines = failedRuntime.map(
      (check) => `${check.check_type}: ${check.summary}`,
    );
    const checks = readiness.checks.map(
      (check) => `${check.passed ? "PASS" : "BLOCKED"} - ${check.label}`,
    );
    const reply = `Production review packet:\n${listLines(checks)}\n\nOpen risk:\n${listLines([
      ...openHighRisk.map((pr) => `PR #${pr.number}: ${pr.title}`),
      ...failedRuntimeLines,
    ])}\n\nVerdict: ${
      readiness.canDeployProduction && openHighRisk.length === 0 && failedRuntimeLines.length === 0
        ? "ready for the production deploy button."
        : "not ready for production yet."
    }`;
    return {
      reply,
      metadata: {
        kind: "status_answer",
        intent,
        canDeployProduction: readiness.canDeployProduction,
        checks: readiness.checks,
      },
    };
  }

  const safestTask = tasks.find((task) => task.status === "backlog" && task.risk_level === "low");
  const safestPr = prs.find(
    (pr) => pr.risk_level === "low" && ["open", "approved"].includes(pr.status),
  );
  const reply = safestTask
    ? `Safest next change: "${safestTask.title}". It is low risk, still in backlog, and can be run without touching production deploy gates.`
    : safestPr
      ? `Safest next change: review PR #${safestPr.number}, "${safestPr.title}". It is low risk and already has generated work.`
      : `I do not see a low-risk backlog task or open low-risk PR. Current queue: ${formatCount(
          tasks.filter((task) => task.status === "backlog").length,
          "backlog task",
        )}, ${formatCount(approvals.length, "pending approval")}.`;
  return {
    reply,
    metadata: {
      kind: "status_answer",
      intent,
      taskId: safestTask?.id ?? null,
      prId: safestPr?.id ?? null,
    },
  };
}

function ensureTaskEntitlement(res: ServerResponse, requestId: string, quantity: number): boolean {
  const decision = checkEntitlement(currentWorkspaceId(), "create_task", quantity);
  if (!decision.allowed) {
    sendEntitlementDenied(res, requestId, decision);
    return false;
  }
  return true;
}

function recordTaskUsage(quantity: number, requestId: string, source: string) {
  recordUsageEvent(currentWorkspaceId(), "task", quantity, {
    route: "/api/chat",
    action: "create_task",
    source,
    requestId,
  });
}

function syncRefinedPlanTasks(input: {
  projectId: string;
  refined: ReturnType<typeof refinePlanFromNote>;
}) {
  const d = getDb();
  const now = Date.now();
  for (const taskId of input.refined.removedTaskIds) {
    d.prepare(
      `UPDATE tasks
          SET status = 'cancelled'
        WHERE id = ?
          AND project_id = ?
          AND status = 'backlog'`,
    ).run(taskId, input.projectId);
  }
  for (const [index, taskId] of input.refined.taskIds.entries()) {
    const feature = input.refined.plan.features[index];
    if (!feature) continue;
    d.prepare(
      `UPDATE tasks
          SET title = ?,
              description = ?,
              risk_level = ?,
              updated_at = ?
        WHERE id = ?
          AND project_id = ?
          AND status = 'backlog'`,
    ).run(feature.title, feature.description, feature.riskLevel, now, taskId, input.projectId);
  }
}

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

  // Guardrail check FIRST: do not persist the message if it would be blocked
  // (the PRD's "Safety Agent caught the secret before it ever hit code").
  const hit = detectGuardrailViolation(message);
  if (hit) {
    // Map the broader guardrail rules onto the existing recovery_events model.
    if (hit.kind === "secret") {
      recordSecretBlock(projectId, null, hit.match);
    } else {
      const dDb = getDb();
      dDb
        .prepare(
          `INSERT INTO recovery_events (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
         VALUES (?, ?, NULL, 'guardrail_blocked', ?, 'Safety Agent blocked this — flagged as dangerous before any agent ran it.', 'blocked', ?)`,
        )
        .run(
          ids.newRecovery(),
          projectId,
          `${hit.title}: matched "${hit.match.slice(0, 60)}"`,
          Date.now(),
        );
      // Notify the workspace bell too.
      const wsRow = dDb.prepare("SELECT workspace_id FROM projects WHERE id = ?").get(projectId) as
        | { workspace_id: string }
        | undefined;
      if (wsRow) {
        const { createNotification } = await import("../lib/vcs");
        // Distinguish real secret detection from profanity / dangerous-action
        // blocks in the bell + notifications screen. Conflating them made the
        // notification feed look like every chat was leaking a credential.
        createNotification({
          workspaceId: wsRow.workspace_id,
          projectId,
          kind: hit.kind === "secret" ? "secret_blocked" : "guardrail_blocked",
          title: `Safety Agent blocked: ${hit.title}`,
          body: `Matched "${hit.match.slice(0, 80)}". Edit your request and try again.`,
          link: "/app/failures",
        });
      }
    }
    const reply =
      hit.kind === "secret"
        ? "Safety Agent blocked this — looks like a hardcoded credential in your message. Use environment variables instead."
        : hit.kind === "profanity"
          ? "Let's keep the request professional — rephrase that without the strong language and I'll get to work."
          : `Safety Agent blocked this — it looked like: ${hit.title}. Rewrite your request without that pattern.`;
    await getButterbaseRepository().addChatMessage({
      id: ids.newMessage(),
      projectId,
      role: "assistant",
      content: reply,
      metadata: JSON.stringify({
        kind: hit.kind === "secret" ? "secret_block" : "guardrail_block",
        rule: hit.kind,
        title: hit.title,
      }),
    });
    recordActivity({
      projectId,
      actorType: "agent",
      actorId: null,
      eventType: "guardrail_blocked",
      title: `Safety Agent blocked: ${hit.title}`,
      description: `Matched "${hit.match.slice(0, 80)}". The request was stopped before agent work began.`,
      tool: "XTrace",
    });
    recordMemory({
      projectId,
      source: "XTrace",
      title: `Blocked rule: ${hit.title}`,
      body: `ForgeCloud should continue blocking requests matching "${hit.match.slice(0, 80)}" unless the owner rewrites the request safely.`,
    });
    return sendJson(res, 200, { reply, blocked: true, rule: hit }, requestId);
  }

  // Persist the user message only after guardrail passes.
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "user",
    content: message,
  });
  recordActivity({
    projectId,
    actorType: "user",
    actorId: currentUserId(),
    eventType: "chat_request",
    title: "Chat request received",
    description: message.slice(0, 220),
    tool: "Composio",
  });

  const project = getProject(projectId)!;
  if (project.status === "intake") {
    const plan: BuildPlan = await generateBuildPlan(message);
    if (!ensureTaskEntitlement(res, requestId, plan.features.length)) return;
    d.prepare(`UPDATE projects SET name = ?, status = 'planning' WHERE id = ?`).run(
      plan.suggestedProjectName,
      projectId,
    );
    const agents = createAgentsForProject(projectId);
    const tasks = createTasksFromPlan(projectId, plan, "Animesh");
    const butterbaseRepository = getButterbaseRepository();
    if (butterbaseRepository.mode === "remote") {
      const updatedProject = d.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
        | Project
        | undefined;
      await Promise.all([
        ...(updatedProject ? [butterbaseRepository.syncProject(updatedProject)] : []),
        ...agents.map((agent) => butterbaseRepository.syncAgent(agent)),
      ]);
    }
    await syncTasksToButterbase(tasks);
    const reply = `I created a plan. Review before I start building.\n\n${tasks.length} tasks across ${agents.length} agents.`;
    await butterbaseRepository.addChatMessage({
      id: ids.newMessage(),
      projectId,
      role: "assistant",
      content: reply,
      metadata: JSON.stringify({ kind: "plan", plan, taskIds: tasks.map((t) => t.id) }),
    });
    recordTaskUsage(tasks.length, requestId, "chat_intake_plan");
    recordActivity({
      projectId,
      actorType: "agent",
      actorId: null,
      eventType: "workflow_started",
      title: "RocketRide build plan created",
      description: `${tasks.length} tasks were generated from the chat request and queued for review.`,
      tool: "RocketRide",
    });
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: "records_persisted",
      title: "Butterbase stored generated tasks",
      description:
        "The build plan, task list, agent assignments, and chat transcript were persisted.",
      tool: "Butterbase",
    });
    recordMemory({
      projectId,
      source: "XTrace",
      title: "Original project request",
      body: message.slice(0, 500),
    });
    return sendJson(res, 200, { reply, plan, tasks }, requestId);
  }

  const refineNote = extractRefineNote(message);
  if (refineNote) {
    const latestPlan = await latestPlanMessage(projectId);
    if (!latestPlan?.metadata.plan || !latestPlan.metadata.taskIds) {
      const reply =
        "I do not see an editable plan in this project yet. Ask me to create a plan first, then I can refine it.";
      await insertAssistantMessage(projectId, reply, {
        kind: "status_answer",
        intent: "refine_plan",
      });
      return sendJson(res, 200, { reply }, requestId);
    }
    const refined = refinePlanFromNote(
      latestPlan.metadata.plan,
      latestPlan.metadata.taskIds,
      refineNote,
    );
    syncRefinedPlanTasks({ projectId, refined });
    const removed =
      refined.removedTaskIds.length > 0
        ? ` Removed ${formatCount(refined.removedTaskIds.length, "backlog task")}.`
        : "";
    const reply = `I refined the plan against the current backlog.${removed} Review the updated scope before starting agents.`;
    await insertAssistantMessage(projectId, reply, {
      kind: "plan",
      plan: refined.plan,
      taskIds: refined.taskIds,
      refinedFromMessageId: latestPlan.message.id,
      refinementNote: refined.note,
      removedTaskIds: refined.removedTaskIds,
      touchedTaskIds: refined.touchedTaskIds,
    });
    return sendJson(
      res,
      200,
      {
        reply,
        plan: refined.plan,
        taskIds: refined.taskIds,
        removedTaskIds: refined.removedTaskIds,
      },
      requestId,
    );
  }

  const statusIntent = classifyStatusChatIntent(message);
  if (statusIntent) {
    const answer = buildChatStatusReply(projectId, statusIntent);
    await insertAssistantMessage(projectId, answer.reply, answer.metadata);
    return sendJson(res, 200, answer, requestId);
  }

  if (!ensureTaskEntitlement(res, requestId, 1)) return;
  const newTasks = createTasksFromPlan(
    projectId,
    {
      features: [
        (() => {
          const intent = classifyChatIntent(message);
          return {
            title: intent.title,
            description: intent.description,
            ownerAgent: intent.ownerAgent,
            riskLevel: intent.riskLevel,
            estimatedFiles:
              intent.kind === "deploy" || intent.kind === "rollback"
                ? 1
                : intent.kind === "database" || intent.kind === "auth" || intent.kind === "backend"
                  ? 4
                  : 3,
          };
        })(),
      ],
    },
    "Animesh",
  );
  await syncTasksToButterbase(newTasks);
  const intent = classifyChatIntent(message);
  const latestPrs = listPullRequests(projectId).slice(0, 3);
  const reply =
    intent.kind === "explain_changes"
      ? latestPrs.length > 0
        ? `Here are the latest changes:\n\n${latestPrs
            .map(
              (pr) =>
                `PR #${pr.number}: ${pr.title} — ${pr.summary} Status: ${pr.status}. Risk: ${pr.risk_level}.`,
            )
            .join("\n")}`
        : "No pull requests exist yet. Ask me to build a feature first, then I can explain exactly what changed."
      : intent.kind === "deploy"
        ? `I queued a production deploy readiness task for the DevOps Agent. ForgeCloud will still require passing preflight checks and approval before anything goes live.`
        : intent.kind === "rollback"
          ? `I queued a rollback task for the Recovery Agent so the previous live version can be restored through the guarded deployment flow.`
          : `Got it. Created task "${newTasks[0]?.title}" and assigned the ${intent.ownerAgent}.`;
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content: reply,
    metadata: JSON.stringify({
      kind: intent.kind === "explain_changes" ? "changes_explained" : "task_created",
      intent: intent.kind,
      taskIds: newTasks.map((t) => t.id),
    }),
  });
  recordTaskUsage(newTasks.length, requestId, `chat_${intent.kind}`);
  recordActivity({
    projectId,
    actorType: "agent",
    actorId: null,
    eventType: "task_created",
    title: `Task created: ${newTasks[0]?.title ?? intent.title}`,
    description: `RocketRide classified this as ${intent.kind} work and routed it to ${intent.ownerAgent}.`,
    taskId: newTasks[0]?.id ?? null,
    tool: "RocketRide",
  });
  recordMemory({
    projectId,
    source: "XTrace",
    title: `Request context: ${intent.title}`,
    body: message.slice(0, 500),
    taskId: newTasks[0]?.id ?? null,
  });
  sendJson(res, 200, { reply, intent: intent.kind, tasks: newTasks }, requestId);
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
  // Pre-check so bogus IDs return 404, not 500.
  const d = getDb();
  const exists = d
    .prepare(
      `SELECT t.id
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?
          AND p.workspace_id = ?`,
    )
    .get(parsed.data.taskId, currentWorkspaceId()) as { id: string } | undefined;
  if (!exists) return sendError(res, 404, `Task ${parsed.data.taskId} not found`, requestId);
  try {
    const task = d.prepare("SELECT * FROM tasks WHERE id = ?").get(parsed.data.taskId) as Task;
    const { output } = await runRocketRideWorkflow(
      {
        projectId: task.project_id,
        workflowType: "run_task",
        title: `Run task: ${task.title}`,
        description: task.description,
        taskId: task.id,
        payload: { failureType: parsed.data.failureType ?? null },
      },
      () => runAgentOnTask(parsed.data.taskId, parsed.data.failureType),
    );
    await syncProjectReviewArtifactsToButterbase(task.project_id);
    sendJson(res, 200, output, requestId);
  } catch (err) {
    sendError(res, 500, (err as Error).message ?? "Internal error", requestId);
  }
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
  d.prepare("UPDATE projects SET status = 'building' WHERE id = ?").run(projectId);
  const backlog = d
    .prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC",
    )
    .all(projectId) as Task[];
  const { output } = await runRocketRideWorkflow(
    {
      projectId,
      workflowType: "run_all",
      title: "Run all backlog tasks",
      description: `Rocket Ride is orchestrating ${backlog.length} backlog task(s).`,
      payload: { failureAt: failureAt ?? null, failureType: failureType ?? null },
    },
    async () => {
      const results = [];
      for (let i = 0; i < backlog.length; i++) {
        const t = backlog[i];
        const failure = failureAt === i ? (failureType ?? "build_failed") : undefined;
        results.push(await runAgentOnTask(t.id, failure));
      }
      return { results };
    },
  );
  await syncProjectReviewArtifactsToButterbase(projectId);
  sendJson(res, 200, output, requestId);
}

const ApprovePlanSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(50),
  failureAt: z.number().int().nonnegative().optional(),
  failureType: z.string().min(1).optional(),
});

async function handleApprovePlan(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = ApprovePlanSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return sendError(res, 400, "Invalid approve-plan payload", requestId, {
      issues: parsed.error.issues,
    });
  }
  const projectId = await getCurrentProjectId();
  const d = getDb();
  const uniqueTaskIds = [...new Set(parsed.data.taskIds)];
  const scopedTasks: Task[] = [];
  const missingTaskIds: string[] = [];

  for (const taskId of uniqueTaskIds) {
    const task = d
      .prepare(
        `SELECT t.*
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
          WHERE t.id = ?
            AND t.project_id = ?
            AND p.workspace_id = ?`,
      )
      .get(taskId, projectId, currentWorkspaceId()) as Task | undefined;
    if (!task) {
      missingTaskIds.push(taskId);
    } else {
      scopedTasks.push(task);
    }
  }

  if (missingTaskIds.length > 0) {
    return sendError(res, 404, "Plan includes tasks outside this project", requestId, {
      missingTaskIds,
    });
  }

  const runnableTasks = scopedTasks.filter((task) => task.status === "backlog");
  const skippedTaskIds = scopedTasks
    .filter((task) => task.status !== "backlog")
    .map((task) => task.id);
  if (runnableTasks.length === 0) {
    return sendError(res, 409, "No backlog tasks remain in this plan", requestId, {
      skippedTaskIds,
    });
  }

  d.prepare("UPDATE projects SET status = 'building' WHERE id = ?").run(projectId);
  const results = [];
  for (let i = 0; i < runnableTasks.length; i++) {
    const failure =
      parsed.data.failureAt === i ? (parsed.data.failureType ?? "build_failed") : undefined;
    results.push(await runAgentOnTask(runnableTasks[i].id, failure));
  }

  const mergeTime = Date.now();
  const mergeablePrs = results
    .map((result) => result.pr)
    .filter((pr): pr is PullRequest => Boolean(pr) && pr.risk_level === "low");
  for (const pr of mergeablePrs) {
    d.prepare(
      `UPDATE pull_requests
          SET status = 'merged',
              approver_name = 'ForgeCloud auto-review',
              merged_at = COALESCE(merged_at, ?)
        WHERE id = ?
          AND status = 'open'
          AND risk_level = 'low'`,
    ).run(mergeTime, pr.id);
    if (pr.task_id) {
      d.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(pr.task_id);
    }
    const branch = d
      .prepare("SELECT id FROM branches WHERE head_pr_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(pr.id) as { id: string } | undefined;
    if (branch) {
      d.prepare(
        "UPDATE branches SET status = 'merged', merged_at = COALESCE(merged_at, ?) WHERE id = ?",
      ).run(mergeTime, branch.id);
    }
  }

  const previewUrl =
    mergeablePrs[mergeablePrs.length - 1]?.preview_url ??
    results.find((result) => result.pr?.preview_url)?.pr?.preview_url ??
    "https://preview.forgecloud.dev";
  const deploymentId = recordDeployment(
    projectId,
    mergeablePrs[mergeablePrs.length - 1]?.id ?? null,
    "preview",
    "live",
    {
      url: previewUrl,
      provider: "simulation",
      buildLogs: `Build Mode completed ${results.length} agent task(s), auto-merged ${mergeablePrs.length} safe PR(s), and published the preview.`,
    },
  );
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId,
    kind: "deploy_live",
    title: "Build Mode published a live preview",
    body: `${mergeablePrs.length} safe PR(s) were auto-merged. Risky changes are still waiting for approval.`,
    link: "/app/preview",
  });
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content: `Build Mode finished. The agents opened ${results.length} commit-backed change${results.length === 1 ? "" : "s"}, auto-merged ${mergeablePrs.length} safe PR${mergeablePrs.length === 1 ? "" : "s"}, and published a live preview: ${previewUrl}. Risky work is still waiting for your approval in Changes.`,
    metadata: JSON.stringify({
      kind: "build_complete",
      prIds: mergeablePrs.map((pr) => pr.id),
      deploymentId,
      previewUrl,
      mergedCount: mergeablePrs.length,
      totalRuns: results.length,
    }),
  });
  recordActivity({
    projectId,
    actorType: "system",
    actorId: null,
    eventType: "build_mode_published",
    title: "Build Mode published preview",
    description: `${results.length} agent task(s), ${mergeablePrs.length} safe auto-merge(s), preview ${previewUrl}.`,
    prId: mergeablePrs[mergeablePrs.length - 1]?.id ?? null,
    deploymentId,
    tool: "RocketRide",
  });
  recordMemory({
    projectId,
    source: "XTrace",
    title: "Build Mode shipped preview",
    body: `Safe work was auto-merged and preview deployed to ${previewUrl}. Risky work remains approval-gated.`,
    prId: mergeablePrs[mergeablePrs.length - 1]?.id ?? null,
    confidence: "deployment",
  });
  await syncProjectReviewArtifactsToButterbase(projectId);
  sendJson(
    res,
    200,
    {
      ok: true,
      results,
      skippedTaskIds,
      mergedPrIds: mergeablePrs.map((pr) => pr.id),
      deploymentId,
      previewUrl,
    },
    requestId,
  );
}

// "Do my tasks" — runs every backlog task assigned to the current user, end-to-end.
// Defaults to the seeded user ("Sal") when no name is supplied. A reviewerName
// override lets the UI drive this for any member of the workspace.
const RunMyTasksSchema = z.object({
  reviewerName: z.string().trim().min(1).max(80).optional(),
  includeReviewQueue: z.boolean().optional(),
});

async function handleRunMyTasks(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = RunMyTasksSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid run-my-tasks payload", requestId, {
      issues: parsed.error.issues,
    });
  const d = getDb();
  const projectId = await getCurrentProjectId();
  // Resolve the reviewer name: explicit override → current user's display_name → "Sal".
  let reviewerName = parsed.data.reviewerName;
  if (!reviewerName) {
    const u = d.prepare("SELECT display_name FROM users WHERE id = ?").get(currentUserId()) as
      | { display_name: string }
      | undefined;
    reviewerName = u?.display_name ?? "Sal";
  }
  const includeReview = parsed.data.includeReviewQueue !== false;
  // Pick up backlog tasks assigned to this reviewer. If the project has zero
  // reviewer-assigned backlog tasks (e.g. a fresh intake that never set a
  // reviewer), fall back to every backlog task so the button never no-ops.
  const mine = d
    .prepare(
      `SELECT * FROM tasks
         WHERE project_id = ?
           AND status = 'backlog'
           AND (reviewer_name = ? OR reviewer_id = ?)
         ORDER BY created_at ASC`,
    )
    .all(projectId, reviewerName, currentUserId()) as Task[];
  let queue: Task[] = mine;
  if (queue.length === 0) {
    queue = d
      .prepare(
        "SELECT * FROM tasks WHERE project_id = ? AND status = 'backlog' ORDER BY created_at ASC",
      )
      .all(projectId) as Task[];
  }
  const results: { taskId: string; ok: boolean; error?: string }[] = [];
  for (const t of queue) {
    try {
      const r = await runAgentOnTask(t.id);
      results.push({ taskId: t.id, ok: r.task?.status !== undefined });
    } catch (err) {
      results.push({ taskId: t.id, ok: false, error: (err as Error).message });
    }
  }
  // Optionally also flip any PRs that are in review for this reviewer straight
  // to "approved" so the GitHub flow completes autonomously. The user can
  // always go back and request edits, but the default expectation from the
  // "just do my tasks" command is forward progress.
  const autoApprovedReviewQueue = includeReview && hasPermission("review");
  if (autoApprovedReviewQueue) {
    d.prepare(
      `UPDATE pull_requests
         SET status = 'approved',
             approver_name = ?,
             merged_at = COALESCE(merged_at, ?)
         WHERE project_id = ?
           AND status IN ('open', 'changes_requested')
           AND risk_level != 'high'`,
    ).run(reviewerName, Date.now(), projectId);
  }
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId,
    kind: "system",
    title: `Ran ${queue.length} task(s) for ${reviewerName}`,
    body: queue
      .map((t) => t.title)
      .slice(0, 5)
      .join(" • "),
    link: "/app/tasks",
  });
  await syncProjectReviewArtifactsToButterbase(projectId);
  sendJson(
    res,
    200,
    {
      ok: true,
      reviewerName,
      count: queue.length,
      results,
      autoApprovedReviewQueue,
      reviewSkippedReason:
        includeReview && !autoApprovedReviewQueue ? "review_permission_required" : null,
    },
    requestId,
  );
}

async function ensureDemoDataPopulated(): Promise<void> {
  ensureSeed();
  const d = getDb();
  const pref = d
    .prepare(
      "SELECT value FROM workspace_prefs WHERE workspace_id = ? AND key = 'demoDataPopulated'",
    )
    .get(currentWorkspaceId()) as { value: string } | undefined;
  // Check whether there's any data to know if the user has already populated
  // once but the pref got cleared (e.g. on reset). If the project is empty,
  // re-populate.
  const counts = {
    tasks: (
      d.prepare("SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?").get(DEMO_PROJECT_ID) as {
        c: number;
      }
    ).c,
    branches: (
      d.prepare("SELECT COUNT(*) AS c FROM branches WHERE project_id = ?").get(DEMO_PROJECT_ID) as {
        c: number;
      }
    ).c,
    commits: (
      d.prepare("SELECT COUNT(*) AS c FROM commits WHERE project_id = ?").get(DEMO_PROJECT_ID) as {
        c: number;
      }
    ).c,
    worktrees: (
      d
        .prepare("SELECT COUNT(*) AS c FROM worktrees WHERE project_id = ?")
        .get(DEMO_PROJECT_ID) as { c: number }
    ).c,
  };
  const complete =
    counts.tasks > 0 && counts.branches > 0 && counts.commits > 0 && counts.worktrees > 0;
  if (complete && pref?.value === "true") return;
  if (complete) {
    d.prepare(
      `INSERT INTO workspace_prefs (workspace_id, key, value, updated_at) VALUES (?, 'demoDataPopulated', 'true', ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`,
    ).run(currentWorkspaceId(), Date.now());
    return;
  }
  // Re-derive agent IDs from the agents table (scaffold was run by ensureSeed).
  const agentIds: Record<string, string> = {};
  const rows = d
    .prepare("SELECT id, type FROM agents WHERE project_id = ?")
    .all(DEMO_PROJECT_ID) as { id: string; type: string }[];
  for (const r of rows) agentIds[r.type] = r.id;
  populateDemoData(agentIds);
  d.prepare(
    `INSERT INTO workspace_prefs (workspace_id, key, value, updated_at) VALUES (?, 'demoDataPopulated', 'true', ?)
     ON CONFLICT(workspace_id, key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`,
  ).run(currentWorkspaceId(), Date.now());
}

function demoEndpointsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_ENDPOINTS === "true";
}

async function handleSeedDemo(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!demoEndpointsAllowed()) return sendError(res, 403, "Demo endpoints are disabled", requestId);
  await ensureDemoDataPopulated();
  sendJson(res, 200, { ok: true }, requestId);
}

async function handleRunFullDemo(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!demoEndpointsAllowed()) return sendError(res, 403, "Demo endpoints are disabled", requestId);
  // "Try the demo" must always run on the canonical seeded project,
  // regardless of which project is currently active — otherwise users with
  // an empty new project see a blank demo.
  const d = getDb();
  const demo = d.prepare("SELECT id FROM projects WHERE id = ?").get(DEMO_PROJECT_ID) as
    | { id: string }
    | undefined;
  if (!demo) return sendError(res, 500, "Demo project missing", requestId);
  const projectId = demo.id;
  // Make sure the demo data is populated. The /api/seed-demo endpoint is
  // also exposed for the "Try the demo" button; this is a belt-and-suspenders
  // fallback in case the UI didn't seed first.
  await ensureDemoDataPopulated();
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
  recordDeployment(projectId, null, "preview", "live", {
    url: `https://preview-demo.forgecloud.dev`,
    provider: "simulation",
  });
  sendJson(res, 200, { ok: true }, requestId);
}

async function handleSkipToDemo(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!demoEndpointsAllowed()) return sendError(res, 403, "Demo endpoints are disabled", requestId);
  const d = getDb();
  // Wipe any non-canonical projects so the switcher doesn't accumulate phantom
  // entries from past /api/intake or /api/projects calls.
  const nonCanonical = d.prepare(`SELECT id FROM projects WHERE id != ?`).all(DEMO_PROJECT_ID) as {
    id: string;
  }[];
  for (const { id: pid } of nonCanonical) {
    d.prepare(
      `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
    ).run(pid);
    for (const t of [
      "chat_messages",
      "approvals",
      "deployments",
      "recovery_events",
      "activity_events",
      "memory_entries",
      "rocketride_workflow_runs",
      "runtime_checks",
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
  // M5: wipe the canonical demo project's notifications + activity so the bell
  // shows just the freshly-seeded notif-* rows.
  d.prepare(`DELETE FROM notifications WHERE project_id = ?`).run(DEMO_PROJECT_ID);
  d.prepare(`DELETE FROM activity_events WHERE project_id = ?`).run(DEMO_PROJECT_ID);
  d.prepare(`DELETE FROM memory_entries WHERE project_id = ?`).run(DEMO_PROJECT_ID);
  d.prepare(`DELETE FROM rocketride_workflow_runs WHERE project_id = ?`).run(DEMO_PROJECT_ID);
  // Clear any active-project preference so the demo becomes the current project again.
  d.prepare(`DELETE FROM workspace_prefs WHERE workspace_id = ? AND key = 'activeProjectId'`).run(
    currentWorkspaceId(),
  );

  // Re-seed the canonical demo project to a known good state. This restores
  // its PRD-canonical name + fresh tasks/PRs/agents so the rest of the app
  // (Tasks, Agents, PRs, Preview) shows the same content the demo screenshot
  // walkthrough uses.
  ensureSeed();
  // Skip-to-demo is an explicit "I want the populated demo state" action,
  // so re-populate tasks/PRs/deploys/recovery/etc. here.
  try {
    const agentIds: Record<string, string> = {};
    const d2 = getDb();
    const rows = d2
      .prepare("SELECT id, type FROM agents WHERE project_id = ?")
      .all(DEMO_PROJECT_ID) as { id: string; type: string }[];
    for (const r of rows) agentIds[r.type] = r.id;
    populateDemoData(agentIds);
    d2.prepare(
      `INSERT INTO workspace_prefs (workspace_id, key, value, updated_at) VALUES (?, 'demoDataPopulated', 'true', ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = 'true', updated_at = excluded.updated_at`,
    ).run(currentWorkspaceId(), Date.now());
  } catch (err) {
    // If re-populate fails (e.g. data race), the project still exists from ensureSeed.
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
    recordSecretBlock(projectId, null, "demo credential placeholder");
    await syncProjectReviewArtifactsToButterbase(projectId);
    const [event] = await getButterbaseRepository().listRecoveryEvents(projectId);
    return sendJson(res, 200, { event }, requestId);
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
    await syncProjectReviewArtifactsToButterbase(projectId);
    return sendJson(res, 200, { event }, requestId);
  }
  const event = await triggerFailure(projectId, null, type, message ?? d2.msg, d2.recovery);
  await syncProjectReviewArtifactsToButterbase(projectId);
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
  const existing = getScopedApproval(parsed.data.approvalId);
  if (!existing) return sendError(res, 404, "Approval not found", requestId);
  if (existing.status !== "pending") {
    return sendError(res, 400, `Approval already ${existing.status}`, requestId);
  }
  const result = decideApproval(
    parsed.data.approvalId,
    parsed.data.decision,
    parsed.data.approverName ?? "Animesh",
  );
  recordActivity({
    projectId: existing.project_id,
    actorType: "user",
    actorId: currentUserId(),
    eventType: parsed.data.decision === "approve" ? "approval_granted" : "approval_rejected",
    title: parsed.data.decision === "approve" ? "Approval granted" : "Approval rejected",
    description: existing.reason,
    prId: existing.pr_id ?? null,
    tool: "Composio",
  });
  recordMemory({
    projectId: existing.project_id,
    source: "XTrace",
    title: `Approval decision: ${existing.reason}`,
    body: `${parsed.data.approverName ?? "Animesh"} ${parsed.data.decision === "approve" ? "approved" : "rejected"} this approval. Risk: ${existing.risk_level}.`,
    prId: existing.pr_id ?? null,
  });
  await syncProjectReviewArtifactsToButterbase(existing.project_id);
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
  const exists = getScopedPullRequest(parsed.data.prId);
  if (!exists) return sendError(res, 404, "PR not found", requestId);
  approvePr(parsed.data.prId, parsed.data.approverName ?? "Animesh");
  await syncProjectReviewArtifactsToButterbase(exists.project_id);
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
  const pr = getScopedPullRequest(parsed.data.prId);
  if (!pr) return sendError(res, 404, "PR not found", requestId);
  if (!pr.merged_at && pr.status !== "approved") {
    return sendError(res, 400, "PR has not been merged — nothing to roll back", requestId);
  }
  if (pr.status === "rolled_back") {
    return sendError(res, 400, "PR is already rolled back", requestId);
  }

  d.prepare(
    `UPDATE pull_requests
       SET status = 'rolled_back',
           rolled_back_at = ?,
           rolled_back_by = ?
     WHERE id = ?`,
  ).run(Date.now(), "Animesh", pr.id);
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
  await syncProjectReviewArtifactsToButterbase(pr.project_id);
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
  const pr = getScopedPullRequest(parsed.data.prId);
  if (!pr) return sendError(res, 404, "PR not found", requestId);

  d.prepare(`UPDATE pull_requests SET status = 'changes_requested' WHERE id = ?`).run(pr.id);
  // Send the original task back to building so the agent can pick it up
  // again — otherwise the PR is "stuck" with no path to resolution.
  if (pr.task_id) {
    d.prepare(
      `UPDATE tasks SET status = 'backlog' WHERE id = ? AND status IN ('review', 'done')`,
    ).run(pr.task_id);
  }
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
  await syncTasksToButterbase(tasks);
  await syncProjectReviewArtifactsToButterbase(pr.project_id);
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
    const a = getScopedApproval(parsed.data.approvalId);
    if (!a) return sendError(res, 404, "Approval not found", requestId);
    reason = a.reason;
    details = a.details;
    riskLevel = a.risk_level;
  } else if (parsed.data.prId) {
    const p = getScopedPullRequest(parsed.data.prId);
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
  if (environment === "production") {
    return sendJson(
      res,
      403,
      {
        ok: false,
        error: "production_deploy_requires_preflight",
        message: "Use /api/deploy-production for production deploys.",
      },
      requestId,
    );
  }
  const projectId = await getCurrentProjectId();
  try {
    const result = await runConfiguredDeployment(projectId, parsed.data.prId ?? null, environment);
    const id = recordDeployment(projectId, parsed.data.prId ?? null, environment, "live", {
      url: result.url,
      provider: result.provider,
      buildLogs: result.buildLogs,
    });
    await syncDeploymentToButterbase(id);
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: `${environment}_deployed`,
      title: `${capitalize(environment)} deploy went live`,
      description: `Provider: ${result.provider}. URL: ${result.url}.`,
      prId: parsed.data.prId ?? null,
      deploymentId: id,
      tool: "RocketRide",
    });
    sendJson(
      res,
      200,
      { deploymentId: id, status: "live", url: result.url, simulated: result.simulated },
      requestId,
    );
  } catch (error) {
    const err = error as Error & {
      code?: string;
      missing?: string[];
      status?: number;
      body?: unknown;
    };
    const id = recordDeployment(projectId, parsed.data.prId ?? null, environment, "failed", {
      provider: getDeploymentConfig().provider,
      failureMessage: err.message,
      buildLogs: JSON.stringify(
        {
          code: err.code ?? "deploy_failed",
          missing: err.missing,
          status: err.status,
          body: err.body,
        },
        null,
        2,
      ),
    });
    await syncDeploymentToButterbase(id);
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: "deploy_failed",
      title: `${capitalize(environment)} deploy failed`,
      description: err.message,
      prId: parsed.data.prId ?? null,
      deploymentId: id,
      tool: "RocketRide",
    });
    sendJson(
      res,
      err.code === "deploy_not_configured" ? 409 : 502,
      {
        ok: false,
        error: err.code ?? "deploy_failed",
        message: err.message,
        deploymentId: id,
        missing: err.missing,
      },
      requestId,
    );
  }
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
  const deploymentConfig = getDeploymentConfig();
  if (parsed.data.fail && !deploymentConfig.allowFailureInjection) {
    return sendJson(
      res,
      403,
      {
        ok: false,
        error: "failure_injection_disabled",
        message: "Failure injection is disabled for this deployment mode.",
      },
      requestId,
    );
  }

  if (parsed.data.fail) {
    const id = recordDeployment(projectId, null, "production", "failed", {
      provider: "simulation",
      failureMessage: "Injected production deploy failure",
      buildLogs: "Failure injection: previous live version remains active.",
    });
    await syncDeploymentToButterbase(id);
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: "deploy_failed",
      title: "Production deploy failed",
      description: "Injected failure: previous live version remains active.",
      deploymentId: id,
      tool: "RocketRide",
    });
    return sendJson(
      res,
      200,
      {
        deploymentId: id,
        status: "failed",
        simulated: true,
        message: "Deploy failed but previous version is still live.",
      },
      requestId,
    );
  }

  const readiness = getDeploymentReadiness(projectId);
  if (!readiness.canDeployProduction) {
    const failed = readiness.checks.filter((check) => check.blocking && !check.passed);
    return sendJson(
      res,
      409,
      {
        ok: false,
        error: "production_preflight_failed",
        message: "Production deploy blocked until all preflight checks pass.",
        failed,
        deploymentReadiness: readiness,
      },
      requestId,
    );
  }

  try {
    const result = await runConfiguredDeployment(projectId, null, "production");
    const previousLive = listDeployments(projectId).find(
      (deployment) => deployment.environment === "production" && deployment.status === "live",
    ) as { id: string } | undefined;
    const id = recordDeployment(projectId, null, "production", "live", {
      url: result.url,
      provider: result.provider,
      buildLogs: result.buildLogs,
      rollbackTargetId: previousLive?.id ?? null,
    });
    await syncDeploymentToButterbase(id);
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: "production_deployed",
      title: "Production deploy went live",
      description: `Provider: ${result.provider}. URL: ${result.url}.`,
      deploymentId: id,
      tool: "RocketRide",
    });
    sendJson(
      res,
      200,
      {
        deploymentId: id,
        status: "live",
        url: result.url,
        simulated: result.simulated,
        rollbackTargetId: previousLive?.id ?? null,
      },
      requestId,
    );
  } catch (error) {
    const err = error as Error & {
      code?: string;
      missing?: string[];
      status?: number;
      body?: unknown;
    };
    const id = recordDeployment(projectId, null, "production", "failed", {
      provider: deploymentConfig.provider,
      failureMessage: err.message,
      buildLogs: JSON.stringify(
        {
          code: err.code ?? "deploy_failed",
          missing: err.missing,
          status: err.status,
          body: err.body,
        },
        null,
        2,
      ),
    });
    await syncDeploymentToButterbase(id);
    recordActivity({
      projectId,
      actorType: "system",
      actorId: null,
      eventType: "deploy_failed",
      title: "Production deploy failed",
      description: err.message,
      deploymentId: id,
      tool: "RocketRide",
    });
    sendJson(
      res,
      err.code === "deploy_not_configured" ? 409 : 502,
      {
        ok: false,
        error: err.code ?? "deploy_failed",
        message: err.message,
        deploymentId: id,
        missing: err.missing,
      },
      requestId,
    );
  }
}

async function handleReset(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  if (!demoEndpointsAllowed()) return sendError(res, 403, "Demo endpoints are disabled", requestId);
  const d = getDb();
  const projectId = await getCurrentProjectId();
  // One-time dedup of agents per (project_id, type). Earlier versions of the
  // app could create duplicate agents if /api/intake ran on the canonical demo
  // project after the scaffold. The canonical agent for each type is
  // `agent-${type}-demo`; we keep that and delete UUID-suffixed duplicates.
  d.prepare(
    `DELETE FROM agents
     WHERE id != 'agent-product-demo'
       AND id != 'agent-design-demo'
       AND id != 'agent-frontend-demo'
       AND id != 'agent-backend-demo'
       AND id != 'agent-qa-demo'
       AND id != 'agent-devops-demo'
       AND id != 'agent-auth-demo'
       AND id != 'agent-safety-demo'
       AND id != 'agent-recovery-demo'
       AND project_id = ?`,
  ).run(DEMO_PROJECT_ID);
  // changes is keyed by pr_id, not project_id — wipe it via the PR join first.
  d.prepare(
    `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
  ).run(projectId);
  const tables = [
    "chat_messages",
    "approvals",
    "deployments",
    "recovery_events",
    "activity_events",
    "memory_entries",
    "rocketride_workflow_runs",
    "runtime_checks",
    "agent_runs",
    "pull_requests",
    "tasks",
    // Note: "agents" is intentionally NOT in this list. Agents are part of the
    // project scaffolding and survive a reset so the user can keep interacting
    // with the (now empty) project. Re-scaffolding after the wipe below
    // handles the edge case where agents were somehow missing.
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
  // For non-canonical projects we wipe EVERYTHING (including agents) because
  // we're deleting the whole project; the canonical project keeps its agents
  // (see the scaffold step below).
  const nonCanonical = d.prepare(`SELECT id FROM projects WHERE id != ?`).all(DEMO_PROJECT_ID) as {
    id: string;
  }[];
  if (nonCanonical.length > 0) {
    const fullTables = [...tables, "agents"];
    for (const { id: pid } of nonCanonical) {
      d.prepare(
        `DELETE FROM changes WHERE pr_id IN (SELECT id FROM pull_requests WHERE project_id = ?)`,
      ).run(pid);
      for (const t of fullTables) d.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(pid);
      d.prepare(`DELETE FROM notifications WHERE project_id = ?`).run(pid);
      d.prepare(`DELETE FROM projects WHERE id = ?`).run(pid);
    }
  }
  // Re-scaffold the canonical demo project so it always has its 9 agents.
  if (projectId === DEMO_PROJECT_ID) {
    try {
      scaffoldDemoProject();
    } catch {
      // If re-scaffold fails, the project still exists with whatever agents it had.
    }
    d.prepare(
      `INSERT INTO workspace_prefs (workspace_id, key, value, updated_at) VALUES (?, 'demoDataPopulated', 'false', ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = 'false', updated_at = excluded.updated_at`,
    ).run(currentWorkspaceId(), Date.now());
  }
  sendJson(res, 200, { ok: true }, requestId);
}

const CommentSchema = z.object({
  text: z.string().min(1).max(600),
  selector: z.string().max(400).optional().nullable(),
});

async function handleClearPreviewComments(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  const removed = await getButterbaseRepository().clearPreviewComments(projectId);
  sendJson(res, 200, { ok: true, removed }, requestId);
}

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

  const projectId = await getCurrentProjectId();
  const commentId = ids.newComment();
  await getButterbaseRepository().createPreviewComment({
    id: commentId,
    projectId,
    selector: selector ?? null,
    text,
  });

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
  await syncTasksToButterbase(tasks);

  // Log the conversion as an assistant chat message so the user sees it.
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content: `Turned your preview comment into a task: "${taskSpec.title}" → ${taskSpec.ownerAgent}.`,
    metadata: JSON.stringify({
      kind: "task_created",
      taskIds: tasks.map((t) => t.id),
      source: "preview_comment",
      commentId,
    }),
  });
  recordActivity({
    projectId,
    actorType: "user",
    actorId: currentUserId(),
    eventType: "preview_comment",
    title: "Preview comment became a task",
    description: text,
    taskId: tasks[0]?.id ?? null,
    tool: "XTrace",
  });
  recordMemory({
    projectId,
    source: "XTrace",
    title: `Preview feedback: ${taskSpec.title}`,
    body: selector ? `${text} Selector: ${selector}.` : text,
    taskId: tasks[0]?.id ?? null,
  });

  const rows = await getButterbaseRepository().listPreviewComments(projectId);
  sendJson(res, 200, { comments: rows, task: tasks[0] }, requestId);
}

// ---------- simple GET helpers ----------------------------------------------

async function handleGetTasks(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  const tasks = await getButterbaseRepository().listTasks(projectId);
  sendJson(res, 200, tasks, requestId);
}

async function handleGetPrs(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listPullRequests(projectId), requestId);
}

async function handleGetAgents(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listAgents(projectId), requestId);
}

async function handleGetFailures(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listRecoveryEvents(projectId), requestId);
}

async function handleGetApprovals(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listApprovals(projectId), requestId);
}

async function handleGetTeam(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  sendJson(
    res,
    200,
    await getButterbaseRepository().listTeamMembers(currentWorkspaceId()),
    requestId,
  );
}

const AddTeamSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(["owner", "admin", "manager", "staff", "reviewer", "viewer"]).optional(),
  email: z.string().trim().email().max(160).optional(),
});

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "member"
  );
}

async function handleAddTeamMember(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const parsed = AddTeamSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid team payload", requestId, {
      issues: parsed.error.issues,
    });
  const d = getDb();
  const role = parsed.data.role ?? "staff";
  if (role === "owner") {
    return sendJson(
      res,
      403,
      {
        ok: false,
        error: "owner_transfer_required",
        message: "Owner seats can only be changed through an explicit owner-transfer flow.",
      },
      requestId,
    );
  }
  if (role === "admin" && currentAuth().role !== "owner") {
    return sendJson(
      res,
      403,
      {
        ok: false,
        error: "owner_required_for_admin_invite",
        message: "Only workspace owners can invite admins.",
      },
      requestId,
    );
  }
  const email = parsed.data.email?.toLowerCase();
  let userId: string | null = null;
  if (email) {
    const existingUser = d.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email) as
      | { id: string }
      | undefined;
    userId = existingUser?.id ?? `user-${randomUUID()}`;
    if (!existingUser) {
      d.prepare(
        `INSERT INTO users (id, name, email, avatar_url, role, created_at) VALUES (?, ?, ?, NULL, ?, ?)`,
      ).run(userId, parsed.data.displayName, email, role, Date.now());
    }
  }
  if (userId) {
    const user = d.prepare("SELECT * FROM users WHERE id = ?").get(userId) as User;
    await getButterbaseRepository().syncUser(user);
  }
  const slug = slugify(parsed.data.displayName);
  // Stable-but-unique id: re-rolls the random suffix if it collides (rare).
  let id = `tm-${slug}-${ids.newPR().slice(0, 6)}`;
  for (let i = 0; i < 5; i++) {
    const exists = d.prepare("SELECT id FROM team_members WHERE id = ?").get(id) as
      | { id: string }
      | undefined;
    if (!exists) break;
    id = `tm-${slug}-${ids.newPR().slice(0, 6)}`;
  }
  d.prepare(
    `INSERT INTO team_members (id, workspace_id, user_id, display_name, role, permissions, is_ai) VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    currentWorkspaceId(),
    userId,
    parsed.data.displayName,
    role,
    JSON.stringify(["approve", "request", "view"]),
  );
  const member = d.prepare("SELECT * FROM team_members WHERE id = ?").get(id) as
    | TeamMember
    | undefined;
  if (member) await getButterbaseRepository().syncTeamMember(member);
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId: await getCurrentProjectId(),
    kind: "system",
    title: `Invited ${parsed.data.displayName} to the team`,
    body: `Role: ${role}`,
    link: "/app/team",
  });
  sendJson(res, 200, { ok: true, member }, requestId);
}

async function handleRemoveTeamMember(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  id: string,
): Promise<void> {
  const d = getDb();
  const existing = d
    .prepare("SELECT id, role, display_name FROM team_members WHERE id = ? AND workspace_id = ?")
    .get(id, currentWorkspaceId()) as
    | { id: string; role: string; display_name: string }
    | undefined;
  if (!existing) return sendError(res, 404, "Team member not found", requestId);
  // Owner is the seeded demo user ("Sal") and cannot be removed — they're the
  // identity the platform anchors to. Same for any future owner.
  if (existing.role === "owner" || existing.id === "tm-sal") {
    return sendError(res, 400, "Owners cannot be removed", requestId);
  }
  const butterbaseRepository = getButterbaseRepository();
  const removed = await butterbaseRepository.removeTeamMember(currentWorkspaceId(), id);
  if (butterbaseRepository.mode === "remote") {
    d.prepare("DELETE FROM team_members WHERE id = ? AND workspace_id = ?").run(
      id,
      currentWorkspaceId(),
    );
  }
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId: await getCurrentProjectId(),
    kind: "system",
    title: `Removed ${existing.display_name} from the team`,
    body: `Role: ${existing.role}`,
    link: "/app/team",
  });
  sendJson(res, 200, { ok: true, removed: existing, removedCount: removed }, requestId);
}

async function handleGetChat(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  const rows = await getButterbaseRepository().listChatMessages(projectId);
  sendJson(res, 200, rows, requestId);
}

async function handleGetDeployments(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): Promise<void> {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listDeployments(projectId), requestId);
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
  const repository = getButterbaseRepository();
  const tasks = await repository.listTasks(projectId);
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  const rows = await repository.listAgentRuns(projectId, agentId);
  const checks = await repository.listRuntimeChecks(projectId);
  const checksByRunId = new Map<string, unknown[]>();
  for (const check of checks) {
    const existing = checksByRunId.get(check.agent_run_id) ?? [];
    existing.push({
      id: check.id,
      check_type: check.check_type,
      status: check.status,
      summary: check.summary,
      artifact_path: check.artifact_path,
      completed_at: check.completed_at,
    });
    checksByRunId.set(check.agent_run_id, existing);
  }
  const enriched = rows.map((row) => ({
    ...row,
    task_title: row.task_id ? (taskTitles.get(row.task_id) ?? null) : null,
    runtimeChecks: checksByRunId.get(row.id) ?? [],
  }));
  sendJson(res, 200, enriched, requestId);
}

// ---------- new vibecoding endpoints ----------------------------------------

// Notifications
async function handleListNotifications(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  const repository = getButterbaseRepository();
  const rows = await repository.listNotifications(currentWorkspaceId(), 50);
  const unread = await repository.unreadNotifications(currentWorkspaceId());
  sendJson(res, 200, { notifications: rows, unread }, requestId);
}
const NotifReadSchema = z.object({ notificationId: z.string().min(1) });
async function handleMarkNotifRead(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = NotifReadSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const repository = getButterbaseRepository();
  const exists = (await repository.listNotifications(currentWorkspaceId(), 500)).find(
    (notification) => notification.id === parsed.data.notificationId,
  );
  if (!exists) return sendError(res, 404, "Notification not found", requestId);
  await repository.markNotificationRead(currentWorkspaceId(), parsed.data.notificationId);
  sendJson(
    res,
    200,
    { ok: true, unread: await repository.unreadNotifications(currentWorkspaceId()) },
    requestId,
  );
}
async function handleMarkAllNotifRead(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  await getButterbaseRepository().markAllNotificationsRead(currentWorkspaceId());
  sendJson(res, 200, { ok: true, unread: 0 }, requestId);
}

// Branches / commits / worktrees
async function handleListBranches(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listBranches(projectId), requestId);
}
async function handleListCommits(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const branchId = url.searchParams.get("branchId") ?? undefined;
  if (!branchId) return sendError(res, 400, "branchId is required", requestId);
  const projectId = await getCurrentProjectId();
  const exists = getScopedBranch(branchId);
  if (!exists) return sendError(res, 404, "Branch not found", requestId);
  sendJson(res, 200, await getButterbaseRepository().listCommits(projectId, branchId), requestId);
}
const MergeSchema = z.object({ branchId: z.string().min(1) });
async function handleMergeBranch(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = MergeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  // Look up the branch first so we can detect re-merge attempts and avoid
  // recording duplicate "Merged ... into ..." commits on retry.
  const before = getScopedBranch(parsed.data.branchId);
  if (!before) return sendError(res, 404, "Branch not found", requestId);
  const wasAlreadyMerged = before.status === "merged";
  const branch = mergeBranch(parsed.data.branchId);
  if (!branch) return sendError(res, 404, "Branch not found", requestId);
  const projectId = await getCurrentProjectId();
  // Promote the linked PR to "merged" so the Changes screen + risk matrix stay
  // consistent. (handleApproval had been doing this implicitly for high-risk
  // PRs, but a manual branch merge should also flip the PR.)
  if (branch.head_pr_id) {
    d.prepare(
      `UPDATE pull_requests SET status = 'merged', merged_at = COALESCE(merged_at, ?) WHERE id = ? AND status IN ('open', 'approved', 'changes_requested')`,
    ).run(Date.now(), branch.head_pr_id);
  }
  if (!wasAlreadyMerged) {
    const commit = recordCommit({
      projectId,
      branchId: branch.id,
      prId: branch.head_pr_id,
      message: `Merged ${branch.name} into ${branch.base_branch}`,
      author: "Sal",
      filesChanged: 0,
    });
    const butterbase = getButterbaseRepository();
    if (butterbase.mode === "remote") {
      await Promise.all([butterbase.syncBranch(branch), butterbase.syncCommit(commit)]);
      if (branch.head_pr_id) {
        const pr = getScopedPullRequest(branch.head_pr_id);
        if (pr) await butterbase.syncPullRequest(pr);
      }
    }
    const wsRow = d.prepare("SELECT workspace_id FROM projects WHERE id = ?").get(projectId) as
      | { workspace_id: string }
      | undefined;
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
  }
  sendJson(res, 200, { ok: true, branch, alreadyMerged: wasAlreadyMerged }, requestId);
}
async function handleArchiveBranch(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = MergeSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const exists = getScopedBranch(parsed.data.branchId);
  if (!exists) return sendError(res, 404, "Branch not found", requestId);
  const branch = archiveBranch(parsed.data.branchId);
  if (!branch) return sendError(res, 404, "Branch not found", requestId);
  const butterbase = getButterbaseRepository();
  if (butterbase.mode === "remote") await butterbase.syncBranch(branch);
  sendJson(res, 200, { ok: true, branch }, requestId);
}
async function handleListWorktrees(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const projectId = await getCurrentProjectId();
  sendJson(res, 200, await getButterbaseRepository().listWorktrees(projectId), requestId);
}
const SpawnWtSchema = z.object({
  branchId: z.string().min(1).optional(),
  name: z.string().min(1).max(80),
});
async function handleSpawnWorktree(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = SpawnWtSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const projectId = await getCurrentProjectId();
  if (parsed.data.branchId && !getScopedBranch(parsed.data.branchId)) {
    return sendError(res, 404, "Branch not found", requestId);
  }
  const wt = spawnWorktree({
    projectId,
    branchId: parsed.data.branchId ?? null,
    name: parsed.data.name,
    previewUrl: `https://wt-${Math.random().toString(36).slice(2, 6)}.forgecloud.dev`,
  });
  const butterbase = getButterbaseRepository();
  if (butterbase.mode === "remote") await butterbase.syncWorktree(wt);
  sendJson(res, 200, { ok: true, worktree: wt }, requestId);
}

// Connections / discoveries / suggested apps
async function handleListConnections(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  sendJson(
    res,
    200,
    await getButterbaseRepository().listConnections(currentWorkspaceId()),
    requestId,
  );
}
const ConnectSchema = z.object({
  provider: z.string().min(1),
  account: z.string().max(120).optional(),
});
async function handleConnectTool(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = ConnectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM connections WHERE workspace_id = ? AND provider = ?")
    .get(currentWorkspaceId(), parsed.data.provider) as { id: string } | undefined;
  if (!row) return sendError(res, 404, "Connector not found", requestId);
  const composio = await connectViaComposio({
    workspaceId: currentWorkspaceId(),
    provider: parsed.data.provider,
    accountLabel: parsed.data.account,
  });
  d.prepare(
    `UPDATE connections
        SET status = ?,
            account_label = ?,
            source = 'composio',
            toolkit_slug = ?,
            auth_config_id = ?,
            external_account_id = ?,
            connect_url = ?,
            sync_status = ?,
            sync_detail = ?,
            connected_at = CASE WHEN ? = 'connected' THEN ? ELSE connected_at END,
            last_synced_at = ?
      WHERE id = ?`,
  ).run(
    composio.status,
    composio.accountLabel,
    composio.toolkitSlug,
    composio.authConfigId,
    composio.externalAccountId,
    composio.connectUrl,
    composio.status,
    composio.syncDetail,
    composio.status,
    Date.now(),
    Date.now(),
    row.id,
  );
  const updatedConnection = d.prepare("SELECT * FROM connections WHERE id = ?").get(row.id) as
    | Connection
    | undefined;
  if (updatedConnection) await getButterbaseRepository().syncConnection(updatedConnection);
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId: await getCurrentProjectId(),
    kind: "system",
    title: `${parsed.data.provider} connected through Composio`,
    body: composio.syncDetail,
    link: "/app/connect",
  });
  sendJson(res, 200, { ok: true, connection: updatedConnection }, requestId);
}
async function handleDisconnectTool(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = ConnectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const row = d
    .prepare(
      "SELECT id, external_account_id FROM connections WHERE workspace_id = ? AND provider = ?",
    )
    .get(currentWorkspaceId(), parsed.data.provider) as
    | { id: string; external_account_id: string | null }
    | undefined;
  if (!row) return sendError(res, 404, "Connector not found", requestId);
  await disconnectViaComposio({
    provider: parsed.data.provider,
    externalAccountId: row.external_account_id,
  });
  d.prepare(
    `UPDATE connections
        SET status = 'available',
            account_label = NULL,
            external_account_id = NULL,
            connect_url = NULL,
            sync_status = 'disconnected',
            sync_detail = 'Disconnected from Composio',
            connected_at = NULL,
            last_synced_at = ?
      WHERE id = ?`,
  ).run(Date.now(), row.id);
  const updatedConnection = d.prepare("SELECT * FROM connections WHERE id = ?").get(row.id) as
    | Connection
    | undefined;
  if (updatedConnection) await getButterbaseRepository().syncConnection(updatedConnection);
  sendJson(res, 200, { ok: true }, requestId);
}
async function handleScanConnections(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const scanResult = await scanWithComposio({
    db: d,
    workspaceId: currentWorkspaceId(),
    projectId,
  });
  const repository = getButterbaseRepository();
  const localRows = d
    .prepare(
      `SELECT * FROM discoveries
        WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
        ORDER BY created_at ASC`,
    )
    .all(currentWorkspaceId(), projectId) as Discovery[];
  for (const row of localRows) await repository.syncDiscovery(row);
  const localSuggestedApps = d
    .prepare(
      `SELECT * FROM suggested_apps
        WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
        ORDER BY created_at ASC`,
    )
    .all(currentWorkspaceId(), projectId) as SuggestedApp[];
  for (const row of localSuggestedApps) await repository.syncSuggestedApp(row);
  const rows = await repository.listDiscoveries(currentWorkspaceId(), projectId);
  sendJson(
    res,
    200,
    {
      discoveries: rows,
      composio: {
        signals: scanResult.signals.length,
        executions: scanResult.executions,
        suggestions: scanResult.suggestions.length,
      },
    },
    requestId,
  );
}
async function handleListSuggested(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const projectId = await getCurrentProjectId();
  const rows = await getButterbaseRepository().listSuggestedApps(currentWorkspaceId(), projectId);
  sendJson(res, 200, { suggestedApps: rows }, requestId);
}
const BuildAppSchema = z.object({ appId: z.string().min(1) });
async function handleBuildSuggestedApp(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  const parsed = BuildAppSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const d = getDb();
  const projectId = await getCurrentProjectId();
  const app = (
    await getButterbaseRepository().listSuggestedApps(currentWorkspaceId(), projectId)
  ).find((candidate) => candidate.id === parsed.data.appId) as SuggestedApp | undefined;
  if (!app) return sendError(res, 404, "App not found", requestId);
  d.prepare("UPDATE projects SET name = ?, description = ?, status = 'planning' WHERE id = ?").run(
    app.title,
    app.description,
    projectId,
  );
  const updatedProject = d.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | Project
    | undefined;
  if (updatedProject) await getButterbaseRepository().syncProject(updatedProject);
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
  await syncTasksToButterbase(tasks);
  await getButterbaseRepository().addChatMessage({
    id: ids.newMessage(),
    projectId,
    role: "assistant",
    content: `Starting build for ${app.title}. ${tasks.length} tasks queued.`,
    metadata: JSON.stringify({ kind: "task_created", taskIds: tasks.map((t) => t.id) }),
  });
  sendJson(res, 200, { ok: true, project: getProject(projectId), tasks }, requestId);
}

// Manual task creation
const AddTaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(800).optional(),
  ownerAgent: z.string().trim().min(1).max(60).optional(),
  riskLevel: z.enum(["low", "med", "high"]).optional(),
  reviewer: z.string().trim().max(60).optional(),
});
async function handleAddTask(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = AddTaskSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
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
  await syncTasksToButterbase(tasks);
  createNotification({
    workspaceId: currentWorkspaceId(),
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
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const projectId = await getCurrentProjectId();
  const d = getDb();
  // Find the most relevant PR/change by fuzzy match on the label or selector.
  // Token-based fuzzy search: try the full label first, then each word > 3 chars.
  const tokens = [
    parsed.data.label.toLowerCase(),
    ...parsed.data.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3),
  ];
  const stmt = d.prepare(
    `SELECT c.*, p.number AS pr_number, p.title AS pr_title, p.summary AS pr_summary, a.name AS agent_name
       FROM changes c
       LEFT JOIN pull_requests p ON p.id = c.pr_id
       LEFT JOIN agents a ON a.id = c.agent_id
       WHERE p.project_id = ?
         AND (LOWER(c.plain_english_summary) LIKE ? OR LOWER(c.file_path) LIKE ? OR LOWER(p.title) LIKE ? OR LOWER(p.summary) LIKE ?)
       ORDER BY p.created_at DESC LIMIT 1`,
  );
  type BlameChangeMatch = {
    pr_number: number;
    pr_title: string;
    pr_summary: string;
    agent_name: string;
    plain_english_summary: string;
  };
  let change: BlameChangeMatch | undefined;
  for (const tok of tokens) {
    const needle = `%${tok}%`;
    change = stmt.get(projectId, needle, needle, needle, needle) as BlameChangeMatch | undefined;
    if (change) break;
  }
  const xtrace = await searchXTraceMemory(getDb(), {
    projectId,
    query: `${parsed.data.label} ${parsed.data.selector ?? ""}`,
  });
  const memoryContext = xtrace.records
    .slice(0, 3)
    .map((memory) => `${memory.title}: ${memory.body}`)
    .join("\n");
  const provenance = xtrace.records.slice(0, 4).map((memory) => ({
    kind: "memory",
    label: memory.title,
    detail: memory.body,
  }));

  const provider = getProvider();
  if (!change) {
    const reply = memoryContext
      ? `Couldn't find a specific code change tied to "${parsed.data.label}", but XTrace remembers: ${memoryContext}`
      : `Couldn't find a specific change tied to "${parsed.data.label}". The whole dashboard was built across PRs #1 through #5 by Product, Design, Frontend, Backend, QA, Safety, and DevOps Agents.`;
    return sendJson(
      res,
      200,
      {
        explanation: reply,
        provider: provider?.name ?? "Fallback",
        xtrace,
        xtraceMode: xtrace.mode,
        provenance,
      },
      requestId,
    );
  }
  const promptCtx = `User clicked: "${parsed.data.label}"\nMatched PR #${change.pr_number}: ${change.pr_title}\nPR summary: ${change.pr_summary}\nChange summary: ${change.plain_english_summary}\nAgent who built it: ${change.agent_name}\nXTrace memory:\n${memoryContext || "No related memory found."}`;
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
  sendJson(
    res,
    200,
    {
      explanation: reply,
      provider: provider?.name ?? "Fallback",
      prNumber: change.pr_number,
      xtrace,
      xtraceMode: xtrace.mode,
      provenance: [
        {
          kind: "pr",
          label: `PR #${change.pr_number}: ${change.pr_title}`,
          detail: change.pr_summary,
        },
        {
          kind: "change",
          label: change.agent_name,
          detail: change.plain_english_summary,
        },
        ...provenance,
      ],
    },
    requestId,
  );
}

// Multi-project
const NewProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});
async function handleNewProject(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = NewProjectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const butterbaseRepository = getButterbaseRepository();
  const id = ids.newProject();
  const project = await butterbaseRepository.createProject({
    id,
    workspaceId: currentWorkspaceId(),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    status: "intake",
  });
  mirrorProjectForLocalRuntime(project);
  const agents = createAgentsForProject(id);
  if (butterbaseRepository.mode === "remote") {
    await Promise.all(agents.map((agent) => butterbaseRepository.syncAgent(agent)));
  }
  // Activate the new project immediately so the workspace jumps to it
  // (matches the behavior of the project switcher).
  await butterbaseRepository.setActiveProjectId(currentWorkspaceId(), id);
  createNotification({
    workspaceId: currentWorkspaceId(),
    projectId: id,
    kind: "system",
    title: `New project: ${parsed.data.name}`,
    body: parsed.data.description ?? "Workspace ready.",
    link: "/app/intake",
  });
  sendJson(res, 200, { ok: true, project, activeProjectId: id }, requestId);
}
async function handleListProjects(_req: IncomingMessage, res: ServerResponse, requestId: string) {
  const butterbaseRepository = getButterbaseRepository();
  const rows = await butterbaseRepository.listProjects(currentWorkspaceId());
  const activeId = await butterbaseRepository.getActiveProjectId(currentWorkspaceId());
  sendJson(res, 200, { projects: rows, activeProjectId: activeId }, requestId);
}
const SwitchProjectSchema = z.object({ projectId: z.string().min(1) });
async function handleSwitchProject(req: IncomingMessage, res: ServerResponse, requestId: string) {
  const parsed = SwitchProjectSchema.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return sendError(res, 400, "Invalid payload", requestId, { issues: parsed.error.issues });
  const butterbaseRepository = getButterbaseRepository();
  const project = await butterbaseRepository.getProject(parsed.data.projectId);
  if (!project || project.workspace_id !== currentWorkspaceId()) {
    return sendError(res, 404, "Project not found", requestId);
  }
  await butterbaseRepository.setActiveProjectId(currentWorkspaceId(), parsed.data.projectId);
  sendJson(res, 200, { ok: true, projectId: project.id, projectName: project.name }, requestId);
}
async function handleListDiscoveries(
  _req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  const projectId = await getCurrentProjectId();
  const rows = await getButterbaseRepository().listDiscoveries(currentWorkspaceId(), projectId);
  sendJson(res, 200, { discoveries: rows }, requestId);
}

async function handleRocketRideCallback(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
) {
  const auth = verifyRocketRideCallbackAuth(req);
  if (auth.missingRequiredSecret) {
    return sendError(res, 503, "RocketRide callback secret is not configured", requestId);
  }
  if (!auth.ok) return sendError(res, 401, "Invalid RocketRide callback secret", requestId);

  const parsed = RocketRideCallbackSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return sendError(res, 400, "Invalid RocketRide callback payload", requestId, {
      issues: parsed.error.issues,
    });
  }

  const run = await applyRocketRideCallback(parsed.data);
  sendJson(
    res,
    200,
    {
      ok: true,
      authConfigured: auth.configured,
      workflowRun: run,
    },
    requestId,
  );
}

// ---------- router ----------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse, requestId: string) => Promise<void>;

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  rate?: RateLimitConfig;
  permission?: Permission;
  public?: boolean;
  entitlement?: EntitlementAction;
}> = [
  // GET (cheap)
  { method: "GET", pattern: /^\/api\/health$/, handler: handleGetHealth, public: true },
  {
    method: "GET",
    pattern: /^\/api\/auth\/session$/,
    handler: handleGetSession,
    rate: RATE_CONFIGS.cheap,
    public: true,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/request-login$/,
    handler: handleRequestLogin,
    rate: RATE_CONFIGS.expensive,
    public: true,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    handler: handleLogin,
    rate: RATE_CONFIGS.expensive,
    public: true,
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    handler: handleLogout,
    rate: RATE_CONFIGS.cheap,
    public: true,
  },
  {
    method: "POST",
    pattern: /^\/api\/rocketride\/callback$/,
    handler: handleRocketRideCallback,
    rate: RATE_CONFIGS.expensive,
    public: true,
  },
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
  {
    method: "POST",
    pattern: /^\/api\/team$/,
    handler: handleAddTeamMember,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_team",
    entitlement: "add_team_member",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/team\/[^/]+$/,
    handler: (req, res, rid) => {
      const pathname = (req.url ?? "").split("?")[0];
      const id = decodeURIComponent(pathname.replace(/^\/api\/team\//, ""));
      return handleRemoveTeamMember(req, res, rid, id);
    },
    rate: RATE_CONFIGS.cheap,
    permission: "manage_team",
  },
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
    permission: "build",
    entitlement: "create_task",
  },
  {
    method: "POST",
    pattern: /^\/api\/chat$/,
    handler: handleChat,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
  },
  {
    method: "POST",
    pattern: /^\/api\/run-task$/,
    handler: handleRunTask,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
    entitlement: "run_agent",
  },
  {
    method: "POST",
    pattern: /^\/api\/run-all$/,
    handler: handleRunAll,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
    entitlement: "run_agent",
  },
  {
    method: "POST",
    pattern: /^\/api\/approve-plan$/,
    handler: handleApprovePlan,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
    entitlement: "run_agent",
  },
  {
    method: "POST",
    pattern: /^\/api\/run-my-tasks$/,
    handler: handleRunMyTasks,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
    entitlement: "run_agent",
  },
  {
    method: "POST",
    pattern: /^\/api\/run-full-demo$/,
    handler: handleRunFullDemo,
    rate: RATE_CONFIGS.expensive,
    permission: "admin",
  },
  {
    method: "POST",
    pattern: /^\/api\/seed-demo$/,
    handler: handleSeedDemo,
    rate: RATE_CONFIGS.cheap,
    permission: "admin",
  },
  {
    method: "POST",
    pattern: /^\/api\/skip-to-demo$/,
    handler: handleSkipToDemo,
    rate: RATE_CONFIGS.cheap,
    permission: "admin",
  },
  {
    method: "POST",
    pattern: /^\/api\/inject-failure$/,
    handler: handleInjectFailure,
    rate: RATE_CONFIGS.expensive,
    permission: "admin",
  },
  {
    method: "POST",
    pattern: /^\/api\/approval$/,
    handler: handleApproval,
    rate: RATE_CONFIGS.cheap,
    permission: "review",
  },
  {
    method: "POST",
    pattern: /^\/api\/approve-pr$/,
    handler: handleApprovePr,
    rate: RATE_CONFIGS.cheap,
    permission: "review",
  },
  {
    method: "POST",
    pattern: /^\/api\/rollback-pr$/,
    handler: handleRollbackPr,
    rate: RATE_CONFIGS.cheap,
    permission: "deploy_production",
  },
  {
    method: "POST",
    pattern: /^\/api\/request-edits$/,
    handler: handleRequestEdits,
    rate: RATE_CONFIGS.expensive,
    permission: "review",
  },
  {
    method: "POST",
    pattern: /^\/api\/explain$/,
    handler: handleExplain,
    rate: RATE_CONFIGS.expensive,
  },
  {
    method: "POST",
    pattern: /^\/api\/deploy$/,
    handler: handleDeploy,
    rate: RATE_CONFIGS.cheap,
    permission: "deploy_preview",
  },
  {
    method: "POST",
    pattern: /^\/api\/deploy-production$/,
    handler: handleDeployProduction,
    rate: RATE_CONFIGS.cheap,
    permission: "deploy_production",
    entitlement: "deploy_production",
  },
  {
    method: "POST",
    pattern: /^\/api\/reset$/,
    handler: handleReset,
    rate: RATE_CONFIGS.cheap,
    permission: "admin",
  },
  {
    method: "POST",
    pattern: /^\/api\/comment$/,
    handler: handleComment,
    rate: RATE_CONFIGS.expensive,
    permission: "review",
    entitlement: "create_task",
  },
  {
    method: "DELETE",
    pattern: /^\/api\/preview-comments$/,
    handler: handleClearPreviewComments,
    rate: RATE_CONFIGS.cheap,
    permission: "review",
  },
  // Notifications
  {
    method: "GET",
    pattern: /^\/api\/notifications$/,
    handler: handleListNotifications,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/notifications\/read$/,
    handler: handleMarkNotifRead,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/notifications\/read-all$/,
    handler: handleMarkAllNotifRead,
    rate: RATE_CONFIGS.cheap,
  },
  // Branches / commits / worktrees
  {
    method: "GET",
    pattern: /^\/api\/branches$/,
    handler: handleListBranches,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "GET",
    pattern: /^\/api\/commits$/,
    handler: handleListCommits,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/branches\/merge$/,
    handler: handleMergeBranch,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_branches",
  },
  {
    method: "POST",
    pattern: /^\/api\/branches\/archive$/,
    handler: handleArchiveBranch,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_branches",
  },
  {
    method: "GET",
    pattern: /^\/api\/worktrees$/,
    handler: handleListWorktrees,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/worktrees$/,
    handler: handleSpawnWorktree,
    rate: RATE_CONFIGS.cheap,
    permission: "build",
    entitlement: "run_agent",
  },
  // Connections + discoveries + suggestions
  {
    method: "GET",
    pattern: /^\/api\/connections$/,
    handler: handleListConnections,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/connect$/,
    handler: handleConnectTool,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_integrations",
    entitlement: "connect_tool",
  },
  {
    method: "POST",
    pattern: /^\/api\/disconnect$/,
    handler: handleDisconnectTool,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_integrations",
  },
  {
    method: "POST",
    pattern: /^\/api\/scan$/,
    handler: handleScanConnections,
    rate: RATE_CONFIGS.cheap,
    permission: "manage_integrations",
  },
  {
    method: "GET",
    pattern: /^\/api\/suggested-apps$/,
    handler: handleListSuggested,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/build-app$/,
    handler: handleBuildSuggestedApp,
    rate: RATE_CONFIGS.expensive,
    permission: "build",
    entitlement: "create_task",
  },
  // Manual task add
  {
    method: "POST",
    pattern: /^\/api\/add-task$/,
    handler: handleAddTask,
    rate: RATE_CONFIGS.cheap,
    permission: "build",
    entitlement: "create_task",
  },
  // Plain-English Blame
  {
    method: "POST",
    pattern: /^\/api\/blame$/,
    handler: handleBlame,
    rate: RATE_CONFIGS.expensive,
    permission: "review",
  },
  // Multi-project
  {
    method: "GET",
    pattern: /^\/api\/projects$/,
    handler: handleListProjects,
    rate: RATE_CONFIGS.cheap,
  },
  {
    method: "POST",
    pattern: /^\/api\/projects$/,
    handler: handleNewProject,
    rate: RATE_CONFIGS.cheap,
    permission: "build",
    entitlement: "create_project",
  },
  {
    method: "POST",
    pattern: /^\/api\/projects\/switch$/,
    handler: handleSwitchProject,
    rate: RATE_CONFIGS.cheap,
  },
  // Discoveries
  {
    method: "GET",
    pattern: /^\/api\/discoveries$/,
    handler: handleListDiscoveries,
    rate: RATE_CONFIGS.cheap,
  },
];

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;
  applyCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
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
      let ctxForAudit: AuthContext | null = null;
      let entitlementUsage: {
        kind: UsageKind;
        quantity: number;
        action: EntitlementAction;
      } | null = null;
      try {
        if (route.public) {
          await route.handler(req, res, requestId);
        } else {
          const ctx = await resolveAuthContext(req);
          ctxForAudit = ctx;
          await authContext.run(ctx, () => {
            if (route.permission) requirePermission(route.permission);
            return Promise.resolve().then(async () => {
              if (route.entitlement) {
                const quantity = await entitlementQuantity(route.entitlement, pathname);
                const decision = checkEntitlement(ctx.workspaceId, route.entitlement, quantity);
                if (!decision.allowed) {
                  sendEntitlementDenied(res, requestId, decision);
                  return;
                }
                const usageKind = usageKindFor(route.entitlement);
                if (usageKind) {
                  entitlementUsage = {
                    kind: usageKind,
                    quantity,
                    action: route.entitlement,
                  };
                }
              }
              return route.handler(req, res, requestId);
            });
          });
        }
        if (entitlementUsage && res.statusCode < 400 && ctxForAudit) {
          recordUsageEvent(
            ctxForAudit.workspaceId,
            entitlementUsage.kind,
            entitlementUsage.quantity,
            {
              route: pathname,
              action: entitlementUsage.action,
              requestId,
            },
          );
        }
        recordAuditEvent({
          requestId,
          req,
          route: pathname,
          permission: route.permission,
          auth: ctxForAudit,
          outcome: res.statusCode >= 400 ? "failure" : "success",
          statusCode: res.statusCode,
        });
        log.info("api_end", {
          requestId,
          route: pathname,
          ms: Date.now() - startedAt,
          status: res.statusCode,
        });
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        log.error("api_error", {
          requestId,
          route: pathname,
          ms: Date.now() - startedAt,
          error: error?.message,
          stack: error?.stack,
        });
        if (!res.headersSent)
          sendError(res, error.statusCode ?? 500, error?.message ?? "internal error", requestId);
        else res.end();
        recordAuditEvent({
          requestId,
          req,
          route: pathname,
          permission: route.permission,
          auth: ctxForAudit,
          outcome: "failure",
          statusCode: error.statusCode ?? (res.statusCode >= 400 ? res.statusCode : 500),
          error: error?.message ?? "internal error",
        });
      }
      return true;
    }
  }
  sendError(res, 404, `no route for ${req.method} ${pathname}`, requestId);
  return true;
}
