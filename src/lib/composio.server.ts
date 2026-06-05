import type Database from "better-sqlite3";

import { log } from "./logger";

const DEFAULT_BASE_URL = "https://backend.composio.dev/api/v3.1";

const PROVIDERS = [
  ["gmail", "gmail", "Gmail"],
  ["google_sheets", "googlesheets", "Google Sheets"],
  ["google_calendar", "googlecalendar", "Google Calendar"],
  ["slack", "slack", "Slack"],
  ["stripe", "stripe", "Stripe / POS"],
  ["notion", "notion", "Notion"],
  ["hubspot", "hubspot", "HubSpot"],
  ["shopify", "shopify", "Shopify"],
] as const;

type Provider = (typeof PROVIDERS)[number][0];

type ComposioTool = {
  slug: string;
  name: string;
  description: string;
};

type ScanSignal = {
  id: string;
  provider: string;
  label: string;
  detail: string;
  count: number;
  externalId: string;
  toolSlug: string;
  mode: "live" | "demo" | "demo-fallback";
};

type ScanExecution = {
  provider: string;
  mode: ScanSignal["mode"];
  toolSlug: string;
  searched: boolean;
  successful: boolean;
  error?: string;
};

type ConnectionRow = {
  id: string;
  provider: string;
  label: string;
  account_label: string | null;
  external_account_id: string | null;
};

const SCAN_QUERY_BY_PROVIDER: Record<Provider, string> = {
  gmail: "Find recent customer emails, catering requests, complaints, and sales leads",
  google_sheets: "Read business spreadsheet rows for sales, staffing, slow hours, and leads",
  google_calendar: "Find upcoming catering events, reservations, and busy service windows",
  slack: "Search staff operations messages for shift swaps, requests, and blockers",
  stripe: "Summarize recent payment, refund, and revenue trends",
  notion: "Find operations notes, tasks, and runbooks that can become app features",
  hubspot: "Find sales leads, customers, deals, and follow-up tasks",
  shopify: "Summarize orders, abandoned carts, products, and customer trends",
};

const TOOLKIT_LABELS = Object.fromEntries(
  PROVIDERS.map(([provider, toolkitSlug, label]) => [provider, { toolkitSlug, label }]),
) as Record<Provider, { toolkitSlug: string; label: string }>;

function apiKey() {
  return process.env.COMPOSIO_API_KEY?.trim() || "";
}

function baseUrl() {
  return (process.env.COMPOSIO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function authConfig(provider: string) {
  const envName = `COMPOSIO_${provider.toUpperCase()}_AUTH_CONFIG_ID`;
  return process.env[envName]?.trim() || null;
}

function userId(workspaceId: string) {
  return `${process.env.COMPOSIO_USER_PREFIX?.trim() || "forgecloud"}:${workspaceId}`;
}

export function getComposioStatus() {
  const live = Boolean(apiKey());
  const providers = PROVIDERS.map(([provider, toolkitSlug, label]) => ({
    provider,
    toolkitSlug,
    label,
    configured: Boolean(authConfig(provider)),
  }));
  return {
    source: "composio",
    mode: live ? "live" : "demo",
    ready: true,
    baseUrl: baseUrl(),
    missing: [],
    detail: live
      ? "Composio API key configured; configured toolkits can create OAuth link sessions."
      : "Composio demo mode; ForgeCloud simulates connected accounts and action execution locally.",
    providers,
  };
}

export async function connectViaComposio(input: {
  workspaceId: string;
  provider: string;
  accountLabel?: string;
}) {
  const meta = PROVIDERS.find(([provider]) => provider === input.provider);
  if (!meta) throw Object.assign(new Error("Connector not found"), { statusCode: 404 });
  const [provider, toolkitSlug, label] = meta;
  const authConfigId = authConfig(provider);
  const accountLabel = input.accountLabel?.trim() || demoAccountLabel(provider);
  if (!apiKey() || !authConfigId) {
    return {
      status: "connected",
      accountLabel,
      externalAccountId: `demo-${input.workspaceId}-${toolkitSlug}`,
      connectUrl: null,
      syncDetail: `${label} connected through Composio demo mode.`,
      toolkitSlug,
      authConfigId,
    };
  }
  const payload = await composioFetch("/connected_accounts/link", {
    method: "POST",
    body: {
      auth_config_id: authConfigId,
      user_id: userId(input.workspaceId),
      alias: accountLabel,
    },
  });
  return {
    status: payload.redirect_url ? "pending" : "connected",
    accountLabel,
    externalAccountId: String(payload.connected_account_id ?? `pending-${Date.now()}`),
    connectUrl: typeof payload.redirect_url === "string" ? payload.redirect_url : null,
    syncDetail: payload.redirect_url
      ? "Composio OAuth link created; finish authorization from the redirect URL."
      : "Composio connected account created.",
    toolkitSlug,
    authConfigId,
  };
}

export async function disconnectViaComposio(input: {
  provider: string;
  externalAccountId?: string | null;
}) {
  if (!apiKey() || !input.externalAccountId || input.externalAccountId.startsWith("demo-")) return;
  try {
    await composioFetch(`/connected_accounts/${encodeURIComponent(input.externalAccountId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    log.warn("composio_disconnect_failed", {
      provider: input.provider,
      error: (error as Error).message,
    });
  }
}

export async function searchComposioTools(input: {
  provider: string;
  query?: string;
  limit?: number;
}): Promise<{ mode: "live" | "demo"; tools: ComposioTool[] }> {
  const meta = providerMeta(input.provider);
  const query = input.query?.trim() || SCAN_QUERY_BY_PROVIDER[meta.provider];
  const envSlug = scanToolOverride(meta.provider);
  if (!apiKey()) {
    return {
      mode: "demo",
      tools: [demoTool(meta.provider, envSlug)],
    };
  }

  const params = new URLSearchParams({
    toolkit_slug: meta.toolkitSlug,
    query,
    limit: String(input.limit ?? 3),
    toolkit_versions: "latest",
  });
  const authConfigId = authConfig(meta.provider);
  if (authConfigId) params.set("auth_config_ids", authConfigId);
  const payload = await composioFetch(`/tools?${params.toString()}`, { method: "GET" });
  const items = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload)
      ? payload
      : [];
  const tools = items
    .map((item) => ({
      slug: String(item?.slug ?? ""),
      name: String(item?.name ?? item?.slug ?? ""),
      description: String(item?.description ?? item?.human_description ?? ""),
    }))
    .filter((tool) => tool.slug);
  return {
    mode: "live",
    tools: envSlug ? [demoTool(meta.provider, envSlug), ...tools] : tools,
  };
}

export async function executeComposioAction(input: {
  provider: string;
  toolSlug: string;
  connectedAccountId?: string | null;
  workspaceId: string;
  accountLabel?: string | null;
  text?: string;
  arguments?: Record<string, unknown>;
}) {
  const meta = providerMeta(input.provider);
  const text =
    input.text?.trim() ||
    `Scan ${meta.label} for business signals ForgeCloud can turn into apps. Return compact JSON signals with label, detail, and count.`;

  if (!apiKey()) {
    return demoExecutionPayload(meta.provider, input.toolSlug);
  }

  return composioFetch(`/tools/execute/${encodeURIComponent(input.toolSlug)}`, {
    method: "POST",
    body: {
      connected_account_id: input.connectedAccountId || undefined,
      user_id: userId(input.workspaceId),
      text,
      arguments: input.arguments,
    },
  });
}

export async function scanWithComposio(input: {
  db: Database.Database;
  workspaceId: string;
  projectId: string;
}) {
  const rows = input.db
    .prepare(
      `SELECT id, provider, label, account_label, external_account_id
         FROM connections
        WHERE workspace_id = ? AND status = 'connected'`,
    )
    .all(input.workspaceId) as ConnectionRow[];
  const signals: ScanSignal[] = [];
  const executions: ScanExecution[] = [];

  for (const row of rows) {
    const result = await scanConnection(row, input.workspaceId);
    signals.push(...result.signals);
    executions.push(result.execution);
  }

  const insert = input.db.prepare(
    `INSERT INTO discoveries
       (id, workspace_id, project_id, connection_id, provider, label, detail, count, source, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'composio', ?)
     ON CONFLICT(id) DO UPDATE SET
       connection_id = excluded.connection_id,
       detail = excluded.detail,
       count = excluded.count,
       source = 'composio',
       external_id = excluded.external_id`,
  );
  for (const signal of signals) {
    insert.run(
      signal.id,
      input.workspaceId,
      input.projectId,
      rows.find((row) => row.provider === signal.provider)?.id ?? null,
      signal.provider,
      signal.label,
      signal.detail,
      signal.count,
      signal.externalId,
    );
  }

  const suggestions = upsertSuggestedAppsFromSignals(input.db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    signals,
  });

  return { signals, executions, suggestions };
}

function demoAccountLabel(provider: string) {
  if (provider === "gmail") return "sal@pleasurepizza.com";
  if (provider === "google_sheets") return "Pleasure Pizza - Sales 2026";
  if (provider === "google_calendar") return "Catering & Events";
  if (provider === "slack") return "Pleasure Pizza HQ";
  if (provider === "stripe") return "Pleasure Pizza POS";
  return "Pleasure Pizza workspace";
}

async function scanConnection(row: ConnectionRow, workspaceId: string) {
  const meta = providerMeta(row.provider);
  const query = SCAN_QUERY_BY_PROVIDER[meta.provider];
  let searched = false;

  try {
    const search = await searchComposioTools({ provider: row.provider, query, limit: 3 });
    searched = search.mode === "live";
    const tool = search.tools[0] ?? demoTool(meta.provider);
    const payload = await executeComposioAction({
      provider: row.provider,
      toolSlug: tool.slug,
      connectedAccountId: row.external_account_id,
      workspaceId,
      accountLabel: row.account_label,
      text: query,
      arguments: {
        query,
        provider: row.provider,
        workspace_id: workspaceId,
        account_label: row.account_label,
      },
    });
    const mode = search.mode;
    const signals = normalizeSignals({
      payload,
      provider: row.provider,
      toolSlug: tool.slug,
      mode,
    });
    return {
      signals,
      execution: {
        provider: row.provider,
        mode,
        toolSlug: tool.slug,
        searched,
        successful: true,
      },
    };
  } catch (error) {
    log.warn("composio_scan_failed", {
      provider: row.provider,
      error: (error as Error).message,
    });
    const fallbackTool = demoTool(meta.provider);
    return {
      signals: demoSignals(meta.provider, "demo-fallback", fallbackTool.slug),
      execution: {
        provider: row.provider,
        mode: "demo-fallback" as const,
        toolSlug: fallbackTool.slug,
        searched,
        successful: false,
        error: (error as Error).message,
      },
    };
  }
}

function normalizeSignals(input: {
  payload: unknown;
  provider: string;
  toolSlug: string;
  mode: "live" | "demo";
}): ScanSignal[] {
  const data = payloadAsRecord(input.payload);
  const nested = payloadAsRecord(data.data ?? data.result ?? data.output ?? data);
  const candidates =
    arrayValue(nested.signals) ??
    arrayValue(nested.discoveries) ??
    arrayValue(nested.items) ??
    arrayValue(nested.messages) ??
    arrayValue(nested.rows) ??
    arrayValue(nested.events);

  if (!candidates || candidates.length === 0) {
    if (input.mode === "demo") return demoSignals(input.provider, "demo", input.toolSlug);
    const count =
      numberValue(nested.count) ??
      numberValue(nested.total) ??
      numberValue(nested.total_items) ??
      numberValue(data.total_items) ??
      1;
    return [
      makeSignal({
        provider: input.provider,
        label: `${providerLabel(input.provider)} scan`,
        detail: `Composio ${input.toolSlug} completed and returned ${count} item${count === 1 ? "" : "s"}.`,
        count,
        externalId: String(data.log_id ?? `${input.provider}:${input.toolSlug}:live`),
        toolSlug: input.toolSlug,
        mode: "live",
      }),
    ];
  }

  return candidates.slice(0, 8).map((candidate, index) => {
    const item = payloadAsRecord(candidate);
    const label = String(
      item.label ??
        item.title ??
        item.subject ??
        item.name ??
        `${providerLabel(input.provider)} signal`,
    );
    const count = numberValue(item.count) ?? numberValue(item.total) ?? 1;
    const detail = String(
      item.detail ??
        item.summary ??
        item.description ??
        `${count} item${count === 1 ? "" : "s"} surfaced through Composio ${providerLabel(
          input.provider,
        )}.`,
    );
    return makeSignal({
      provider: input.provider,
      label,
      detail: detail.includes("Composio") ? detail : `${detail}, surfaced through Composio`,
      count,
      externalId: String(
        item.external_id ?? item.id ?? `${input.provider}:${input.toolSlug}:${index}`,
      ),
      toolSlug: input.toolSlug,
      mode: input.mode,
    });
  });
}

function demoSignals(
  providerFilter?: string,
  mode: ScanSignal["mode"] = "demo",
  toolSlug?: string,
) {
  return [
    [
      "disc-1",
      "gmail",
      "Catering requests",
      "12 catering inquiries surfaced through Composio Gmail.",
      12,
    ],
    [
      "disc-2",
      "gmail",
      "Customer complaints",
      "3 complaint emails surfaced through Composio Gmail.",
      3,
    ],
    [
      "disc-3",
      "google_sheets",
      "Daily sales",
      "Sales-by-hour rows surfaced through Composio Google Sheets.",
      90,
    ],
    [
      "disc-6",
      "google_calendar",
      "Catering & events",
      "4 confirmed events surfaced through Composio Google Calendar.",
      4,
    ],
    [
      "disc-7",
      "slack",
      "Staff requests",
      "5 shift-swap messages surfaced through Composio Slack.",
      5,
    ],
    ["disc-8", "stripe", "Payment trends", "Payment trends surfaced through Composio Stripe.", 28],
    ["disc-9", "notion", "Ops notes", "Ops notes surfaced through Composio Notion.", 7],
    [
      "disc-10",
      "hubspot",
      "Lead follow-ups",
      "Lead follow-ups surfaced through Composio HubSpot.",
      11,
    ],
    ["disc-11", "shopify", "Order trends", "Order trends surfaced through Composio Shopify.", 34],
  ]
    .filter(([, provider]) => !providerFilter || provider === providerFilter)
    .map(([id, provider, label, detail, count]) =>
      makeSignal({
        id: String(id),
        provider: String(provider),
        label: String(label),
        detail: String(detail),
        count: Number(count),
        externalId: `${mode}:${provider}:${id}`,
        toolSlug: toolSlug ?? demoTool(String(provider)).slug,
        mode,
      }),
    );
}

function upsertSuggestedAppsFromSignals(
  db: Database.Database,
  input: { workspaceId: string; projectId: string; signals: ScanSignal[] },
) {
  if (input.signals.length === 0) return [];
  const providers = new Set(input.signals.map((signal) => signal.provider));
  const text = input.signals.map((signal) => `${signal.label} ${signal.detail}`).join(" ");
  const candidates = suggestedAppsForSignals(providers, text).map((app) => ({
    ...app,
    evidence: input.signals
      .filter((signal) => app.uses.includes(signal.provider))
      .slice(0, 4)
      .map(
        (signal) =>
          `Composio ${signal.mode} ${signal.toolSlug} surfaced ${signal.label} (${signal.count})`,
      ),
  }));
  const insert = db.prepare(
    `INSERT INTO suggested_apps
       (id, workspace_id, project_id, slug, title, description, icon, uses_connections, sample_features, source, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'composio-execution', ?)
     ON CONFLICT(id) DO UPDATE SET
       description = excluded.description,
       uses_connections = excluded.uses_connections,
       sample_features = excluded.sample_features,
       source = 'composio-execution',
       evidence = excluded.evidence`,
  );
  for (const app of candidates) {
    insert.run(
      app.id,
      input.workspaceId,
      input.projectId,
      app.slug,
      app.title,
      app.description,
      null,
      JSON.stringify(app.uses),
      JSON.stringify(app.features),
      JSON.stringify(app.evidence),
    );
  }
  return candidates;
}

function suggestedAppsForSignals(providers: Set<string>, text: string) {
  const lower = text.toLowerCase();
  const apps = [];
  if (providers.size >= 2 || providers.has("stripe")) {
    apps.push({
      id: "app-pizza-ops",
      slug: "pizza-ops-dashboard",
      title: "Pizza Ops Dashboard",
      description: "A live ops dashboard generated from the connected Composio business signals.",
      uses: [...providers].slice(0, 4),
      features: ["Signal dashboard", "Follow-up queue", "Owner approvals", "Daily summary"],
    });
  }
  if (providers.has("gmail") && (providers.has("google_calendar") || lower.includes("catering"))) {
    apps.push({
      id: "app-catering",
      slug: "catering-tracker",
      title: "Catering Order Tracker",
      description: "Track inbound catering requests from connected inbox and calendar signals.",
      uses: ["gmail", "google_calendar"].filter((provider) => providers.has(provider)),
      features: ["Inbound requests", "Quote builder", "Event calendar", "Win/loss tracking"],
    });
  }
  if (providers.has("gmail") && lower.includes("complaint")) {
    apps.push({
      id: "app-complaints",
      slug: "complaint-manager",
      title: "Complaint Manager",
      description: "Triage and resolve customer complaints surfaced from connected messages.",
      uses: ["gmail"],
      features: ["Inbox triage", "Resolution status", "Owner sign-off"],
    });
  }
  if (providers.has("google_sheets") && /staff|shift|schedule/.test(lower)) {
    apps.push({
      id: "app-staff",
      slug: "staff-task-board",
      title: "Staff Task Board",
      description: "Turn staff and shift signals into a daily operating checklist.",
      uses: ["google_sheets"],
      features: ["Daily reset", "Per-staff status", "Closing checklist"],
    });
  }
  if (providers.has("google_sheets") && /sales|slow|hour/.test(lower)) {
    apps.push({
      id: "app-slow-day",
      slug: "slow-day-promo",
      title: "Slow-Day Promo Tool",
      description: "Detect quiet sales windows and propose owner-approved promos.",
      uses: ["google_sheets"],
      features: ["Slow-day detection", "Promo composer", "Profit estimate", "Owner approval"],
    });
  }
  if (providers.has("gmail") || providers.has("hubspot")) {
    apps.push({
      id: "app-simple-crm",
      slug: "simple-crm",
      title: "Simple CRM",
      description: "Lead dashboard and follow-up workflow based on connected sales signals.",
      uses: ["gmail", "google_sheets", "hubspot"].filter((provider) => providers.has(provider)),
      features: ["Lead dashboard", "Add lead form", "Lead status", "Notes + follow-up", "Search"],
    });
  }
  return apps.filter((app) => app.uses.length > 0);
}

function makeSignal(input: {
  id?: string;
  provider: string;
  label: string;
  detail: string;
  count: number;
  externalId: string;
  toolSlug: string;
  mode: ScanSignal["mode"];
}): ScanSignal {
  const { id: providedId, ...signal } = input;
  const id = providedId ?? `disc-${input.provider}-${slugify(input.label)}`;
  return { id, ...signal };
}

function providerMeta(provider: string) {
  if (provider in TOOLKIT_LABELS) {
    return {
      provider: provider as Provider,
      toolkitSlug: TOOLKIT_LABELS[provider as Provider].toolkitSlug,
      label: TOOLKIT_LABELS[provider as Provider].label,
    };
  }
  throw Object.assign(new Error("Connector not found"), { statusCode: 404 });
}

function providerLabel(provider: string) {
  return provider in TOOLKIT_LABELS ? TOOLKIT_LABELS[provider as Provider].label : provider;
}

function scanToolOverride(provider: string) {
  const envName = `COMPOSIO_${provider.toUpperCase()}_SCAN_TOOL_SLUG`;
  return process.env[envName]?.trim() || null;
}

function demoTool(provider: string, slug?: string | null): ComposioTool {
  const meta = providerMeta(provider);
  return {
    slug: slug || `FORGECLOUD_${meta.toolkitSlug.toUpperCase()}_SCAN_SIGNALS`,
    name: `${meta.label} signal scan`,
    description: `Scan ${meta.label} for ForgeCloud demo business signals.`,
  };
}

function demoExecutionPayload(provider: string, toolSlug: string) {
  return {
    successful: true,
    data: {
      signals: demoSignals(provider, "demo", toolSlug),
    },
    log_id: `demo-${provider}-${Date.now()}`,
  };
}

function payloadAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function composioFetch(path: string, init: { method: string; body?: unknown }) {
  const response = await fetch(`${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
    method: init.method,
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message ?? `Composio ${response.status}`), {
      statusCode: response.status,
      payload,
    });
  }
  return payload;
}
