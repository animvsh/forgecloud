import { createFileRoute, Link } from "@tanstack/react-router";
import { useForgeState, useRunAllTasks, useInjectFailure, useDeployProduction, useResetProject, useRunFullDemo } from "@/lib/client";
import { Sparkles, GitBranch, ShieldCheck, Rocket, AlertTriangle, ArrowRight, Loader2, RotateCcw, MessageSquare, Play, CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MiniDiagram } from "@/components/MiniDiagram";

export const Route = createFileRoute("/app/")({
  component: ProjectHome,
});

const DEMO_STEPS = [
  { key: "init", label: "Initializing Pielot Waitlist" },
  { key: "run-agents", label: "Running all 9 agents on backlog" },
  { key: "model-timeout", label: "Triggering model timeout" },
  { key: "build-failure", label: "Triggering build failure" },
  { key: "secret-detected", label: "Detecting hardcoded secret" },
  { key: "deploy-preview", label: "Deploying preview" },
  { key: "deploy-prod", label: "Attempting production deploy" },
  { key: "recover", label: "Recovering from failure" },
] as const;

function ProjectHome() {
  const { data, isLoading } = useForgeState();
  const runAll = useRunAllTasks();
  const inject = useInjectFailure();
  const deploy = useDeployProduction();
  const reset = useResetProject();
  const runFullDemoMutation = useRunFullDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [demoSteps, setDemoSteps] = useState<string[]>([]);
  const [demoComplete, setDemoComplete] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading your project...</p>
        </div>
      </div>
    );
  }

  const tasks = data.tasks;
  const done = tasks.filter((t) => t.status === "done").length;
  const building = tasks.filter((t) => t.status === "building").length;
  const review = tasks.filter((t) => t.status === "review").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const agents = data.agents;
  const prs = data.prs;
  const recovery = data.recovery;
  const deployments = data.deployments;
  const livePreview = deployments.find((d) => d.environment === "preview" && d.status === "live");

  async function runFullDemo() {
    setBusy("full-demo");
    setDemoSteps([]);
    setDemoComplete(false);
    try {
      const stepOrder = ["init", "run-agents", "model-timeout", "build-failure", "secret-detected", "deploy-preview", "deploy-prod", "recover"];
      for (const step of stepOrder) {
        setDemoSteps((s) => [...s, step]);
        await new Promise((r) => setTimeout(r, 600));
      }
      await runFullDemoMutation.mutateAsync();
      setDemoComplete(true);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function runAllAgents() {
    setBusy("run");
    try { await runAll.mutateAsync({}); } finally { setBusy(null); }
  }

  async function runAllWithFailure() {
    setBusy("run-fail");
    try {
      const failureAt = Math.max(0, Math.floor(tasks.filter((t) => t.status === "backlog").length / 2));
      await runAll.mutateAsync({ failureAt, failureType: "build_failed" });
    } finally { setBusy(null); }
  }

  async function triggerFailure(type: string) {
    setBusy(`fail-${type}`);
    try { await inject.mutateAsync({ type }); } finally { setBusy(null); }
  }

  async function deployProd(fail = false) {
    setBusy(fail ? "deploy-fail" : "deploy");
    try { await deploy.mutateAsync({ fail }); } finally { setBusy(null); }
  }

  async function doReset() {
    if (!confirm("Reset the demo? This wipes all data and re-seeds.")) return;
    await reset.mutateAsync();
  }

  const hasWork = total > 0;
  const showDemoOverlay = busy === "full-demo" || demoComplete;

  return (
    <div className="space-y-6">
      <ScreenHeader
        title={data.project.name}
        subtitle={data.project.description ?? "Your team's AI software team is on the case."}
        action={
          hasWork && (
            <div className="flex items-center gap-2">
              <button
                onClick={doReset}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="mr-1 inline size-3" /> Reset
              </button>
              <Link
                to="/app/chat"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              >
                <MessageSquare className="size-3" /> Open chat
              </Link>
            </div>
          )
        }
      />

      {!hasWork && (
        <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center card-hover">
          <div className="mx-auto flex size-14 items-center justify-center squircle" style={{ background: "var(--violet)" }}>
            <Sparkles className="size-7 text-white" />
          </div>
          <h2 className="mt-4 text-2xl font-bold">No project yet</h2>
          <p className="mt-2 text-muted-foreground">
            Start by telling ForgeCloud what you want to build.
          </p>
          <Link
            to="/app/intake"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground shadow-lg shadow-brand/30 hover:brightness-105 transition-all"
          >
            Start building <ArrowRight className="size-4" />
          </Link>
          <p className="mt-6 text-xs text-muted-foreground">
            Or open the chat and type any product idea.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link to="/app/chat" className="rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-muted transition-colors">
              Open chat
            </Link>
          </div>
        </div>
      )}

      {hasWork && (
        <>
          {/* Mini diagram hero */}
          <div className="rounded-3xl border border-border bg-card p-6 overflow-hidden">
            <MiniDiagram
              projectName={data.project.name}
              agentCount={agents.length}
              taskCount={total}
              doneCount={done}
              prCount={prs.length}
              recoveryCount={recovery.length}
            />
            <div className="mt-2 text-center">
              <p className="text-lg font-semibold">{data.project.name}</p>
              <p className="text-sm text-muted-foreground">
                {done} of {total} features built &middot; {agents.length} agents working
              </p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tasks" value={`${done}/${total}`} sub={`${building} building · ${review} in review`} accent="var(--violet)" />
            <Stat label="Pull requests" value={prs.length} sub={`${prs.filter((p) => p.status === "open").length} open · ${prs.filter((p) => p.status === "approved").length} approved`} accent="var(--sky)" />
            <Stat label="Agents active" value={agents.filter((a) => a.status !== "idle").length} sub={`${agents.length} total`} accent="var(--mint)" />
            <Stat label="Recoveries" value={recovery.length} sub={recovery.length > 0 ? "Last: " + new Date(recovery[0].created_at).toLocaleTimeString() : "All systems healthy"} accent="var(--coral)" />
          </div>

          {/* Full demo section */}
          <div className="rounded-3xl border-2 border-brand/30 gradient-header p-6 card-hover">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center squircle" style={{ background: "var(--violet)" }}>
                    <Sparkles className="size-4 text-white" />
                  </div>
                  <h2 className="text-xl font-bold">Run the full demo</h2>
                </div>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Watch the AI team work end-to-end. Spins up agents, runs into 3 real-world failures, deploys a preview, and recovers from a failed production deploy. Takes about 5-10 seconds.
                </p>
              </div>
              <button
                onClick={runFullDemo}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground shadow-lg shadow-brand/30 hover:brightness-105 hover:scale-105 transition-all disabled:opacity-40 disabled:hover:scale-100"
              >
                {busy === "full-demo" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                Run full demo
              </button>
            </div>

            {showDemoOverlay && (
              <div className="mt-6 rounded-2xl border border-border bg-background p-4 animate-in fade-in slide-in-from-top-2">
                <div className="space-y-2">
                  {DEMO_STEPS.map((s) => {
                    const isActive = demoSteps[demoSteps.length - 1] === s.key && busy === "full-demo";
                    const isComplete = demoSteps.indexOf(s.key) < demoSteps.length - 1 || (demoComplete && demoSteps.includes(s.key));
                    const isPending = !demoSteps.includes(s.key);
                    return (
                      <div key={s.key} className="flex items-center gap-3 text-sm transition-all">
                        {isComplete ? <CheckCircle2 className="size-4 text-mint" /> :
                         isActive ? <Loader2 className="size-4 animate-spin text-brand" /> :
                         <Circle className="size-4 text-muted-foreground/30" />}
                        <span className={isComplete ? "text-foreground" : isActive ? "text-foreground font-medium" : "text-muted-foreground"}>
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {demoComplete && (
                  <div className="mt-4 rounded-xl bg-mint/10 px-4 py-2 text-sm text-mint animate-in fade-in">
                    Full demo complete. Check the Failures, Deployments, and PRs screens.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Build progress + Failure injection */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Build progress</div>
                  <div className="mt-1 text-3xl font-bold gradient-text">{pct}%</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{done} of {total} tasks done</div>
                </div>
              </div>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-gradient-to-r from-brand to-violet transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              {livePreview && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-background p-3 text-sm">
                  <Rocket className="size-4 text-brand" />
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground">Live preview</div>
                    <div className="font-mono text-xs">{livePreview.cloudflare_url || livePreview.railway_url}</div>
                  </div>
                  <Link to="/app/preview" className="text-xs text-brand hover:underline transition-colors">Open</Link>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={runAllAgents}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {busy === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Run all agents
                </button>
                <button
                  onClick={runAllWithFailure}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-4 py-2 text-sm font-medium text-coral hover:bg-coral/20 transition-all disabled:opacity-40"
                >
                  {busy === "run-fail" ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
                  Run with a build failure
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">Failure injection</div>
              <p className="mt-1 text-xs text-muted-foreground">Simulate things breaking. ForgeCloud recovers.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <FailButton onClick={() => triggerFailure("model_timeout")} busy={busy === "fail-model_timeout"} label="Model timeout" />
                <FailButton onClick={() => triggerFailure("build_failed")} busy={busy === "fail-build_failed"} label="Build failed" />
                <FailButton onClick={() => triggerFailure("secret_detected")} busy={busy === "fail-secret_detected"} label="Secret in code" />
                <FailButton onClick={() => triggerFailure("unsafe_db_migration")} busy={busy === "fail-unsafe_db_migration"} label="Unsafe DB change" />
                <FailButton onClick={() => triggerFailure("bad_output")} busy={busy === "fail-bad_output"} label="Bad agent output" />
                <FailButton onClick={() => triggerFailure("agent_conflict")} busy={busy === "fail-agent_conflict"} label="Agent conflict" />
              </div>
            </div>
          </div>

          {/* Deployment + Activity feed */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Deployment</div>
                  <div className="mt-1 text-xl font-semibold">Railway + Cloudflare</div>
                </div>
                <div className="flex size-10 items-center justify-center squircle" style={{ background: "var(--violet)" }}>
                  <Rocket className="size-5 text-white" />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Production deploy requires build + QA + approval checks.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => deployProd(false)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {busy === "deploy" ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                  Deploy to production
                </button>
                <button
                  onClick={() => deployProd(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-4 py-2 text-sm font-medium text-coral hover:bg-coral/20 transition-all disabled:opacity-40"
                >
                  {busy === "deploy-fail" ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
                  Simulate deploy failure
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Recent activity</div>
                  <div className="mt-1 text-xl font-semibold">Live feed</div>
                </div>
                <div className="flex size-10 items-center justify-center squircle" style={{ background: "var(--sky)" }}>
                  <GitBranch className="size-5 text-foreground" />
                </div>
              </div>
              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                {prs.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-start gap-2 text-xs">
                    <span className="rounded-full bg-foreground px-2 py-0.5 font-mono text-background">PR #{p.number}</span>
                    <span className="flex-1 line-clamp-1">{p.title}</span>
                    <RiskBadge level={p.risk_level} />
                  </div>
                ))}
                {recovery.slice(0, 3).map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3 text-coral" />
                    <span className="flex-1 line-clamp-1">{r.recovery_action}</span>
                  </div>
                ))}
                {prs.length === 0 && recovery.length === 0 && (
                  <div className="text-xs text-muted-foreground">Nothing yet. Click "Run full demo" to start.</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5 card-hover">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {accent && <div className="size-2 rounded-full" style={{ background: accent }} />}
      </div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function FailButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted hover:border-coral/30 transition-all disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <AlertTriangle className="size-3 text-amber" />}
      {label}
    </button>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    low: "bg-mint/20 text-mint",
    med: "bg-amber/20 text-amber",
    high: "bg-coral/20 text-coral",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[level] ?? "bg-muted"}`}>
      {level}
    </span>
  );
}
