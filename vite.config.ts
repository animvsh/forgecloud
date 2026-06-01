// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApiRequest } from "./src/server/api-handler";

function apiPlugin() {
  return {
    name: "forgecloud-api-middleware",
    configureServer(server: any) {
      console.log("[forgecloud-api] configuring server middleware");
      // Insert at the beginning so it runs before vite's transformIndexHtml etc.
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? "";
        if (url.startsWith("/api/")) {
          console.log("[forgecloud-api] handling", req.method, url);
          try {
            const handled = await handleApiRequest(req, res);
            if (handled) return;
          } catch (e) {
            console.error("[/api] error:", e);
            if (!res.headersSent) {
              res.writeHead(500, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: String(e) }));
            }
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [apiPlugin()],
});
