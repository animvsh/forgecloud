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

export type StackServiceKey = "rocketride" | "butterbase" | "xtrace" | "composio";
export type StackServiceMode = "local" | "webhook" | "api" | "simulation";

export type StackServiceConfig = {
  key: StackServiceKey;
  label: string;
  role: string;
  mode: StackServiceMode;
  ready: boolean;
  endpoint: string | null;
  token: string | null;
  missing: string[];
  detail: string;
};

export type PublicStackServiceConfig = Omit<StackServiceConfig, "endpoint" | "token"> & {
  configured: boolean;
};

export type PublicStackConfig = {
  services: PublicStackServiceConfig[];
  readyCount: number;
  totalCount: number;
  allReady: boolean;
  liveRequired: boolean;
  liveConfiguredCount: number;
  allLiveConfigured: boolean;
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

function stackService(input: {
  key: StackServiceKey;
  label: string;
  role: string;
  endpointEnv?: string;
  tokenEnv?: string;
  localReady?: boolean;
  localDetail?: string;
  simulationDetail: string;
}): StackServiceConfig {
  const endpoint = input.endpointEnv ? process.env[input.endpointEnv] : undefined;
  const token = input.tokenEnv ? process.env[input.tokenEnv] : undefined;
  if (endpoint) {
    const missing = input.tokenEnv && !token ? [input.tokenEnv] : [];
    return {
      key: input.key,
      label: input.label,
      role: input.role,
      mode: "webhook",
      ready: missing.length === 0,
      endpoint,
      token: token ?? null,
      missing,
      detail:
        missing.length === 0
          ? `${input.label} webhook configured`
          : `${input.label} webhook configured but missing token`,
    };
  }

  if (input.localReady) {
    return {
      key: input.key,
      label: input.label,
      role: input.role,
      mode: "local",
      ready: true,
      endpoint: null,
      token: null,
      missing: [],
      detail: input.localDetail ?? `${input.label} backed by local ForgeCloud runtime`,
    };
  }

  return {
    key: input.key,
    label: input.label,
    role: input.role,
    mode: "simulation",
    ready: true,
    endpoint: null,
    token: null,
    missing: [],
    detail: input.simulationDetail,
  };
}

function composioStackService(): StackServiceConfig {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const baseUrl = process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev/api/v3.1";
  const authConfigEnvs = [
    "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
    "COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID",
    "COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
    "COMPOSIO_SLACK_AUTH_CONFIG_ID",
    "COMPOSIO_STRIPE_AUTH_CONFIG_ID",
    "COMPOSIO_NOTION_AUTH_CONFIG_ID",
    "COMPOSIO_HUBSPOT_AUTH_CONFIG_ID",
    "COMPOSIO_SHOPIFY_AUTH_CONFIG_ID",
  ];
  const configuredAuthConfigs = authConfigEnvs.filter((name) => Boolean(process.env[name]));
  const missing = [];
  if (!apiKey) missing.push("COMPOSIO_API_KEY");
  if (configuredAuthConfigs.length === 0) {
    missing.push("one or more COMPOSIO_*_AUTH_CONFIG_ID");
  }
  if (apiKey) {
    return {
      key: "composio",
      label: "Composio",
      role: "Connection layer for Gmail, Sheets, Slack, Stripe, Notion, HubSpot, and Shopify",
      mode: "api",
      ready: missing.length === 0,
      endpoint: baseUrl,
      token: apiKey,
      missing,
      detail:
        missing.length === 0
          ? `Composio API configured with ${configuredAuthConfigs.length} auth config(s)`
          : "Composio API key configured but no provider auth config IDs are set",
    };
  }
  return {
    key: "composio",
    label: "Composio",
    role: "Connection layer for Gmail, Sheets, Slack, Stripe, Notion, HubSpot, and Shopify",
    mode: "simulation",
    ready: true,
    endpoint: null,
    token: null,
    missing: [],
    detail:
      "External connections are simulated inside ForgeCloud connectors, discoveries, and activity.",
  };
}

export function getStackConfig(): StackServiceConfig[] {
  return [
    stackService({
      key: "rocketride",
      label: "RocketRide",
      role: "Multi-agent workflow engine",
      endpointEnv: "ROCKETRIDE_WORKFLOW_URL",
      tokenEnv: "ROCKETRIDE_API_KEY",
      simulationDetail: "Agent workflow is simulated by ForgeCloud's local orchestrator.",
    }),
    stackService({
      key: "butterbase",
      label: "Butterbase",
      role: "Backend, auth, model gateway, and source of truth",
      endpointEnv: "BUTTERBASE_PROJECT_URL",
      tokenEnv: "BUTTERBASE_API_KEY",
      localReady: true,
      localDetail:
        "Using ForgeCloud's local SQLite store as the Butterbase-compatible source of truth.",
      simulationDetail: "Butterbase is represented by local demo persistence.",
    }),
    stackService({
      key: "xtrace",
      label: "XTrace",
      role: "Persistent project memory and Plain-English Blame context",
      endpointEnv: "XTRACE_MEMORY_URL",
      tokenEnv: "XTRACE_API_KEY",
      localReady: true,
      localDetail: "Using local memory_entries and activity_events for persistent project memory.",
      simulationDetail: "XTrace memory is simulated by local memory entries.",
    }),
    composioStackService(),
  ];
}

export function isLiveStackRequired(): boolean {
  return process.env.FORGECLOUD_REQUIRE_LIVE_STACK === "true";
}

export function getPublicStackConfig(): PublicStackConfig {
  const services = getStackConfig().map(({ endpoint: _endpoint, token: _token, ...service }) => ({
    ...service,
    configured: (service.mode === "webhook" || service.mode === "api") && service.ready,
  }));
  const liveRequired = isLiveStackRequired();
  return {
    services,
    readyCount: services.filter((service) => service.ready).length,
    totalCount: services.length,
    allReady: services.every((service) => service.ready),
    liveRequired,
    liveConfiguredCount: services.filter((service) => service.configured).length,
    allLiveConfigured: services.every((service) => service.configured),
  };
}
