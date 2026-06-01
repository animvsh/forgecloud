import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Check, Sparkles, Rocket, Loader2 } from "lucide-react";
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
      <ScreenHeader title="Final report" subtitle="What your AI team built, broke, and recovered." />

      <div className="mt-6 space-y-6">
        {done.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Sparkles className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-muted-foreground">No report yet. Build some features first.</p>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-3xl border-2 border-brand/30 gradient-header p-8 card-hover">
              <div className="absolute -right-8 -top-8 size-32 squircle opacity-20" style={{ background: "var(--violet)" }} />
              <div className="absolute -right-4 -bottom-12 size-24 squircle opacity-10" style={{ background: "var(--coral)" }} />
              <div className="relative">
                <div className="flex items-center gap-2 text-brand">
                  <div className="flex size-8 items-center justify-center squircle" style={{ background: "var(--violet)" }}>
                    <Check className="size-4 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold gradient-text">{data.project.name} v1 is ready.</h2>
                </div>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                  Built by {agents.length} agents in collaboration with {data.teamMembers.filter((m) => !m.is_ai).length} humans.
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
                <div className="mt-2 text-3xl font-bold text-mint">{recovery.filter((r) => r.status === "recovered").length}</div>
                <div className="text-xs text-muted-foreground">
                  {recovery.filter((r) => r.status === "blocked").length} blocked
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-card p-6 card-hover">
                <div className="text-sm font-medium text-muted-foreground">Deployments</div>
                <div className="mt-2 text-3xl font-bold">{deployments.length}</div>
                <div className="text-xs text-muted-foreground">
                  {deployments.filter((d) => d.status === "live").length} live · {deployments.filter((d) => d.status === "failed").length} failed
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">What's next</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/app/deployments" className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 transition-all">
                  <Rocket className="size-3.5" /> View deployments
                </Link>
                <Link to="/app/failures" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-muted transition-colors">
                  See all recoveries
                </Link>
                <Link to="/app/chat" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm hover:bg-muted transition-colors">
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
