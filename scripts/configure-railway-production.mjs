import { spawn } from "node:child_process";

const service = process.env.RAILWAY_SERVICE_NAME ?? "forgecloud-palembang";
const dryRun = process.env.RAILWAY_CONFIG_DRY_RUN === "true";
const required = ["AUTH_SESSION_SECRET", "AUTH_LOGIN_WEBHOOK_URL", "RAILWAY_DEPLOY_HOOK_URL"];
const liveStackVars = [
  "ROCKETRIDE_WORKFLOW_URL",
  "ROCKETRIDE_API_KEY",
  "BUTTERBASE_PROJECT_URL",
  "BUTTERBASE_API_KEY",
  "XTRACE_MEMORY_URL",
  "XTRACE_API_KEY",
  "COMPOSIO_API_KEY",
];
const composioAuthConfigVars = [
  "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
  "COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID",
  "COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
  "COMPOSIO_SLACK_AUTH_CONFIG_ID",
  "COMPOSIO_STRIPE_AUTH_CONFIG_ID",
  "COMPOSIO_NOTION_AUTH_CONFIG_ID",
  "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID",
  "COMPOSIO_SHOPIFY_AUTH_CONFIG_ID",
];

function valueFor(name) {
  return process.env[name]?.trim();
}

function redact(name, value) {
  if (!value) return "<missing>";
  if (name.endsWith("_URL")) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname ? "/..." : ""}`;
    } catch {
      return "<set>";
    }
  }
  return "<set>";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

const requireLiveStack = valueFor("FORGECLOUD_REQUIRE_LIVE_STACK") !== "false";
const requiredForThisRun = [
  ...required,
  ...(requireLiveStack
    ? [
        ...liveStackVars,
        ...(composioAuthConfigVars.some((name) => valueFor(name))
          ? []
          : ["one or more COMPOSIO_*_AUTH_CONFIG_ID"]),
      ]
    : []),
];
const missing = requiredForThisRun.filter((name) =>
  name === "one or more COMPOSIO_*_AUTH_CONFIG_ID" ? true : !valueFor(name),
);
if (missing.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Missing required production provider configuration.",
        missing,
        required: {
          AUTH_SESSION_SECRET:
            "Long random session signing secret. Use at least 32 characters for production.",
          AUTH_LOGIN_WEBHOOK_URL:
            "Webhook that delivers passwordless login codes by email/SMS; must not return the code to the browser.",
          RAILWAY_DEPLOY_HOOK_URL:
            "Railway deploy hook URL for the service ForgeCloud should redeploy from /api/deploy-production.",
          FORGECLOUD_REQUIRE_LIVE_STACK:
            "Defaults to true for production. Set false only for an intentional staging/demo deploy without live Butterbase, XTrace, Composio, and Rocket Ride.",
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const invalid = [];
if ((valueFor("AUTH_SESSION_SECRET")?.length ?? 0) < 32) {
  invalid.push({
    name: "AUTH_SESSION_SECRET",
    issue: "Must be at least 32 characters for production session signing.",
  });
}

if (invalid.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Invalid production provider configuration.",
        invalid,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const variables = {
  AUTH_SESSION_SECRET: valueFor("AUTH_SESSION_SECRET"),
  AUTH_LOGIN_WEBHOOK_URL: valueFor("AUTH_LOGIN_WEBHOOK_URL"),
  AUTH_LOGIN_RETURN_CODE: "false",
  FORGECLOUD_DEPLOY_MODE: "production",
  FORGECLOUD_DEPLOY_PROVIDER: "railway",
  FORGECLOUD_REQUIRE_LIVE_STACK: requireLiveStack ? "true" : "false",
  RAILWAY_DEPLOY_HOOK_URL: valueFor("RAILWAY_DEPLOY_HOOK_URL"),
  RAILWAY_SERVICE_URL:
    valueFor("RAILWAY_SERVICE_URL") ?? "https://forgecloud-palembang-production.up.railway.app",
  PUBLIC_APP_URL: valueFor("PUBLIC_APP_URL") ?? "https://forgecloud-palembang.pages.dev",
  ...Object.fromEntries(
    [...liveStackVars, ...composioAuthConfigVars, "COMPOSIO_BASE_URL", "COMPOSIO_USER_PREFIX"]
      .filter((name) => valueFor(name))
      .map((name) => [name, valueFor(name)]),
  ),
};

console.log(
  JSON.stringify(
    {
      ok: true,
      service,
      setting: Object.fromEntries(
        Object.entries(variables).map(([name, value]) => [name, redact(name, value)]),
      ),
    },
    null,
    2,
  ),
);

for (const [name, value] of Object.entries(variables)) {
  if (dryRun) continue;
  await run("npx", [
    "--yes",
    "@railway/cli",
    "variables",
    "set",
    `${name}=${value}`,
    "--service",
    service,
  ]);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      next: [`npx --yes @railway/cli up --service ${service}`, "npm run check:live-production"],
    },
    null,
    2,
  ),
);
