import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ShieldCheck, Loader2, AlertTriangle, RefreshCcw, Undo2, KeyRound, Database, Wifi, AlertOctagon, Sparkles } from "lucide-react";
import { useForgeState, useInjectFailure } from "@/lib/client";
import { useState } from "react";

export const Route = createFileRoute("/app/failures")({
  component: FailuresScreen,
});

const ICONS: Record<string, typeof AlertTriangle> = {
  model_timeout: RefreshCcw,
  build_failed: Undo2,
  secret_detected: KeyRound,
  unsafe_db_migration: Database,
  deploy_failed: Wifi,
  bad_output: AlertOctagon,
  rate_limit: RefreshCcw,
  agent_conflict: Undo2,
  manual_rollback: Undo2,
};

const COLORS: Record<string, string> = {
  model_timeout: "var(--amber)",
  build_failed: "var(--coral)",
  secret_detected: "var(--coral)",
  unsafe_db_migration: "var(--amber)",
  deploy_failed: "var(--amber)",
  bad_output: "var(--amber)",
  rate_limit: "var(--amber)",
  agent_conflict: "var(--coral)",
  manual_rollback: "var(--coral)",
};

function FailuresScreen() {
  const { data, isLoading } = useForgeState();
  const inject = useInjectFailure();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const events = data.recovery;
  const blocked = events.filter((e) => e.status === "blocked");
  const recovered = events.filter((e) => e.status === "recovered");
  const pending = data.approvals;

  async function injectFailure(type: string) {
    setBusy(type);
    try {
      await inject.mutateAsync({ type });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Failure recovery"
        subtitle="What broke, and how ForgeCloud kept your project safe."
        action={
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <ShieldCheck className="size-4 text-brand" />
            {recovered.length > 0 || blocked.length > 0 ? `${recovered.length} recovered · ${blocked.length} blocked` : "All systems healthy"}
          </div>
        }
      />

      <div className="space-y-6 p-8">
        <div className="rounded-3xl border-2 border-coral/30 bg-coral/5 p-6">
          <div className="flex items-center gap-2 text-coral">
            <AlertTriangle className="size-4" />
            <h3 className="font-semibold">Try a failure</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the exact failure types the TrueFoundry stack protects against. Click one — ForgeCloud will detect, recover, and log it here.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {[
              { type: "model_timeout", label: "LLM provider timeout" },
              { type: "build_failed", label: "Build failure" },
              { type: "secret_detected", label: "Secret in code" },
              { type: "unsafe_db_migration", label: "Unsafe DB migration" },
              { type: "deploy_failed", label: "Deploy failure" },
              { type: "bad_output", label: "Bad agent output" },
              { type: "rate_limit", label: "Rate limit" },
              { type: "agent_conflict", label: "Two agents conflict" },
            ].map((f) => (
              <button
                key={f.type}
                onClick={() => injectFailure({ type: f.type })}
                disabled={busy !== null}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
              >
                {busy === f.type ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : <AlertTriangle className="mr-1 inline size-3 text-amber" />}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {pending.length > 0 && (
          <div className="rounded-3xl border-2 border-amber bg-amber/5 p-6">
            <div className="flex items-center gap-2 text-amber">
              <Database className="size-4" />
              <h3 className="font-semibold">Pending human approvals</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Some failures require your decision before agents can continue.
            </p>
            <div className="mt-3 space-y-2">
              {pending.map((a) => (
                <div key={a.id} className="rounded-xl border border-amber/40 bg-background p-3 text-sm">
                  <div className="font-medium">{a.reason}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{a.details}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-wider text-amber">In approval queue → /app/changes</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-3 text-lg font-semibold">Recovery timeline</h3>
          {events.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
              <Sparkles className="mx-auto size-8 text-mint" />
              <p className="mt-3 font-semibold">No failures yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Click a button above to simulate a failure. The AI team will detect it, recover, and log it here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {events.map((e) => {
                const Icon = ICONS[e.failure_type] ?? AlertTriangle;
                const color = COLORS[e.failure_type] ?? "var(--amber)";
                return (
                  <div key={e.id} className="rounded-2xl border border-border bg-card p-5 card-hover">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-10 items-center justify-center squircle"
                        style={{ background: color }}
                      >
                        <Icon className="size-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold capitalize">{e.failure_type.replace(/_/g, " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          e.status === "blocked" ? "bg-coral/20 text-coral" : "bg-mint/20 text-mint"
                        }`}
                      >
                        {e.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{e.failure_message}</p>
                    <div className="mt-3 rounded-xl border border-mint/30 bg-mint/5 p-3 text-sm">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-mint">Recovery</div>
                      <p className="mt-1 text-foreground">{e.recovery_action}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
