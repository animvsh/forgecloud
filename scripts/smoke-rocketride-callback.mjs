import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-rocketride-callback-"));
process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = "fallback";
process.env.FORGECLOUD_DEPLOY_MODE = "simulation";
process.env.ROCKETRIDE_CALLBACK_SECRET = "rocketride-callback-smoke-secret";

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
  let json = null;
  if (responseBody) {
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new Error(`${method} ${url} returned non-JSON: ${responseBody.slice(0, 200)}`);
    }
  }
  return { status: status || res.statusCode, json, headers: responseHeaders };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const callbackAuth = {
  authorization: `Bearer ${process.env.ROCKETRIDE_CALLBACK_SECRET}`,
};

try {
  const seeded = await call("POST", "/api/seed-demo", {});
  assert(seeded.status === 200, `/api/seed-demo expected 200, got ${seeded.status}`);

  const initialState = await call("GET", "/api/state");
  assert(initialState.status === 200, `/api/state expected 200, got ${initialState.status}`);
  const backlogTask = initialState.json.tasks.find((task) => task.status === "backlog");
  assert(backlogTask, "Expected a seeded backlog task");

  const runTask = await call("POST", "/api/run-task", { taskId: backlogTask.id });
  assert(runTask.status === 200, `/api/run-task expected 200, got ${runTask.status}`);

  const db = new Database(process.env.INSFORGE_DB_PATH);
  const completedRun = db
    .prepare(
      `SELECT *
         FROM rocketride_workflow_runs
        WHERE workflow_type = 'run_task'
          AND task_id = ?
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .get(backlogTask.id);
  assert(completedRun, "Expected /api/run-task to create a Rocket Ride workflow row");

  const unauthorized = await call("POST", "/api/rocketride/callback", {
    workflowRunId: completedRun.id,
    status: "completed",
  });
  assert(
    unauthorized.status === 401,
    `/api/rocketride/callback without secret expected 401, got ${unauthorized.status}`,
  );

  const invalid = await call(
    "POST",
    "/api/rocketride/callback",
    { workflowRunId: completedRun.id },
    callbackAuth,
  );
  assert(
    invalid.status === 400,
    `/api/rocketride/callback invalid payload expected 400, got ${invalid.status}`,
  );

  const success = await call(
    "POST",
    "/api/rocketride/callback",
    {
      workflowRunId: completedRun.id,
      externalRunId: "rr-ext-success-1",
      projectId: "proj-pleasure-pizza",
      workflowType: "run_task",
      status: "completed",
      taskId: backlogTask.id,
      prId: runTask.json.pr.id,
      step: {
        id: "publish-summary",
        name: "Publish PR summary",
        status: "completed",
        output: { summary: "Remote Rocket Ride completed the task handoff." },
      },
      output: { remoteUrl: "https://rocketride.example.test/runs/rr-ext-success-1" },
    },
    callbackAuth,
  );
  assert(success.status === 200, `/api/rocketride/callback expected 200, got ${success.status}`);
  assert(
    success.json.workflowRun.external_run_id === "rr-ext-success-1",
    "Callback response should include the external run id",
  );

  const pendingId = "rr-smoke-failed";
  const otherTask = initialState.json.tasks.find(
    (task) => task.status === "backlog" && task.id !== backlogTask.id,
  );
  assert(otherTask, "Expected a second seeded backlog task");
  db.prepare(
    `INSERT INTO rocketride_workflow_runs
       (id, project_id, workflow_type, status, mode, task_id, input_json, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pendingId,
    "proj-pleasure-pizza",
    "run_task",
    "running",
    "webhook",
    otherTask.id,
    JSON.stringify({
      title: "Remote failure smoke",
      description: "Synthetic pending workflow for callback failure coverage.",
    }),
    Date.now(),
  );

  const failure = await call(
    "POST",
    "/api/rocketride/callback",
    {
      workflowRunId: pendingId,
      externalRunId: "rr-ext-failed-1",
      status: "failed",
      taskId: otherTask.id,
      error: "Remote build command exited 1",
      step: {
        name: "Run build",
        status: "failed",
        error: "npm run build failed",
      },
    },
    callbackAuth,
  );
  assert(
    failure.status === 200,
    `/api/rocketride/callback failed-status update expected 200, got ${failure.status}`,
  );

  const stateAfterCallbacks = await call("GET", "/api/state");
  assert(
    stateAfterCallbacks.status === 200,
    `/api/state after callbacks expected 200, got ${stateAfterCallbacks.status}`,
  );
  const reflectedSuccess = stateAfterCallbacks.json.rocketRideRuns.find(
    (run) => run.id === completedRun.id,
  );
  const reflectedFailure = stateAfterCallbacks.json.rocketRideRuns.find(
    (run) => run.id === pendingId,
  );
  assert(reflectedSuccess, "/api/state should include the successful callback workflow");
  assert(
    reflectedSuccess.external_run_id === "rr-ext-success-1",
    "/api/state should reflect successful callback external run id",
  );
  assert(reflectedFailure, "/api/state should include the failed callback workflow");
  assert(
    reflectedFailure.status === "failed" &&
      reflectedFailure.error === "Remote build command exited 1",
    `/api/state should reflect failed callback error, got ${JSON.stringify(reflectedFailure)}`,
  );
  assert(
    stateAfterCallbacks.json.activityEvents.some(
      (event) => event.tool === "RocketRide" && event.event_type === "rocketride_completed",
    ),
    "/api/state should include Rocket Ride callback activity evidence",
  );
  assert(
    stateAfterCallbacks.json.memoryEntries.some(
      (memory) => memory.source === "RocketRide" && memory.title.includes("callback"),
    ),
    "/api/state should include Rocket Ride callback memory evidence",
  );
  assert(
    stateAfterCallbacks.json.agents.some((agent) =>
      agent.last_action?.includes("RocketRide run task"),
    ),
    "/api/state agents should reflect Rocket Ride callback activity",
  );

  const output = JSON.parse(
    db.prepare("SELECT output_json FROM rocketride_workflow_runs WHERE id = ?").get(completedRun.id)
      .output_json,
  );
  assert(output.steps?.length >= 1, "Callback should persist step output in output_json.steps");
  assert(
    output.output?.remoteUrl === "https://rocketride.example.test/runs/rr-ext-success-1",
    "Callback should persist top-level output JSON",
  );

  db.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        successfulWorkflow: completedRun.id,
        failedWorkflow: pendingId,
        activityEvents: stateAfterCallbacks.json.activityEvents.length,
        memoryEntries: stateAfterCallbacks.json.memoryEntries.length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
