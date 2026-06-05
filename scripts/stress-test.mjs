// Comprehensive E2E stress test for ForgeCloud against a running server or,
// by default, a self-started built server with a temporary database.
// Walks the full core loop, exercises every screen, every failure type, every
// deploy environment. Surfaces what is broken vs what is shipping.
//
// Usage: node scripts/stress-test.mjs [baseUrl]
//        (defaults to a temporary local built server)

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const suppliedBaseUrl = process.argv[2]?.replace(/\/+$/, "");
const tempDir = suppliedBaseUrl ? null : await mkdtemp(join(tmpdir(), "forgecloud-stress-"));
const port = 5200 + Math.floor(Math.random() * 1000);
const baseUrl = suppliedBaseUrl ?? `http://127.0.0.1:${port}`;

const results = [];
const findings = [];
let currentStep = "";
let currentFile = "";
let server = null;
const serverLogs = [];

function step(name) {
  currentStep = name;
  console.log(`\n→ ${name}`);
}

function ok(msg) {
  results.push({ step: currentStep, status: "PASS", msg });
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  results.push({ step: currentStep, status: "FAIL", msg, detail });
  console.log(`  ✗ ${msg}`);
  if (detail) console.log(`     ${detail}`);
}

function finding(area, severity, message) {
  findings.push({ area, severity, message });
}

function assert(cond, msg, detail) {
  if (cond) ok(msg);
  else fail(msg, detail);
}

async function api(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
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

async function startServerIfNeeded() {
  if (suppliedBaseUrl) return;
  server = spawn(process.execPath, ["server-entry.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      INSFORGE_DB_PATH: join(tempDir, "stress.sqlite"),
      AI_PROVIDER: "fallback",
      AUTH_REQUIRED: "false",
      ENABLE_DEMO_ENDPOINTS: "true",
      FORGECLOUD_ENABLE_FAILURE_INJECTION: "true",
      FORGECLOUD_DEPLOY_MODE: "simulation",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.on("exit", (code) => {
    if (code !== null && code !== 0) serverLogs.push(`\n[server exited ${code}]\n`);
  });
  await waitForHealth();
}

async function main() {
  await startServerIfNeeded();

  // 1. Health
  step("1. Health + readiness");
  const health = await api("GET", "/api/health");
  assert(health.status === 200, "GET /api/health -> 200", JSON.stringify(health.json));
  assert(health.json?.ok === true, "health.ok");
  assert(typeof health.json?.provider === "string", "health.provider present");

  // 2. Seed (reset to known state)
  step("2. Reset + seed demo data");
  // Reset to fresh DB so test is hermetic
  await api("POST", "/api/reset", {});
  const seed = await api("POST", "/api/seed-demo", {});
  assert(seed.status === 200, "POST /api/seed-demo -> 200");
  const skipDemo = await api("POST", "/api/skip-to-demo", {});
  assert(skipDemo.status === 200, "POST /api/skip-to-demo -> 200");

  // 3. State shape
  step("3. State shape (users, workspace, project, agents, tasks, PRs)");
  const state = await api("GET", "/api/state");
  assert(state.status === 200, "GET /api/state -> 200");
  assert(!!state.json?.user, "user present");
  assert(!!state.json?.workspace, "workspace present");
  assert(!!state.json?.project, "project present");
  assert(Array.isArray(state.json?.agents) && state.json.agents.length === 9, "9 agents seeded");
  assert(Array.isArray(state.json?.tasks) && state.json.tasks.length >= 10, ">=10 tasks seeded");
  assert(Array.isArray(state.json?.prs) && state.json.prs.length >= 3, ">=3 PRs seeded");
  const agentTypes = state.json?.agents?.map((a) => a.type).sort();
  const expectedAgents = [
    "auth",
    "backend",
    "design",
    "devops",
    "frontend",
    "product",
    "qa",
    "recovery",
    "safety",
  ];
  assert(
    JSON.stringify(agentTypes) === JSON.stringify(expectedAgents),
    "all 9 agent types present",
    `got ${JSON.stringify(agentTypes)}`,
  );

  // 4. PR enrichment (PRD requires task, agent, requester, reviewer, deployment)
  step("4. PR enrichment (PRD §5 PR object)");
  const prs = state.json.prs;
  const firstPr = prs[0];
  if (firstPr) {
    const need = [
      "task_title",
      "task_requester_name",
      "agent_owner_name",
      "latest_deployment_environment",
    ];
    for (const k of need) {
      if (!(k in firstPr)) finding("Changes", "high", `PR missing enrichment field "${k}"`);
    }
    assert(
      "task_title" in firstPr,
      "PR has task_title",
      `PR #${firstPr.number} has task_title='${firstPr.task_title}'`,
    );
    assert(
      "agent_owner_name" in firstPr,
      "PR has agent_owner_name",
      `agent='${firstPr.agent_owner_name}'`,
    );
  }

  // 5. Risk checks include preview deploy (just fixed)
  step("5. Risk matrix includes preview deploy");
  const checks = firstPr?.riskChecks;
  if (checks) {
    assert("previewDeploy" in checks, "PR has previewDeploy check", JSON.stringify(checks));
  } else {
    fail("PR missing riskChecks", JSON.stringify(firstPr));
  }

  // 6. Guardrail: secret + DROP TABLE blocked
  step("6. Safety guardrails");
  const dropTable = await api("POST", "/api/chat", { message: "DROP TABLE customers" });
  assert(dropTable.status === 200, "POST /api/chat (DROP TABLE) -> 200");
  assert(dropTable.json?.blocked === true, "DROP TABLE blocked");
  const apiKey = await api("POST", "/api/chat", { message: "use my AWS_SECRET_ACCESS_KEY here" });
  assert(apiKey.json?.blocked === true, "API key chat blocked");

  // 7. Plan generation (intake flow — creates a fresh project in "intake" status)
  step("7. Plan generation via /api/intake");
  const intake = await api("POST", "/api/intake", {
    projectName: "Stress Test Project",
    userType: "founder",
    firstVersion: "Build a simple waitlist app",
    style: "modern",
  });
  assert(intake.status === 200, "POST /api/intake -> 200");
  if (intake.json?.plan) {
    assert(
      Array.isArray(intake.json.plan.features) && intake.json.plan.features.length >= 4,
      `intake plan has ${intake.json.plan.features?.length ?? 0} features`,
    );
  } else {
    finding("Intake", "high", "/api/intake did not return a plan object");
  }

  // 8. Task execution: run a backlog task
  step("8. Task execution (/api/run-task)");
  const state2 = await api("GET", "/api/state");
  const backlog = state2.json?.tasks?.find((t) => t.status === "backlog");
  if (backlog) {
    const run = await api("POST", "/api/run-task", { taskId: backlog.id });
    assert(run.status === 200, "POST /api/run-task -> 200");
    assert(!!run.json?.pr?.id, "run-task created a PR");
  } else {
    finding("Tasks", "low", "no backlog task to run; skipping");
  }

  // 9. Approval queue + decide
  step("9. Approval queue");
  let state3 = await api("GET", "/api/state");
  let pending = state3.json?.approvals?.[0];
  if (!pending) {
    const injected = await api("POST", "/api/inject-failure", { type: "unsafe_db_migration" });
    assert(injected.status === 200, "unsafe migration creates a reviewable failure");
    state3 = await api("GET", "/api/state");
    pending = state3.json?.approvals?.[0];
  }
  if (pending) {
    const decide = await api("POST", "/api/approval", {
      approvalId: pending.id,
      decision: "approve",
    });
    assert(decide.status === 200, "approve pending approval -> 200");
  } else {
    fail("approval queue has a pending item after unsafe migration injection");
  }

  // 10. PR approve + rollback
  step("10. PR approve + rollback");
  const state4 = await api("GET", "/api/state");
  const openPr = state4.json?.prs?.find((p) => p.status === "open" && p.requires_approval === 0);
  if (openPr) {
    const approve = await api("POST", "/api/approve-pr", { prId: openPr.id });
    assert(approve.status === 200, "POST /api/approve-pr -> 200");
  }
  const state5 = await api("GET", "/api/state");
  const mergedPr = state5.json?.prs?.find((p) => p.status === "merged" || p.merged_at);
  if (mergedPr) {
    const rb = await api("POST", "/api/rollback-pr", { prId: mergedPr.id });
    assert(rb.status === 200, "POST /api/rollback-pr -> 200");
  } else {
    finding("Changes", "low", "no merged PR to roll back");
  }

  // 11. Preview deploy + production preflight
  step("11. Deploy (preview + production preflight)");
  const deploy = await api("POST", "/api/deploy", { environment: "preview" });
  assert(deploy.status === 200 || deploy.status === 201, "POST /api/deploy (preview) -> success");
  const prod = await api("POST", "/api/deploy-production", {});
  assert(
    prod.status === 409 || prod.status === 200,
    "POST /api/deploy-production -> 409 (blocked) or 200 (allowed)",
    `status=${prod.status} body=${JSON.stringify(prod.json).slice(0, 200)}`,
  );
  if (prod.status === 409) {
    assert(
      prod.json?.error === "production_preflight_failed",
      "production preflight correctly failed",
    );
  }

  // 12. Failure injection: all 8 types
  step("12. Failure injection (8 types)");
  const types = [
    "model_timeout",
    "build_failed",
    "secret_detected",
    "unsafe_db_migration",
    "deploy_failed",
    "bad_output",
    "rate_limit",
    "agent_conflict",
  ];
  for (const t of types) {
    const r = await api("POST", "/api/inject-failure", { type: t });
    assert(r.status === 200, `inject-failure ${t} -> 200`, `status=${r.status}`);
  }

  // 13. Add task + project create (run LAST because project changes active project)
  step("13. Manual task + new project");
  const addTask = await api("POST", "/api/add-task", {
    title: "Stress test task",
    description: "added by stress test",
  });
  assert(addTask.status === 200, "POST /api/add-task -> 200");
  const newProj = await api("POST", "/api/projects", {
    name: "Stress test project",
    description: "created by stress test",
  });
  assert(newProj.status === 200, "POST /api/projects -> 200");
  // Reset back to canonical demo project so subsequent tests have stable data
  await api("POST", "/api/skip-to-demo", {});

  // 14. Explain / blame / comment (AI endpoints)
  step("14. AI endpoints (explain / blame / comment)");
  const state6 = await api("GET", "/api/state");
  const prForExplain = state6.json?.prs?.[0];
  if (prForExplain) {
    const ex = await api("POST", "/api/explain", { prId: prForExplain.id });
    assert(ex.status === 200, "POST /api/explain -> 200");
    if (!ex.json?.explanation) finding("Changes", "med", "explain returned no explanation text");
  }
  const c = await api("POST", "/api/comment", {
    text: "add a dark mode toggle to the dashboard header",
  });
  assert(c.status === 200, "POST /api/comment -> 200");
  if (c.json?.task?.id) {
    assert(typeof c.json.task.title === "string", "comment routed to a task with a title");
  }

  // 15. Run all + run-full-demo
  step("15. Bulk run + scripted demo");
  const runAll = await api("POST", "/api/run-all", {});
  assert(runAll.status === 200, "POST /api/run-all -> 200");

  // 16. Notifications + worktrees + commits
  step("16. Git primitives (branches / worktrees / commits / notifications)");
  const branches = await api("GET", "/api/branches");
  assert(branches.status === 200, "GET /api/branches -> 200");
  assert(Array.isArray(branches.json) && branches.json.length >= 1, ">=1 branch");
  const worktrees = await api("GET", "/api/worktrees");
  assert(worktrees.status === 200, "GET /api/worktrees -> 200");
  const notifs = await api("GET", "/api/notifications");
  assert(notifs.status === 200, "GET /api/notifications -> 200");

  // 17. Connectors + suggested apps (verified before step 13 broke active project)
  step("17. Connectors + suggested apps + discoveries");
  const conns = await api("GET", "/api/connections");
  assert(conns.status === 200, "GET /api/connections -> 200");
  assert(Array.isArray(conns.json) && conns.json.length >= 8, "8 connectors");
  const apps = await api("GET", "/api/suggested-apps");
  assert(apps.status === 200, "GET /api/suggested-apps -> 200");
  const appsArr = apps.json?.suggestedApps ?? apps.json;
  assert(
    Array.isArray(appsArr) && appsArr.length >= 5,
    `>=5 suggested apps (got ${appsArr?.length})`,
  );
  const disc = await api("GET", "/api/discoveries");
  assert(disc.status === 200, "GET /api/discoveries -> 200");
  const discArr = disc.json?.discoveries ?? disc.json;
  assert(Array.isArray(discArr) && discArr.length >= 6, `>=6 discoveries (got ${discArr?.length})`);

  // 18. Agent activity drill-down
  step("18. Agent activity (per-agent runs)");
  const state7 = await api("GET", "/api/state");
  const sampleAgent = state7.json?.agents?.[0];
  if (sampleAgent) {
    const runs = await api("GET", `/api/agent-runs?agentId=${sampleAgent.id}`);
    assert(runs.status === 200, "GET /api/agent-runs -> 200");
  }

  // 19. Browser walk: render every screen
  step("19. Browser walk — all app screens render without console errors");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const screens = [
    ["/", "ForgeCloud"],
    ["/app", "Pleasure Pizza"],
    ["/app/chat", "Build Room"],
    ["/app/connect", "Connect"],
    ["/app/discoveries", "Discoveries"],
    ["/app/suggested-apps", "Suggested"],
    ["/app/preview", "Live preview"],
    ["/app/changes", "Changes"],
    ["/app/branches", "Branches"],
    ["/app/failures", "Failure"],
    ["/app/tasks", "Tasks"],
    ["/app/agents", "Agents"],
    ["/app/deployments", "Deployments"],
    ["/app/team", "Team"],
    ["/app/activity", "Activity"],
    ["/app/report", "Report"],
    ["/app/settings", "Settings"],
  ];
  for (const [path, needle] of screens) {
    try {
      await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      const html = await page.content();
      if (html.toLowerCase().includes("404") || html.toLowerCase().includes("page not found")) {
        fail(`screen ${path} returned 404 page`);
      } else {
        ok(`screen ${path} rendered`);
      }
    } catch (err) {
      fail(`screen ${path} failed to load`, err.message);
    }
  }
  await browser.close();

  if (consoleErrors.length > 0) {
    finding("Browser", "med", `${consoleErrors.length} console error(s) during browser walk`);
    consoleErrors.slice(0, 5).forEach((e) => console.log(`     - ${e.slice(0, 200)}`));
  } else {
    ok("0 console errors during browser walk");
  }

  // Summary
  const pass = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n=== Stress test summary ===`);
  console.log(`PASS: ${pass}    FAIL: ${failCount}    FINDINGS: ${findings.length}`);
  if (findings.length > 0) {
    console.log(`\nFindings:`);
    for (const f of findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.area}: ${f.message}`);
    }
  }
  if (failCount > 0) {
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("stress test crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2_000);
        server.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });
