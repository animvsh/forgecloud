import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  Check,
  Sparkles,
  Rocket,
  Loader2,
  ShieldCheck,
  Undo2,
  Clock,
  KeyRound,
  Database,
  AlertTriangle,
  Bot,
  Gauge,
} from "lucide-react";
import { useForgeState } from "@/lib/client";

export const Route = createFileRoute("/app/report")({
  component: ReportScreen,
});

function ReportScreen() {
  const { data, isLoading } = useForgeState();

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tasks = data.tasks;
  const done = tasks.filter((t) => t.status === "done");
  const review = tasks.filter((t) => t.status === "review");
  const building = tasks.filter((t) => t.status === "building");
  const agents = data.agents;
  const prs = data.prs;
  const recovery = data.recovery;
  const deployments = data.deployments;
  const liveDeploy = deployments.find((d) => d.status === "live" && d.environment === "production");

  const agentContribs: Record<string, number> = {};
  for (const a of agents) {
    agentContribs[a.name] = 0;
  }
  for (const t of done) {
    const a = agents.find((x) => x.id === t.assigned_agent_id);
    if (a) agentContribs[a.name] = (agentContribs[a.name] ?? 0) + 1;
  }
  const sortedContribs = Object.entries(agentContribs).sort(([, a], [, b]) => b - a);

  return (
    <div>
      <ScreenHeader
        title="Final report"
        subtitle="What your AI team built, broke, and recovered."
      />

      <div className="mt-6 space-y-6">
        {done.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Sparkles className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">No report yet. Build some features first.</p>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-3xl border-2 border-brand/30 gradient-header p-8 card-hover">
              <div
                className="absolute -right-8 -top-8 size-32 squircle opacity-20"
                style={{ background: "var(--violet)" }}
              />
              <div
                className="absolute -right-4 -bottom-12 size-24 squircle opacity-10"
                style={{ background: "var(--coral)" }}
              />
              <div className="relative">
                <div className="flex items-center gap-2 text-brand">
                  <div
                    className="flex size-8 items-center justify-center squircle"
                    style={{ background: "var(--violet)" }}
                  >
                    <Check className="size-4 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold gradient-text">
                    {data.project.name} v1 is ready.
                  </h2>
                </div>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                  Built by {agents.length} agents in collaboration with{" "}
                  {data.teamMembers.filter((m) => !m.is_ai).length} humans.
                  {liveDeploy && ` Deployed to ${liveDeploy.railway_url}.`}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Built features</div>
                <ul className="mt-3 space-y-1 text-sm">
                  {done.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <Check className="size-3.5 text-mint" />
                      <span>{t.title}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Agent contributions</div>
                <div className="mt-3 space-y-2">
                  {sortedContribs.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate">{name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-brand to-violet transition-all duration-500"
                          style={{ width: `${Math.min(100, count * 25)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <RisksHandled recovery={recovery} />

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Pull requests</div>
                <div className="mt-2 text-3xl font-bold">{prs.length}</div>
                <div className="text-xs text-muted-foreground">
                  {prs.filter((p) => p.status === "approved").length} approved
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Recoveries</div>
                <div className="mt-2 text-3xl font-bold text-mint">
                  {recovery.filter((r) => r.status === "recovered").length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {recovery.filter((r) => r.status === "blocked").length} blocked
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Deployments</div>
                <div className="mt-2 text-3xl font-bold">{deployments.length}</div>
                <div className="text-xs text-muted-foreground">
                  {deployments.filter((d) => d.status === "live").length} live ·{" "}
                  {deployments.filter((d) => d.status === "failed").length} failed
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">What's next</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/app/deployments"
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 transition-all"
                >
                  <Rocket className="size-3.5" /> View deployments
                </Link>
                <Link
                  to="/app/failures"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  See all recoveries
                </Link>
                <Link
                  to="/app/chat"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  Add another feature
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type RecoveryRow = {
  id: string;
  failure_type: string;
  failure_message?: string | null;
  recovery_action?: string | null;
  status: string;
};

type FailureStyle = {
  Icon: typeof Check;
  label: (count: number) => string;
  accent: "mint" | "coral" | "amber" | "violet";
};

const FAILURE_STYLES: Record<string, FailureStyle> = {
  build_failed: {
    Icon: Undo2,
    label: (n) => `${n} failed build${n === 1 ? "" : "s"} recovered automatically`,
    accent: "mint",
  },
  unsafe_db_migration: {
    Icon: Database,
    label: (n) => `${n} unsafe DB change${n === 1 ? "" : "s"} blocked for human review`,
    accent: "coral",
  },
  model_timeout: {
    Icon: Clock,
    label: (n) => `${n} model timeout${n === 1 ? "" : "s"} — fell back to MiniMax-M1`,
    accent: "amber",
  },
  secret_detected: {
    Icon: KeyRound,
    label: (n) => `${n} secret${n === 1 ? "" : "s"} detected and blocked`,
    accent: "coral",
  },
  deploy_failed: {
    Icon: Rocket,
    label: (n) => `${n} deploy${n === 1 ? "" : "s"} failed — rolled back to last good version`,
    accent: "coral",
  },
  bad_output: {
    Icon: Sparkles,
    label: (n) => `${n} bad agent output${n === 1 ? "" : "s"} regenerated automatically`,
    accent: "mint",
  },
  rate_limit: {
    Icon: Gauge,
    label: (n) => `${n} rate limit${n === 1 ? "" : "s"} smoothed out with backoff retries`,
    accent: "amber",
  },
  agent_conflict: {
    Icon: Bot,
    label: (n) => `${n} agent conflict${n === 1 ? "" : "s"} resolved by QA Agent`,
    accent: "violet",
  },
};

const ACCENT_CLS: Record<FailureStyle["accent"], string> = {
  mint: "border-mint/40 bg-mint/5 text-mint",
  coral: "border-coral/40 bg-coral/5 text-coral",
  amber: "border-amber/40 bg-amber/5 text-amber",
  violet: "border-violet/40 bg-violet/5 text-violet",
};

function RisksHandled({ recovery }: { recovery: RecoveryRow[] }) {
  const meaningful = (recovery ?? []).filter((r) => !!r.failure_type);

  if (meaningful.length === 0) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 card-hover">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-mint" />
          <div className="text-sm font-medium text-muted-foreground">Risks handled</div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          No incidents yet — everything ran clean.
        </p>
      </div>
    );
  }

  const counts = new Map<string, number>();
  for (const r of meaningful) {
    counts.set(r.failure_type, (counts.get(r.failure_type) ?? 0) + 1);
  }

  const rows = Array.from(counts.entries()).sort(([, a], [, b]) => b - a);

  return (
    <div className="rounded-3xl border border-border bg-card p-6 card-hover">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-mint" />
        <div className="text-sm font-medium text-muted-foreground">Risks handled</div>
        <span className="ml-auto rounded-full bg-mint/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-mint">
          {meaningful.length} event{meaningful.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map(([type, count]) => {
          const style = FAILURE_STYLES[type] ?? {
            Icon: AlertTriangle,
            label: (n: number) =>
              `${n} ${type.replace(/_/g, " ")} event${n === 1 ? "" : "s"} handled`,
            accent: "amber" as const,
          };
          const Icon = style.Icon;
          return (
            <li
              key={type}
              className={`flex items-start gap-3 rounded-2xl border-l-4 border border-border bg-background p-3 ${ACCENT_CLS[style.accent]}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm text-foreground">{style.label(count)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
