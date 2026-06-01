import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { MessageSquare, Bot, ListChecks, Eye, GitBranch, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

const nav = [
  { to: "/app/chat", label: "Chat", icon: MessageSquare },
  { to: "/app/agents", label: "Agents", icon: Bot },
  { to: "/app/tasks", label: "Tasks", icon: ListChecks },
  { to: "/app/preview", label: "Preview", icon: Eye },
  { to: "/app/changes", label: "Changes", icon: GitBranch },
  { to: "/app/failures", label: "Failures", icon: ShieldAlert },
] as const;

function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card p-4">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2 py-1 font-semibold">
          <span className="inline-block size-5 rounded-md bg-foreground" />
          ForgeCloud
        </Link>
        <div className="mb-2 px-2 text-xs uppercase tracking-wider text-muted-foreground">Workspace</div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => {
            const active = pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                  active ? "bg-foreground text-background" : "hover:bg-muted text-foreground"
                }`}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-border bg-background p-3">
          <div className="text-xs font-medium">CRM v1 project</div>
          <div className="mt-1 text-xs text-muted-foreground">Building — 72%</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[72%] bg-brand" />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
