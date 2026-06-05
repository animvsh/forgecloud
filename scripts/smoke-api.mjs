import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-smoke-"));
process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "fallback";
process.env.FORGECLOUD_DEPLOY_MODE = process.env.FORGECLOUD_DEPLOY_MODE ?? "production";

const { handleApiRequest } = await import("../dist/server/api-handler.mjs");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function makeReq(method, url, body, requestHeaders = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url,
    headers: { ...(raw ? { "content-type": "application/json" } : {}), ...requestHeaders },
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (raw) yield Buffer.from(raw);
    },
  };
}

async function call(method, url, body, requestHeaders) {
  let status = 0;
  let responseBody = "";
  const responseHeaders = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    hasHeader(name) {
      return name.toLowerCase() in responseHeaders;
    },
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(chunk) {
      responseBody = chunk ? String(chunk) : "";
    },
  };
  const handled = await handleApiRequest(makeReq(method, url, body, requestHeaders), res);
  if (!handled) throw new Error(`${method} ${url} was not handled`);
  let json;
  if (responseBody) {
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new Error(`${method} ${url} returned non-JSON: ${responseBody.slice(0, 200)}`);
    }
  } else {
    json = null;
  }
  return { status: status || res.statusCode, json, headers: responseHeaders };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_APP_URL = "https://forgecloud-palembang.pages.dev";
  const previewCors = await call("OPTIONS", "/api/state", undefined, {
    origin: "https://preview-for-qa.forgecloud-palembang.pages.dev",
  });
  process.env.NODE_ENV = previousNodeEnv;
  process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  assert(
    previewCors.status === 204,
    `Cloudflare preview CORS expected 204, got ${previewCors.status}`,
  );
  assert(
    previewCors.headers["access-control-allow-origin"] ===
      "https://preview-for-qa.forgecloud-palembang.pages.dev",
    "Cloudflare preview CORS should echo same-project preview origin",
  );

  const externalDevFallback = await call("GET", "/api/state", undefined, {
    host: "forgecloud.example.com",
  });
  assert(
    externalDevFallback.status === 401,
    `/api/state with deployed host and no session expected 401, got ${externalDevFallback.status}`,
  );

  const initialSeed = await call("POST", "/api/seed-demo", {});
  assert(
    initialSeed.status === 200,
    `/api/seed-demo on fresh DB expected 200, got ${initialSeed.status}`,
  );
  assert(initialSeed.json.ok === true, "/api/seed-demo on fresh DB did not report ok");

  const health = await call("GET", "/api/health");
  assert(
    health.status === 503,
    `/api/health expected 503 without production deploy env, got ${health.status}`,
  );
  assert(health.json.ok === false, "/api/health should fail readiness without deploy env");
  assert(
    health.json.checks?.some((check) => check.name === "db_directory_write" && check.passed),
    "/api/health should verify DB directory writability",
  );
  assert(
    health.json.checks?.some((check) => check.name === "runtime_artifact_write" && check.passed),
    "/api/health should verify runtime artifact writability",
  );
  assert(
    health.json.checks?.some((check) => check.name === "deploy_config" && !check.passed),
    "/api/health should report missing production deploy config",
  );
  assert(
    health.json.deployment?.mode === "production",
    "/api/health should expose production deployment mode in smoke",
  );
  assert(
    health.json.deployment?.canDeployProduction === false,
    "/api/health should not report production deploy readiness without provider env",
  );

  const state = await call("GET", "/api/state");
  assert(state.status === 200, `/api/state expected 200, got ${state.status}`);
  assert(Array.isArray(state.json.tasks), "/api/state missing tasks array");
  assert(Array.isArray(state.json.agents), "/api/state missing agents array");
  assert(state.json.agents.length >= 9, "/api/state should seed the agent team");
  assert(
    state.json.deploymentReadiness?.canDeployProduction === false,
    "/api/state should block production deploys without provider config",
  );
  assert(state.json.entitlements?.plan === "pro", "/api/state should expose workspace plan");
  assert(
    state.json.entitlements?.limits?.productionDeploys === true,
    "/api/state should expose production deploy entitlement",
  );

  const seeded = await call("POST", "/api/seed-demo", {});
  assert(seeded.status === 200, `/api/seed-demo expected 200, got ${seeded.status}`);
  assert(seeded.json.ok === true, "/api/seed-demo did not report ok");

  const seededState = await call("GET", "/api/state");
  assert(
    seededState.status === 200,
    `/api/state after seed expected 200, got ${seededState.status}`,
  );
  assert(Array.isArray(seededState.json.tasks), "/api/state after seed missing tasks array");
  assert(seededState.json.tasks.length >= 12, "/api/state after seed should include demo tasks");

  const prs = await call("GET", "/api/prs");
  assert(prs.status === 200, `/api/prs expected 200, got ${prs.status}`);
  assert(Array.isArray(prs.json), "/api/prs did not return an array");
  assert(prs.json.length >= 5, "/api/prs should include seeded demo PRs");

  const branches = await call("GET", "/api/branches");
  assert(branches.status === 200, `/api/branches expected 200, got ${branches.status}`);
  assert(Array.isArray(branches.json), "/api/branches did not return an array");

  const backlogTask = seededState.json.tasks.find((task) => task.status === "backlog");
  assert(backlogTask, "/api/state after seed should include a backlog task to run");
  const runTask = await call("POST", "/api/run-task", { taskId: backlogTask.id });
  assert(runTask.status === 200, `/api/run-task expected 200, got ${runTask.status}`);
  assert(runTask.json.pr?.id, "/api/run-task did not create a PR");

  const smokeDb = new Database(process.env.INSFORGE_DB_PATH);
  const runtimeChecks = smokeDb
    .prepare(
      `SELECT check_type, status, summary, artifact_path
         FROM runtime_checks
        WHERE task_id = ?
        ORDER BY started_at ASC`,
    )
    .all(backlogTask.id);
  const runTaskAudit = smokeDb
    .prepare(
      `SELECT route, method, outcome, status_code
         FROM audit_events
        WHERE route = '/api/run-task'
          AND method = 'POST'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get();
  const agentRunUsage = smokeDb
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS count
         FROM workspace_usage_events
        WHERE workspace_id = 'ws-default'
          AND kind = 'agent_run'`,
    )
    .get();
  smokeDb.prepare("UPDATE workspaces SET plan = 'free' WHERE id = 'ws-default'").run();
  smokeDb.close();
  assert(runtimeChecks.length >= 3, "/api/run-task should persist runtime check rows");
  assert(
    runtimeChecks.every((check) => check.status === "passed"),
    `/api/run-task runtime checks should pass: ${JSON.stringify(runtimeChecks)}`,
  );
  assert(
    runtimeChecks.some((check) => check.check_type === "generated_files"),
    "/api/run-task missing generated_files runtime check",
  );
  assert(
    runtimeChecks.some((check) => check.check_type === "secret_scan"),
    "/api/run-task missing secret_scan runtime check",
  );
  const manifestCheck = runtimeChecks.find((check) => check.check_type === "artifact_manifest");
  assert(manifestCheck?.artifact_path, "/api/run-task missing artifact manifest path");
  assert(
    existsSync(manifestCheck.artifact_path),
    `/api/run-task artifact manifest missing on disk: ${manifestCheck.artifact_path}`,
  );
  assert(runTaskAudit, "/api/run-task should persist an audit event");
  assert(
    runTaskAudit.outcome === "success" && runTaskAudit.status_code === 200,
    `/api/run-task audit event should be successful, got ${JSON.stringify(runTaskAudit)}`,
  );
  assert(
    agentRunUsage.count >= 1,
    `/api/run-task should record agent_run usage, got ${agentRunUsage.count}`,
  );

  const freePlanProject = await call("POST", "/api/projects", {
    name: "Second project",
    description: "Should be blocked by the free plan project limit",
  });
  assert(
    freePlanProject.status === 429,
    `/api/projects on saturated free plan expected 429, got ${freePlanProject.status}`,
  );
  assert(
    freePlanProject.json.error === "plan_limit_exceeded",
    `/api/projects on saturated free plan returned ${freePlanProject.json.error}`,
  );
  const restoreDb = new Database(process.env.INSFORGE_DB_PATH);
  restoreDb.prepare("UPDATE workspaces SET plan = 'pro' WHERE id = 'ws-default'").run();
  restoreDb.close();
  const stateAfterRun = await call("GET", "/api/state");
  const createdPr = stateAfterRun.json.prs.find((pr) => pr.id === runTask.json.pr.id);
  assert(createdPr, "/api/state did not include the PR created by /api/run-task");
  assert(
    createdPr.riskChecks?.build === "pass",
    `/api/prs should report runtime-backed build pass, got ${createdPr.riskChecks?.build}`,
  );
  assert(
    createdPr.riskChecks?.secretScan === "pass",
    `/api/prs should report runtime-backed secret scan pass, got ${createdPr.riskChecks?.secretScan}`,
  );
  if (backlogTask.assigned_agent_id) {
    const agentRuns = await call("GET", `/api/agent-runs?agentId=${backlogTask.assigned_agent_id}`);
    const createdRun = agentRuns.json.find((run) => run.task_id === backlogTask.id);
    assert(createdRun, "/api/agent-runs did not include the run created by /api/run-task");
    assert(
      createdRun.runtimeChecks?.length >= 3,
      "/api/agent-runs should expose runtime checks for the run",
    );
  }

  const guardrail = await call("POST", "/api/chat", { message: "DROP TABLE customers" });
  assert(guardrail.status === 200, `/api/chat guardrail expected 200, got ${guardrail.status}`);
  assert(guardrail.json.blocked === true, "/api/chat did not block DROP TABLE");
  assert(guardrail.json.rule?.kind === "drop_table", "/api/chat returned wrong guardrail rule");

  const deployChat = await call("POST", "/api/chat", { message: "Deploy this version" });
  assert(
    deployChat.status === 200,
    `/api/chat deploy intent expected 200, got ${deployChat.status}`,
  );
  assert(
    deployChat.json.intent === "deploy",
    `/api/chat deploy intent returned ${deployChat.json.intent}`,
  );
  assert(
    deployChat.json.tasks?.[0]?.assigned_agent_id,
    "/api/chat deploy intent should create a routed task",
  );

  const comment = await call("POST", "/api/comment", {
    text: "Make the hero call to action more direct.",
    selector: "hero-cta",
  });
  assert(comment.status === 200, `/api/comment expected 200, got ${comment.status}`);
  const clearComments = await call("DELETE", "/api/preview-comments");
  assert(
    clearComments.status === 200,
    `/api/preview-comments DELETE expected 200, got ${clearComments.status}`,
  );
  assert(
    clearComments.json.removed >= 1,
    `/api/preview-comments should remove at least one comment, got ${clearComments.json.removed}`,
  );

  const prodDeploy = await call("POST", "/api/deploy-production", {});
  assert(
    prodDeploy.status === 409,
    `/api/deploy-production without provider config expected 409, got ${prodDeploy.status}`,
  );
  assert(
    prodDeploy.json.error === "production_preflight_failed",
    "/api/deploy-production should fail preflight without provider config",
  );
  assert(
    prodDeploy.json.failed?.some((check) => check.key === "provider_config"),
    "/api/deploy-production preflight should include provider_config failure",
  );

  const failureInjection = await call("POST", "/api/deploy-production", { fail: true });
  assert(
    failureInjection.status === 403,
    `/api/deploy-production failure injection expected 403, got ${failureInjection.status}`,
  );
  assert(
    failureInjection.json.error === "failure_injection_disabled",
    "/api/deploy-production should disable failure injection in production deploy mode",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        db: process.env.INSFORGE_DB_PATH,
        project: state.json.project?.name,
        agents: state.json.agents.length,
        tasks: seededState.json.tasks.length,
        prs: prs.json.length,
        branches: branches.json.length,
        externalDevFallback: externalDevFallback.status,
        runtimeChecks: runtimeChecks.length,
        audit: runTaskAudit.outcome,
        agentRunUsage: agentRunUsage.count,
        freePlanProjectBlocked: freePlanProject.json.error,
        guardrail: guardrail.json.rule.kind,
        chatIntent: deployChat.json.intent,
        commentsCleared: clearComments.json.removed,
        productionDeployBlocked: prodDeploy.json.error,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
