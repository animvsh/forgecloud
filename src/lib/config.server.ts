import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Add server-only values here, e.g.:
    //   databaseUrl: process.env.DATABASE_URL,
    //   stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  };
}

export type DeployMode = "simulation" | "production";
export type DeployProvider = "railway" | "cloudflare";

export type DeploymentConfig = {
  mode: DeployMode;
  provider: DeployProvider;
  productionReady: boolean;
  publicUrl: string | null;
  missing: string[];
  allowFailureInjection: boolean;
  hookUrl: string | null;
  hookToken: string | null;
};

export type PublicDeploymentConfig = Omit<DeploymentConfig, "hookUrl" | "hookToken"> & {
  canDeployProduction: boolean;
};

function normalizeMode(value: string | undefined): DeployMode {
  if (value === "production") return "production";
  if (value === "simulation") return "simulation";
  return process.env.NODE_ENV === "production" ? "production" : "simulation";
}

function normalizeProvider(value: string | undefined): DeployProvider {
  return value === "cloudflare" ? "cloudflare" : "railway";
}

export function getDeploymentConfig(): DeploymentConfig {
  const mode = normalizeMode(process.env.FORGECLOUD_DEPLOY_MODE ?? process.env.DEPLOY_MODE);
  const provider = normalizeProvider(
    process.env.FORGECLOUD_DEPLOY_PROVIDER ?? process.env.DEPLOY_PROVIDER,
  );
  const hookUrl =
    provider === "cloudflare"
      ? process.env.CLOUDFLARE_DEPLOY_HOOK_URL
      : process.env.RAILWAY_DEPLOY_HOOK_URL;
  const publicUrl =
    (provider === "cloudflare"
      ? process.env.CLOUDFLARE_PROJECT_URL
      : process.env.RAILWAY_SERVICE_URL) ??
    process.env.PUBLIC_APP_URL ??
    null;
  const missing: string[] = [];

  if (mode === "production") {
    if (!hookUrl) {
      missing.push(
        provider === "cloudflare" ? "CLOUDFLARE_DEPLOY_HOOK_URL" : "RAILWAY_DEPLOY_HOOK_URL",
      );
    }
    if (!publicUrl) {
      missing.push(
        provider === "cloudflare"
          ? "CLOUDFLARE_PROJECT_URL or PUBLIC_APP_URL"
          : "RAILWAY_SERVICE_URL or PUBLIC_APP_URL",
      );
    }
  }

  return {
    mode,
    provider,
    productionReady: mode === "production" && missing.length === 0,
    publicUrl,
    missing,
    allowFailureInjection:
      process.env.FORGECLOUD_ENABLE_FAILURE_INJECTION === "true" || mode === "simulation",
    hookUrl: hookUrl ?? null,
    hookToken: process.env.DEPLOY_HOOK_TOKEN ?? null,
  };
}

export function getPublicDeploymentConfig(): PublicDeploymentConfig {
  const { hookUrl: _hookUrl, hookToken: _hookToken, ...safe } = getDeploymentConfig();
  return {
    ...safe,
    canDeployProduction: safe.productionReady,
  };
}
