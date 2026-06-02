// Node.js HTTP server adapter for Railway.
// Wraps the Nitro/TanStack Start fetch handler (dist/server/server.js) into a
// plain Node HTTP server that listens on PORT (Railway provides this env var).
//
// Usage:  node server-entry.mjs
// or:     bun run server-entry.mjs

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = resolve(__dirname, "dist", "client");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
};

// Load the SSR fetch handler from the Nitro build output.
const { default: serverEntry } = await import("./dist/server/server.js");

// Load the plain HTTP API handler (bypasses the broken createServerFn / Seroval).
// Built by `npm run build:api` (esbuild) from src/server/api-handler.ts.
let handleApiRequest = null;
try {
  const apiModule = await import("./dist/server/api-handler.mjs");
  handleApiRequest = apiModule.handleApiRequest;
} catch (err) {
  console.warn("[server-entry] API handler not loaded (run `npm run build:api`):", err?.message);
}

// Serve static client assets directly (the fetch handler is SSR-only).
async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Map "/" -> "/index.html"
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  // Prevent path traversal — resolve and ensure the result stays in CLIENT_DIR.
  const filePath = normalize(join(CLIENT_DIR, pathname));
  if (!filePath.startsWith(CLIENT_DIR + "/") && filePath !== CLIENT_DIR) {
    return false;
  }

  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
  } catch {
    return false;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(body);
  return true;
}

// Security headers applied to every response.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.hasHeader(k)) res.setHeader(k, v);
  }
}

// Convert an incoming Node HTTP request into a Fetch Request and run it
// through the Nitro/TanStack Start handler.
const server = createServer(async (req, res) => {
  applySecurityHeaders(res);
  try {
    // Try static asset first (faster, offloads the SSR runtime).
    if (await serveStatic(req, res)) return;

    // Route plain /api/* requests to the new HTTP API handler.
    // This bypasses the broken createServerFn / Seroval serialization.
    const requestUrl = req.url ?? "";
    if (requestUrl.startsWith("/api/") && handleApiRequest) {
      const handled = await handleApiRequest(req, res);
      if (handled) return;
    }

    // Fall through to the SSR fetch handler for everything else (pages, API, server fns).
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) headers.set(key, value.join(", "));
      else headers.set(key, value);
    }

    const protocol = req.headers["x-forwarded-proto"] ?? "http";
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    const url = `${protocol}://${host}${req.url}`;

    const fetchRequest = new Request(url, {
      method: req.method,
      headers,
      body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      duplex: "half",
    });

    const response = await serverEntry.fetch(fetchRequest, process.env, {});

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error("[server-entry] request failed:", err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server-entry] ForgeCloud listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown: stop accepting new connections, drain in-flight, exit.
function shutdown(signal) {
  console.log(`[server-entry] received ${signal}, shutting down…`);
  const forceTimer = setTimeout(() => {
    console.error("[server-entry] forced exit after 10s drain timeout");
    process.exit(1);
  }, 10_000);
  forceTimer.unref?.();
  server.close((err) => {
    if (err) {
      console.error("[server-entry] close error:", err);
      process.exit(1);
    }
    console.log("[server-entry] closed cleanly");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
