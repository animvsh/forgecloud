import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, Plug2, Search, Sparkles } from "lucide-react";
import { useForgeState } from "@/lib/client";
import { ScreenHeader } from "@/components/ScreenHeader";

export const Route = createFileRoute("/app/discoveries")({
  head: () => ({ meta: [{ title: "What I found — ForgeCloud" }] }),
  component: DiscoveriesScreen,
});

type Discovery = {
  id: string;
  provider: string;
  label: string;
  detail: string;
  count: number;
  source?: string | null;
};

type Connection = {
  id: string;
  provider: string;
  label: string;
  icon: string;
  status: string;
};

const ACCENTS = [
  "var(--brand)",
  "var(--violet)",
  "var(--sky)",
  "var(--amber)",
  "var(--coral)",
  "var(--mint)",
];

function accentFor(provider: string) {
  let hash = 0;
  for (let i = 0; i < provider.length; i++) hash = (hash * 31 + provider.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

function DiscoveriesScreen() {
  const navigate = useNavigate();
  const { data, isLoading } = useForgeState();

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading discoveries...</p>
        </div>
      </div>
    );
  }

  const discoveries: Discovery[] = data.discoveries ?? [];
  const connections: Connection[] = data.connections ?? [];
  const composio = data.composio;

  const grouped = discoveries.reduce<Record<string, Discovery[]>>((acc, d) => {
    (acc[d.provider] ||= []).push(d);
    return acc;
  }, {});

  function providerMeta(provider: string) {
    const c = connections.find((x) => x.provider === provider);
    return {
      label: c?.label ?? provider,
      icon: c?.icon ?? "📦",
      accent: accentFor(provider),
    };
  }

  if (discoveries.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <ScreenHeader
          title="What I found"
          subtitle="Composio-managed connected accounts are scanned for business signals ForgeCloud can turn into apps."
        />
        <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center card-hover">
          <div
            className="mx-auto flex size-14 items-center justify-center squircle"
            style={{ background: "var(--sky)" }}
          >
            <Search className="size-7 text-foreground" />
          </div>
          <h2 className="mt-4 text-2xl font-bold">Nothing scanned yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect a tool first so ForgeCloud has data to look at.
          </p>
          <Link
            to="/app/connect"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground shadow-lg shadow-brand/30 transition-all hover:brightness-105"
          >
            <Plug2 className="size-4" /> Connect tools
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ScreenHeader
        title="What I found"
        subtitle="Composio-managed connected accounts are scanned for business signals ForgeCloud can turn into apps."
        action={
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Search className="size-3.5" />
            Composio {composio?.mode ?? "demo"} · {discoveries.length} signal
            {discoveries.length === 1 ? "" : "s"}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(grouped).map(([provider, rows]) => {
          const meta = providerMeta(provider);
          return (
            <div key={provider} className="rounded-3xl border border-border bg-card p-5 card-hover">
              <div className="flex items-center gap-3 border-b border-border pb-3">
                <div
                  className="flex size-10 items-center justify-center squircle text-xl"
                  style={{ background: meta.accent }}
                >
                  <span>{meta.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold truncate">{meta.label}</h3>
                  <p className="text-xs text-muted-foreground">
                    {rows.length} Composio signal{rows.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <ul className="mt-3 space-y-3">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-start gap-3 rounded-2xl bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{row.label}</span>
                        <span className="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-semibold text-foreground/70">
                          {row.count}
                        </span>
                        <span className="shrink-0 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-mint">
                          {row.source ?? "composio"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {row.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur animate-in slide-in-from-bottom-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="text-sm text-muted-foreground">
            Ready to turn these signals into apps?
          </div>
          <button
            onClick={() => navigate({ to: "/app/suggested-apps" })}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground shadow-lg shadow-brand/30 transition-all hover:brightness-105 hover:scale-105"
          >
            <Sparkles className="size-4" />
            See suggested apps
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
