import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Users, Bot, Loader2 } from "lucide-react";
import { useForgeState } from "@/lib/client";

export const Route = createFileRoute("/app/team")({
  component: TeamScreen,
});

const AI_ROLES = [
  { name: "Frontend Agent", permissions: "Edit frontend files", approval: "Production deploy" },
  { name: "Backend Agent", permissions: "Build APIs + database", approval: "Database migrations" },
  { name: "Auth Agent", permissions: "Edit auth files", approval: "Auth changes" },
  { name: "DevOps Agent", permissions: "Build preview deploys", approval: "Production deploy" },
  { name: "Safety Agent", permissions: "Block risky actions", approval: "Cannot be overridden except by owner" },
];

const HUMAN_ROLES = [
  { role: "Owner", perms: "Everything" },
  { role: "Admin", perms: "Manage team, approve deploys" },
  { role: "Builder", perms: "Request features, review previews" },
  { role: "Reviewer", perms: "Approve assigned PRs" },
  { role: "Viewer", perms: "View progress only" },
];

function TeamScreen() {
  const { data, isLoading } = useForgeState();

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const humans = data.teamMembers.filter((m) => !m.is_ai);
  const aiMembers = data.agents;

  return (
    <div className="min-h-screen">
      <ScreenHeader title="Team" subtitle="Humans and AI agents, working together." />

      <div className="space-y-8 p-8">
        <section>
          <h2 className="mb-4 text-lg font-semibold">Humans</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {humans.map((m) => {
              const colors = ["var(--violet)", "var(--coral)", "var(--sky)", "var(--mint)", "var(--amber)"];
              const color = colors[m.display_name.charCodeAt(0) % colors.length];
              return (
                <div key={m.id} className="rounded-2xl border border-border bg-card p-5 card-hover">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center squircle text-sm font-semibold text-white" style={{ background: color }}>
                      {m.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold">{m.display_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                    </div>
                    <span className="ml-auto rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{m.role}</span>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Can request features, review changes, approve assigned PRs.
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">AI agents</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aiMembers.map((a) => {
              const def = AI_ROLES.find((r) => r.name === a.name);
              const colors: Record<string, string> = {
                product: "var(--violet)", design: "var(--coral)", frontend: "var(--sky)",
                backend: "var(--mint)", auth: "var(--amber)", qa: "var(--sky)",
                devops: "var(--mint)", safety: "var(--amber)", recovery: "var(--violet)",
              };
              const color = colors[a.type] ?? "var(--violet)";
              return (
                <Link
                  key={a.id}
                  to="/app/agents/$agentId"
                  params={{ agentId: a.id }}
                  className="block rounded-2xl border border-border bg-card p-5 card-hover hover:border-brand/40 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center squircle" style={{ background: color }}>
                      <Bot className="size-5 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.type}</div>
                    </div>
                    <span className="ml-auto rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet">AI</span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs">
                    <div className="text-muted-foreground">
                      <span className="text-foreground">{def?.permissions ?? a.role}</span>
                    </div>
                    {def?.approval && (
                      <div className="text-amber">
                        Needs approval: {def.approval}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Permission model</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">Human roles</div>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {HUMAN_ROLES.map((r) => (
                    <tr key={r.role} className="border-t border-border">
                      <td className="py-2 font-medium">{r.role}</td>
                      <td className="py-2 text-muted-foreground">{r.perms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">Simple, legible permissions</div>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-mint" /> Can request features</li>
                <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-mint" /> Can approve changes</li>
                <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-mint" /> Can deploy</li>
                <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-mint" /> Can edit data</li>
                <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-mint" /> Can manage agents</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
