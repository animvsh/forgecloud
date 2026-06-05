const appUrl = normalizeUrl(process.env.LIVE_APP_URL ?? "https://forgecloud-palembang.pages.dev");
const apiUrl = normalizeUrl(
  process.env.LIVE_API_URL ?? "https://forgecloud-palembang-production.up.railway.app",
);
const loginEmail = process.env.LIVE_LOGIN_EMAIL ?? "sal@pleasurepizza.com";
const requireLiveStack = process.env.LIVE_REQUIRE_STACK !== "false";
const { chromium } = await import("playwright");

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON status ${response.status}: ${text.slice(0, 200)}`);
  }
  return { response, json };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON status ${response.status}: ${text.slice(0, 200)}`);
  }
  return { response, json };
}

async function checkRoutesInBrowser(routes) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const severeConsole = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/401|Failed to load resource/.test(message.text())) {
      severeConsole.push(message.text());
    }
  });
  page.on("pageerror", (error) => severeConsole.push(error.message));

  const checked = {};
  try {
    for (const [name, route] of Object.entries(routes)) {
      const response = await page.goto(`${appUrl}${route.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      assert(response?.ok(), `${appUrl}${route.path} expected 2xx, got ${response?.status()}`);
      await page.waitForTimeout(3_500);
      const text = await page.locator("body").innerText({ timeout: 15_000 });
      assert(route.pattern.test(text), `${appUrl}${route.path} did not render expected app text`);
      checked[name] = { status: response.status(), text: text.slice(0, 120) };
    }
    assert(severeConsole.length === 0, `browser console errors: ${severeConsole.join("; ")}`);
    return checked;
  } finally {
    await browser.close();
  }
}

async function checkCors(origin, shouldAllow) {
  const response = await fetch(`${apiUrl}/api/state`, {
    method: "OPTIONS",
    headers: { origin },
  });
  const allowOrigin = response.headers.get("access-control-allow-origin");
  assert(
    response.status === 204,
    `CORS preflight for ${origin} expected 204, got ${response.status}`,
  );
  assert(
    shouldAllow ? allowOrigin === origin : allowOrigin === null,
    shouldAllow
      ? `CORS should allow ${origin}; got ${allowOrigin ?? "no allow-origin"}`
      : `CORS should not allow ${origin}; got ${allowOrigin}`,
  );
  return { origin, allowOrigin };
}

const results = {};

try {
  results.routes = await checkRoutesInBrowser({
    home: { path: "/", pattern: /ForgeCloud|software team|AI agents/i },
    app: { path: "/app", pattern: /Sign in required|Pleasure Pizza|Build Room/i },
    chat: { path: "/app/chat", pattern: /Sign in required|Product Agent|Build Room/i },
  });

  const health = await getJson(`${apiUrl}/api/health`);
  results.healthStatus = health.response.status;
  results.health = {
    ok: health.json?.ok,
    db: health.json?.db,
    provider: health.json?.provider,
    deployment: health.json?.deployment,
    stack: health.json?.stack,
  };

  assert(health.response.ok, `/api/health expected 2xx, got ${health.response.status}`);
  assert(health.json?.ok === true, "/api/health did not report ok: true");
  assert(health.json?.db === "up", "/api/health did not report db: up");
  assert(
    health.json?.deployment?.mode === "production",
    "live API is not in production deploy mode",
  );
  assert(
    health.json?.deployment?.canDeployProduction === true,
    "live API cannot run production deploys; provider hook/public URL config is incomplete",
  );
  const healthChecks = health.json?.checks ?? [];
  for (const checkName of ["auth_session_secret", "auth_login_delivery", "auth_dev_fallback"]) {
    assert(
      healthChecks.some((check) => check.name === checkName && check.passed === true),
      `live API failed auth readiness check: ${checkName}`,
    );
  }
  if (requireLiveStack) {
    assert(
      health.json?.stack?.liveRequired === true,
      "live API is not enforcing FORGECLOUD_REQUIRE_LIVE_STACK=true",
    );
    assert(
      health.json?.stack?.allLiveConfigured === true,
      "live API does not have all required stack services configured",
    );
    const missingLiveServices = (health.json?.stack?.services ?? [])
      .filter((service) => !service.configured)
      .map((service) => service.key);
    assert(
      missingLiveServices.length === 0,
      `live API has unconfigured stack services: ${missingLiveServices.join(", ")}`,
    );
  }

  const login = await postJson(`${apiUrl}/api/auth/request-login`, {
    email: loginEmail,
    workspaceId: "ws-default",
  });
  results.loginDelivery = {
    status: login.response.status,
    delivered: login.json?.delivered,
    returnedCode: Boolean(login.json?.code),
  };
  assert(login.response.ok, `/api/auth/request-login expected 2xx, got ${login.response.status}`);
  assert(login.json?.delivered === true, "login-code delivery did not report delivered: true");
  assert(!login.json?.code, "production login must not return the code in the API response");

  results.cors = [
    await checkCors(appUrl, true),
    await checkCors("https://preview-for-qa.forgecloud-palembang.pages.dev", true),
    await checkCors("https://evil.example.com", false),
  ];

  console.log(JSON.stringify({ ok: true, appUrl, apiUrl, results }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        appUrl,
        apiUrl,
        error: error instanceof Error ? error.message : String(error),
        results,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
