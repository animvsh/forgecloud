import { spawn } from "node:child_process";

const service = process.env.RAILWAY_SERVICE_NAME ?? "forgecloud-palembang";
const required = ["AUTH_LOGIN_WEBHOOK_URL", "RAILWAY_DEPLOY_HOOK_URL"];

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

const missing = required.filter((name) => !valueFor(name));
if (missing.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Missing required production provider configuration.",
        missing,
        required: {
          AUTH_LOGIN_WEBHOOK_URL:
            "Webhook that delivers passwordless login codes by email/SMS; must not return the code to the browser.",
          RAILWAY_DEPLOY_HOOK_URL:
            "Railway deploy hook URL for the service ForgeCloud should redeploy from /api/deploy-production.",
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const variables = {
  AUTH_LOGIN_WEBHOOK_URL: valueFor("AUTH_LOGIN_WEBHOOK_URL"),
  AUTH_LOGIN_RETURN_CODE: "false",
  FORGECLOUD_DEPLOY_MODE: "production",
  FORGECLOUD_DEPLOY_PROVIDER: "railway",
  RAILWAY_DEPLOY_HOOK_URL: valueFor("RAILWAY_DEPLOY_HOOK_URL"),
  RAILWAY_SERVICE_URL:
    valueFor("RAILWAY_SERVICE_URL") ?? "https://forgecloud-palembang-production.up.railway.app",
  PUBLIC_APP_URL: valueFor("PUBLIC_APP_URL") ?? "https://forgecloud-palembang.pages.dev",
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
      next: [`npx --yes @railway/cli up --service ${service}`, "npm run check:live-production"],
    },
    null,
    2,
  ),
);
