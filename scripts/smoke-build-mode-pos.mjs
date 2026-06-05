import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-pos-smoke-"));
const port = 5400 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const serverLogs = [];

let server;
let browser;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `${response.status} ${await response.text().catch(() => "")}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Server did not become healthy: ${lastError}\n${serverLogs.join("").slice(-2_000)}`,
  );
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} expected 2xx, got ${response.status}: ${text}`);
  }
  return json;
}

function metadataFor(message) {
  if (!message?.metadata) return {};
  if (typeof message.metadata === "string") {
    try {
      return JSON.parse(message.metadata);
    } catch {
      return {};
    }
  }
  return message.metadata;
}

async function buildPosThroughApi() {
  await request("POST", "/api/seed-demo", {});
  await request("POST", "/api/projects", {
    name: "Pizza POS Smoke",
    description: "Production Build Mode smoke project",
  });

  const chat = await request("POST", "/api/chat", {
    message: "Build a POS system for my pizza shop",
  });
  const chatText = JSON.stringify(chat).toLowerCase();
  assert(
    chatText.includes("pos") || chatText.includes("checkout"),
    "Build Mode prompt did not produce a POS/checkout plan",
  );

  const plannedState = await request("GET", "/api/state");
  const planMessage = [...plannedState.chatMessages].reverse().find((message) => {
    const metadata = metadataFor(message);
    return message.role === "assistant" && metadata.kind === "plan" && metadata.taskIds;
  });
  const planMetadata = metadataFor(planMessage);
  const taskIds = Array.isArray(planMetadata.taskIds) ? planMetadata.taskIds : [];
  assert(taskIds.length >= 5, `Expected at least 5 generated POS tasks, got ${taskIds.length}`);

  const approval = await request("POST", "/api/approve-plan", { taskIds });
  assert(approval.previewUrl, "Approve-plan did not return a preview URL");
  assert(
    Array.isArray(approval.mergedPrIds) && approval.mergedPrIds.length >= 5,
    "Approve-plan did not auto-merge the safe POS PRs",
  );

  const builtState = await request("GET", "/api/state");
  const mergedCount = builtState.prs.filter((pr) => pr.status === "merged").length;
  assert(mergedCount >= 5, `Expected at least 5 merged PRs, got ${mergedCount}`);
  assert(
    builtState.deployments.some((deployment) => deployment.status === "live"),
    "Build Mode did not create a live preview deployment",
  );
  assert(
    builtState.chatMessages.some((message) =>
      JSON.stringify(metadataFor(message)).includes("build_complete"),
    ),
    "Build Mode did not add a build_complete chat message",
  );

  return {
    planName: chat.plan?.suggestedProjectName ?? planMetadata.plan?.suggestedProjectName ?? null,
    taskIds: taskIds.length,
    mergedPrs: mergedCount,
    previewUrl: approval.previewUrl,
  };
}

async function verifyBuildStudioInBrowser() {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${baseUrl}/app/chat`, { waitUntil: "networkidle" });
  const studio = page.getByTestId("build-studio-panel");
  await studio.getByText("AI software studio").waitFor({ timeout: 10_000 });
  await studio.getByText("Platform link ready").waitFor({ timeout: 10_000 });
  await page.getByText("Safe PRs merged").waitFor({ timeout: 10_000 });
  await studio.getByRole("button", { name: /Toggle Design Agent build details/i }).click();
  await studio.getByText("Working on", { exact: true }).waitFor({ timeout: 5_000 });
  await studio.getByText("Commit", { exact: true }).waitFor({ timeout: 5_000 });
  await studio.getByText("Review", { exact: true }).waitFor({ timeout: 5_000 });

  const text = await studio.innerText();
  assert(/9\s+AGENTS/i.test(text), "Build Studio did not show the 9-agent studio roster");
  assert(!/18\s+AGENTS/i.test(text), "Build Studio showed duplicate agents");
  assert(text.includes("feature/pos-landing"), "Build Studio did not show the merged POS branch");
  assert(text.includes("merged / low risk"), "Build Studio did not show merged low-risk review");
  assert(consoleErrors.length === 0, `Browser console errors: ${consoleErrors.join("\n")}`);

  return {
    hasStudio: text.includes("AI software studio"),
    hasLink: text.includes("Platform link ready"),
    hasDropdown: /working on/i.test(text) && /commit/i.test(text) && /review/i.test(text),
  };
}

try {
  server = spawn(process.execPath, ["server-entry.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      INSFORGE_DB_PATH: join(tempDir, "pos-smoke.sqlite"),
      AI_PROVIDER: "fallback",
      AUTH_REQUIRE_SESSION: "false",
      FORGECLOUD_DEPLOY_MODE: "simulation",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)));

  await waitForHealth();
  const api = await buildPosThroughApi();
  const browserResult = await verifyBuildStudioInBrowser();

  console.log(JSON.stringify({ ok: true, url: baseUrl, ...api, ...browserResult }, null, 2));
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
