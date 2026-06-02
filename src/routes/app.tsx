import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useForgeState } from "@/lib/client";
import { AppNav } from "@/components/SiteNav";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { data } = useForgeState();
  const tasks = data?.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pendingApprovals = (data?.approvals ?? []).length;
  const isFallback = data && data.aiAvailable === false;
  const providerName = data?.providerName ?? "AI";

  return (
    <div className="min-h-screen bg-background">
      {isFallback ? (
        <div className="flex items-center justify-center gap-2 border-b border-amber/20 bg-amber/10 px-4 py-1.5 text-xs text-amber">
          <AlertTriangle className="size-3" />
          <span>
            <strong>Demo mode</strong> — no LLM credentials configured. All features work; agents return template output. Set <code className="rounded bg-amber/20 px-1">MINIMAX_API_KEY</code> for live intelligence.
          </span>
        </div>
      ) : data && providerName !== "AI" ? (
        <div className="flex items-center justify-center gap-2 border-b border-mint/20 bg-mint/5 px-4 py-1 text-[10px] uppercase tracking-wider text-mint">
          <span className="size-1.5 rounded-full bg-mint animate-pulse" />
          <span>Intelligence: {providerName}</span>
        </div>
      ) : null}
      <AppNav pendingApprovals={pendingApprovals} />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        {total > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-xs">
            <span className="font-medium">{data?.project?.name ?? "Project"}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/50">
              <div className="h-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
