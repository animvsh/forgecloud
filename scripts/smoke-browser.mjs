import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-browser-smoke-"));
const port = 4300 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const appRoutes = [
  ["/app", "Pleasure Pizza Ops"],
  ["/app/connect", "Connect your tools"],
  ["/app/discoveries", "What I found"],
  ["/app/suggested-apps", "Apps I can build for you"],
  ["/app/preview", "Live preview"],
  ["/app/changes", "Changes"],
  ["/app/branches", "Branches & commits"],
  ["/app/failures", "Failure recovery"],
  ["/app/tasks", "Tasks"],
  ["/app/agents", "Agent team"],
  ["/app/team", "Team"],
  ["/app/deployments", "Deployments"],
  ["/app/activity", "Activity"],
  ["/app/report", "Final report"],
  ["/app/settings", "Settings"],
];
const serverEnv = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(port),
  INSFORGE_DB_PATH: join(tempDir, "browser.sqlite"),
  AI_PROVIDER: "fallback",
  FORGECLOUD_DEPLOY_MODE: "simulation",
};

let server;
let browser;
const serverLogs = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = `${res.status} ${await res.text().catch(() => "")}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Server did not become healthy: ${lastError}\n${serverLogs.join("").slice(-2_000)}`,
  );
}

async function api(path, body = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text}`);
  return json;
}

async function newCheckedPage(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return { page, errors };
}

async function launchBrowser() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const candidate = await chromium.launch({ headless: true });
    try {
      const probe = await candidate.newPage();
      await probe.close();
      return candidate;
    } catch (err) {
      lastError = err;
      await candidate.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

async function expectHeading(page, name) {
  await page.locator("h1").filter({ hasText: name }).first().waitFor({ timeout: 10_000 });
}

async function smokeRoute(page, path, heading) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await expectHeading(page, heading);
}

try {
  server = spawn(process.execPath, ["server-entry.mjs"], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.on("exit", (code) => {
    if (code && code !== 0) serverLogs.push(`[server exited ${code}]`);
  });

  await waitForHealth();
  await api("/api/seed-demo");

  browser = await launchBrowser();

  const desktop = await newCheckedPage({ width: 1440, height: 1000 });
  for (const [path, heading] of appRoutes) {
    await smokeRoute(desktop.page, path, heading);
  }
  await smokeRoute(desktop.page, "/app/connect", "Connect your tools");
  await desktop.page.getByText("Composio integration layer").waitFor({ timeout: 10_000 });
  await desktop.page
    .getByText(/COMPOSIO/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await smokeRoute(desktop.page, "/app/suggested-apps", "Apps I can build for you");
  await desktop.page
    .getByText(/Uses through Composio/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await desktop.page
    .getByText(/Why ForgeCloud suggested this/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await smokeRoute(desktop.page, "/app/agents", "Agent team");
  await desktop.page
    .getByText(/Rocket Ride/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await smokeRoute(desktop.page, "/app/activity", "Activity");
  await desktop.page
    .getByText(/XTrace/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await desktop.page
    .getByText(/Memory log/i)
    .first()
    .waitFor({ timeout: 10_000 });
  await smokeRoute(desktop.page, "/app/preview", "Live preview");
  await desktop.page.evaluate(async () => {
    const res = await fetch("/api/blame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selector: "#vip-card", label: "VIP customer card" }),
    });
    const json = await res.json();
    window.__forgecloudBlameSmoke = { status: res.status, json };
  });
  const blameSmoke = await desktop.page.evaluate(() => window.__forgecloudBlameSmoke);
  assert(blameSmoke?.status === 200, `Preview blame expected 200, got ${blameSmoke?.status}`);
  assert(blameSmoke?.json?.xtraceMode === "local", "Preview blame should use XTrace local memory");
  assert(
    Array.isArray(blameSmoke?.json?.provenance) && blameSmoke.json.provenance.length >= 2,
    "Preview blame should return provenance entries",
  );
  await smokeRoute(desktop.page, "/app/chat", "Build Room");
  await desktop.page.getByText("Agent pulse").waitFor({ timeout: 10_000 });
  await desktop.page.getByText("Trust gates").waitFor({ timeout: 10_000 });
  await desktop.page
    .getByPlaceholder("Describe the next outcome...")
    .fill("Add a compact owner handoff checklist for launch readiness");
  await desktop.page.getByRole("button", { name: "Send message" }).click();
  await desktop.page.locator("text=/handoff checklist/i").nth(1).waitFor({ timeout: 12_000 });
  assert(desktop.errors.length === 0, `Desktop console errors: ${desktop.errors.join("\n")}`);

  const mobile = await newCheckedPage({ width: 390, height: 900 });
  await smokeRoute(mobile.page, "/app", "Pleasure Pizza Ops");
  await smokeRoute(mobile.page, "/app/chat", "Build Room");
  await mobile.page.getByText("Tasks done").waitFor({ timeout: 10_000 });
  await mobile.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await mobile.page.getByPlaceholder("Describe the next outcome...").waitFor({ timeout: 10_000 });
  await smokeRoute(mobile.page, "/app/tasks", "Tasks");
  await smokeRoute(mobile.page, "/app/team", "Team");
  assert(mobile.errors.length === 0, `Mobile console errors: ${mobile.errors.join("\n")}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        url: baseUrl,
        desktop: `${appRoutes.length + 1} app routes rendered and chat send worked`,
        mobile: "Home, Build Room, Tasks, Team, and composer rendered",
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const done = () => resolve();
      server.once("exit", done);
      setTimeout(done, 1500).unref?.();
    });
  }
  await rm(tempDir, { recursive: true, force: true });
}
