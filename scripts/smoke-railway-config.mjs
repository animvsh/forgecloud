import { spawn } from "node:child_process";

const script = new URL("./configure-railway-production.mjs", import.meta.url).pathname;

function run(envPatch) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        RAILWAY_CONFIG_DRY_RUN: "true",
        RAILWAY_SERVICE_NAME: "forgecloud-smoke",
        ...envPatch,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function lastJson(output) {
  const lines = output.trim().split(/\n/);
  const objects = [];
  let depth = 0;
  let current = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed && current.length === 0) continue;
    if (trimmed.startsWith("{") && depth === 0) current = [];
    if (current.length > 0 || trimmed.startsWith("{")) {
      current.push(line);
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth === 0 && current.length > 0) {
        objects.push(JSON.parse(current.join("\n")));
        current = [];
      }
    }
  }
  if (objects.length === 0) throw new Error(`No JSON object found in output: ${output}`);
  return objects[objects.length - 1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseEnv = {
  AUTH_SESSION_SECRET: "smoke-production-session-secret-32-chars",
  AUTH_LOGIN_WEBHOOK_URL: "https://login.example.test/deliver",
  RAILWAY_DEPLOY_HOOK_URL: "https://railway.example.test/deploy",
};

const shortSecret = await run({
  ...baseEnv,
  AUTH_SESSION_SECRET: "short",
  FORGECLOUD_REQUIRE_LIVE_STACK: "false",
});
assert(shortSecret.code === 1, "Short auth session secret dry-run should fail");
const shortSecretPayload = lastJson(shortSecret.stderr);
assert(
  shortSecretPayload.invalid?.some((item) => item.name === "AUTH_SESSION_SECRET"),
  "Short auth session secret dry-run should report AUTH_SESSION_SECRET as invalid",
);

const defaultMissingStack = await run(baseEnv);
assert(defaultMissingStack.code === 1, "Production dry-run should require live stack by default");
const defaultMissingPayload = lastJson(defaultMissingStack.stderr);
assert(
  defaultMissingPayload.missing.includes("ROCKETRIDE_WORKFLOW_URL") &&
    defaultMissingPayload.missing.includes("one or more COMPOSIO_*_AUTH_CONFIG_ID"),
  "Default production dry-run should list stack requirements",
);

const missingStack = await run({ ...baseEnv, FORGECLOUD_REQUIRE_LIVE_STACK: "true" });
assert(missingStack.code === 1, "Missing live stack dry-run should fail");
const missingPayload = lastJson(missingStack.stderr);
assert(
  missingPayload.missing.includes("ROCKETRIDE_WORKFLOW_URL") &&
    missingPayload.missing.includes("one or more COMPOSIO_*_AUTH_CONFIG_ID"),
  "Missing live stack dry-run should list stack requirements",
);

const explicitLocalStack = await run({ ...baseEnv, FORGECLOUD_REQUIRE_LIVE_STACK: "false" });
assert(explicitLocalStack.code === 0, "Explicit local-stack dry-run should pass");
const explicitLocalPayload = lastJson(explicitLocalStack.stdout);
assert(explicitLocalPayload.dryRun === true, "Explicit local-stack smoke should be a dry run");

const completeStack = await run({
  ...baseEnv,
  FORGECLOUD_REQUIRE_LIVE_STACK: "true",
  ROCKETRIDE_WORKFLOW_URL: "https://rocketride.example.test/workflows",
  ROCKETRIDE_API_KEY: "rr-key",
  BUTTERBASE_PROJECT_URL: "https://butterbase.example.test/project",
  BUTTERBASE_API_KEY: "bb-key",
  XTRACE_MEMORY_URL: "https://xtrace.example.test/memory",
  XTRACE_API_KEY: "xt-key",
  COMPOSIO_API_KEY: "comp-key",
  COMPOSIO_SLACK_AUTH_CONFIG_ID: "slack-config",
});
assert(completeStack.code === 0, "Complete live stack dry-run should pass");
const successPayload = lastJson(completeStack.stdout);
assert(successPayload.dryRun === true, "Successful smoke should be a dry run");
assert(
  successPayload.next?.includes("npm run check:live-production"),
  "Successful smoke should print live production check next step",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      shortSecretInvalid: shortSecretPayload.invalid.length,
      defaultMissingStack: defaultMissingPayload.missing.length,
      explicitMissingStack: missingPayload.missing.length,
      explicitLocalStack: explicitLocalPayload.dryRun,
      dryRun: successPayload.dryRun,
    },
    null,
    2,
  ),
);
