import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "forgecloud-composio-smoke-"));
const requests = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

const signalByToolkit = {
  gmail: [
    {
      id: "mock-gmail-catering",
      label: "Mock catering requests",
      detail: "17 catering leads from the mock Gmail action",
      count: 17,
    },
    {
      id: "mock-gmail-complaints",
      label: "Mock complaint emails",
      detail: "4 customer complaints from the mock Gmail action",
      count: 4,
    },
  ],
  googlesheets: [
    {
      id: "mock-sheets-sales",
      label: "Mock sales rows",
      detail: "144 sales rows from the mock Google Sheets action",
      count: 144,
    },
  ],
  googlecalendar: [
    {
      id: "mock-calendar-events",
      label: "Mock catering events",
      detail: "6 upcoming events from the mock Calendar action",
      count: 6,
    },
  ],
};

const mockServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const body = await readBody(req);
  requests.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    xApiKey: req.headers["x-api-key"] ?? null,
    body,
  });

  if (req.method === "GET" && url.pathname === "/api/v3.1/tools") {
    const toolkit = url.searchParams.get("toolkit_slug") ?? "unknown";
    return send(res, 200, {
      items: [
        {
          slug: `MOCK_${toolkit.toUpperCase()}_SCAN`,
          name: `Mock ${toolkit} scan`,
          description: `Mock scan tool for ${toolkit}`,
          toolkit: { slug: toolkit, name: toolkit },
        },
      ],
    });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/v3.1/tools/execute/")) {
    const toolSlug = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const toolkit = toolSlug
      .replace(/^MOCK_/, "")
      .replace(/_SCAN$/, "")
      .toLowerCase();
    return send(res, 200, {
      successful: true,
      log_id: `log-${toolkit}`,
      data: {
        signals: signalByToolkit[toolkit] ?? [
          {
            id: `mock-${toolkit}`,
            label: `Mock ${toolkit} signal`,
            detail: `1 signal from ${toolkit}`,
            count: 1,
          },
        ],
      },
    });
  }

  return send(res, 404, { error: "not_found" });
});

const port = await new Promise((resolve) => {
  mockServer.listen(0, "127.0.0.1", () => {
    const address = mockServer.address();
    resolve(address.port);
  });
});

process.env.INSFORGE_DB_PATH = join(tempDir, "fresh.sqlite");
process.env.AI_PROVIDER = "fallback";
process.env.COMPOSIO_API_KEY = "mock-composio-key";
process.env.COMPOSIO_BASE_URL = `http://127.0.0.1:${port}/api/v3.1`;

const { handleApiRequest } = await import("../dist/server/api-handler.mjs");

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
  return {
    status: status || res.statusCode,
    json: responseBody ? JSON.parse(responseBody) : null,
    headers: responseHeaders,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const state = await call("GET", "/api/state");
  assert(state.status === 200, `/api/state expected 200, got ${state.status}`);
  assert(state.json.composio?.mode === "live", "Composio status should be live with mock API key");

  const scan = await call("POST", "/api/scan", {});
  assert(scan.status === 200, `/api/scan expected 200, got ${scan.status}`);
  assert(scan.json.composio?.executions?.length >= 3, "/api/scan should execute connected tools");
  assert(
    scan.json.discoveries?.some((discovery) => discovery.external_id === "mock-gmail-catering"),
    "mock Gmail signal should be reflected as a discovery",
  );
  assert(
    scan.json.discoveries?.some((discovery) => String(discovery.detail).includes("mock Gmail")),
    "mock discovery detail should come from Composio execution output",
  );

  const toolSearches = requests.filter(
    (request) => request.method === "GET" && request.path === "/api/v3.1/tools",
  );
  const executions = requests.filter((request) =>
    request.path.startsWith("/api/v3.1/tools/execute/"),
  );
  assert(toolSearches.length >= 3, `expected at least 3 tool searches, got ${toolSearches.length}`);
  assert(executions.length >= 3, `expected at least 3 tool executions, got ${executions.length}`);
  assert(
    requests.every((request) => request.xApiKey === "mock-composio-key"),
    "all mock Composio requests should include x-api-key",
  );
  assert(
    executions.every((request) => request.body?.user_id === "forgecloud:ws-default"),
    "executions should include the ForgeCloud Composio user id",
  );

  const suggested = await call("GET", "/api/suggested-apps");
  assert(suggested.status === 200, `/api/suggested-apps expected 200, got ${suggested.status}`);
  const evidenceDump = JSON.stringify(
    suggested.json.suggestedApps?.map((app) => ({ id: app.id, evidence: app.evidence })),
  );
  assert(
    suggested.json.suggestedApps?.some((app) => String(app.evidence).includes("MOCK_GMAIL_SCAN")),
    `suggested app evidence should reference the mock Composio action; saw ${evidenceDump}`,
  );

  console.log(
    `Composio smoke passed: ${toolSearches.length} searches, ${executions.length} executions`,
  );
} finally {
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
