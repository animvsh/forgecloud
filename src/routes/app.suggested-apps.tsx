import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Hammer, Loader2, Sparkles } from "lucide-react";
import { useBuildSuggestedApp, useForgeState } from "@/lib/client";
import { ScreenHeader } from "@/components/ScreenHeader";

export const Route = createFileRoute("/app/suggested-apps")({
  head: () => ({ meta: [{ title: "Suggested apps — ForgeCloud" }] }),
  component: SuggestedAppsScreen,
});

type SuggestedApp = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  uses_connections: string;
  sample_features: string;
  source?: string | null;
  evidence?: string | null;
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

function accentFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

function parseJsonArray(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function SuggestedAppsScreen() {
  const navigate = useNavigate();
  const { data, isLoading } = useForgeState();
  const buildMutation = useBuildSuggestedApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading suggestions...</p>
        </div>
      </div>
    );
  }

  const apps: SuggestedApp[] = data.suggestedApps ?? [];
  const connections: Connection[] = data.connections ?? [];
  const composio = data.composio;

  function lookupConnection(provider: string) {
    return connections.find((c) => c.provider === provider);
  }

  async function handleBuild(app: SuggestedApp) {
    setBusyId(app.id);
    try {
      const result = (await buildMutation.mutateAsync({ appId: app.id })) as
        | { tasks?: unknown[] }
        | undefined;
      const total = result?.tasks?.length ?? 0;
      toast.success(`Plan ready for ${app.title}`, {
        description: total
          ? `${total} task${total === 1 ? "" : "s"} queued. Review before agents start.`
          : "Review the plan before agents start.",
      });
      navigate({ to: "/app/chat" });
    } catch (err) {
      toast.error("Build failed to start", { description: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ScreenHeader
        title="Apps I can build for you"
        subtitle="Suggestions are generated from Composio-managed tool signals. Pick one to start."
        action={
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            Composio {composio?.mode ?? "demo"} · {apps.length} suggestion
            {apps.length === 1 ? "" : "s"}
          </div>
        }
      />

      {apps.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center card-hover">
          <div
            className="mx-auto flex size-14 items-center justify-center squircle"
            style={{ background: "var(--violet)" }}
          >
            <Sparkles className="size-7 text-white" />
          </div>
          <h2 className="mt-4 text-2xl font-bold">No suggestions yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect tools and scan your data to see suggested apps.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {apps.map((app) => {
            const features = parseJsonArray(app.sample_features);
            const usesProviders = parseJsonArray(app.uses_connections);
            const evidence = parseJsonArray(app.evidence);
            const accent = accentFor(app.slug ?? app.id);
            const busy = busyId === app.id;
            return (
              <div
                key={app.id}
                className="flex flex-col rounded-3xl border border-border bg-card p-6 card-hover transition-all"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex size-14 items-center justify-center squircle text-3xl shrink-0"
                    style={{ background: accent }}
                  >
                    <span>{app.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold">{app.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{app.description}</p>
                  </div>
                </div>

                {features.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-foreground/80">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-mint" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {usesProviders.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Uses through Composio
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {usesProviders.map((provider) => {
                        const c = lookupConnection(provider);
                        return (
                          <span
                            key={provider}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
                          >
                            <span>{c?.icon ?? "🔌"}</span>
                            <span>{c?.label ?? provider}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {evidence.length > 0 && (
                  <div className="mt-4 rounded-2xl bg-muted/40 px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Why ForgeCloud suggested this
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {evidence.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="text-xs text-muted-foreground">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-end pt-2">
                  <button
                    onClick={() => handleBuild(app)}
                    disabled={busy || buildMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-lg shadow-brand/30 transition-all hover:brightness-105 hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Hammer className="size-4" />
                    )}
                    Generate plan
                    <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
