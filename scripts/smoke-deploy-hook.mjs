import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-deploy-smoke-"));
const hookCalls = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  hookCalls.push({ method: req.method, body: body ? JSON.parse(body) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: "https://team.example.com" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Hook server did not bind");

process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = "fallback";
process.env.AUTH_SESSION_SECRET = "smoke-production-session-secret-32-chars";
process.env.AUTH_LOGIN_WEBHOOK_URL = `http://127.0.0.1:${address.port}/login`;
process.env.FORGECLOUD_DEPLOY_MODE = "production";
process.env.FORGECLOUD_DEPLOY_PROVIDER = "railway";
process.env.RAILWAY_DEPLOY_HOOK_URL = `http://127.0.0.1:${address.port}/deploy`;
process.env.RAILWAY_SERVICE_URL = "https://team.example.com";

const { handleApiRequest } = await import("../dist/server/api-handler.mjs");

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
  const res = {
    setHeader() {},
    getHeader() {},
    hasHeader() {
      return false;
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
  return { status, json: JSON.parse(responseBody) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const seeded = await call("POST", "/api/seed-demo", {});
  assert(seeded.status === 200, `/api/seed-demo expected 200, got ${seeded.status}`);

  const project = await call("POST", "/api/projects", {
    name: "Deploy Smoke Team",
    description: "Clean project used by deploy smoke tests.",
  });
  assert(project.status === 200, `/api/projects expected 200, got ${project.status}`);

  const task = await call("POST", "/api/add-task", {
    title: "Ship deploy smoke banner",
    description: "Small frontend-only change for deploy smoke validation.",
    ownerAgent: "Frontend Agent",
    riskLevel: "low",
  });
  assert(task.status === 200, `/api/add-task expected 200, got ${task.status}`);

  const run = await call("POST", "/api/run-all", {});
  assert(run.status === 200, `/api/run-all expected 200, got ${run.status}`);

  let state = await call("GET", "/api/state");
  const pr = state.json.prs?.[0];
  assert(pr?.id, "Run-all should create a PR for the clean deploy smoke project");
  if (pr.status !== "approved" && pr.status !== "merged") {
    const approval = await call("POST", "/api/approve-pr", {
      prId: pr.id,
      approverName: "Deploy Smoke",
    });
    assert(approval.status === 200, `/api/approve-pr expected 200, got ${approval.status}`);
  }

  state = await call("GET", "/api/state");
  assert(
    state.json.deploymentReadiness?.config?.productionReady === true,
    "Deployment config should be production-ready with a hook URL",
  );
  assert(
    state.json.deploymentReadiness?.canDeployProduction === true,
    "Clean project should pass production preflight when provider config exists",
  );

  const deployed = await call("POST", "/api/deploy-production", {});
  assert(
    deployed.status === 200,
    `/api/deploy-production with hook expected 200, got ${deployed.status}`,
  );
  assert(deployed.json.simulated === false, "Deploy should not be marked simulated");
  assert(deployed.json.url === "https://team.example.com", "Deploy should use hook URL response");
  assert(hookCalls.length === 1, "Deploy hook should be called exactly once");
  assert(
    hookCalls[0].body.environment === "production",
    "Deploy hook payload should target production",
  );

  const after = await call("GET", "/api/state");
  const latest = after.json.deployments?.[0];
  assert(latest?.status === "live", "Latest deployment should be live");
  assert(
    latest?.railway_url === "https://team.example.com",
    "Deployment should persist Railway URL",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        hookCalls: hookCalls.length,
        deploymentId: deployed.json.deploymentId,
        url: deployed.json.url,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
