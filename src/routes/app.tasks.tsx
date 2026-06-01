import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Loader2, Play, AlertTriangle, Sparkles } from "lucide-react";
import { useForgeState, useRunTask, useRunAllTasks } from "@/lib/client";
import { useState } from "react";

export const Route = createFileRoute("/app/tasks")({
  component: TasksScreen,
});

const COLUMNS = [
  { key: "backlog", label: "Backlog", tone: "var(--muted)" },
  { key: "building", label: "Building", tone: "var(--sky)" },
  { key: "review", label: "Review", tone: "var(--amber)" },
  { key: "done", label: "Done", tone: "var(--mint)" },
] as const;

function TasksScreen() {
  const { data, isLoading } = useForgeState();
  const runTask = useRunTask();
  const runAll = useRunAllTasks();
  const [running, setRunning] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tasks = data.tasks;
  const agents = data.agents;
  const prs = data.prs;

  async function runOne(taskId: string, failureType?: string) {
    setRunning(taskId);
    try {
      await runTask.mutateAsync({ taskId, failureType });
    } finally {
      setRunning(null);
    }
  }

  async function runEverything(failureType?: string) {
    setRunning("all");
    try {
      await runAll.mutateAsync(failureType ? { failureType } : {});
    } finally {
      setRunning(null);
    }
  }

  const hasBacklog = tasks.some((t) => t.status === "backlog");

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Tasks"
        subtitle={`${tasks.length} tasks across ${new Set(tasks.map((t) => t.assigned_agent_id).filter(Boolean)).size} agents`}
        action={
          hasBacklog && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => runEverything("build_failed")}
                disabled={running !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-3 py-1.5 text-xs text-coral hover:bg-coral/20 disabled:opacity-40"
              >
                {running === "all" ? <Loader2 className="size-3 animate-spin" /> : <AlertTriangle className="size-3" />}
                Run all (with failure)
              </button>
              <button
                onClick={() => runEverything()}
                disabled={running !== null}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs text-brand-foreground hover:brightness-105 disabled:opacity-40"
              >
                {running === "all" ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                Run all
              </button>
            </div>
          )
        }
      />

      <div className="p-8">
        {tasks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <p className="text-muted-foreground">No tasks yet. The Product Agent will create them when you start a project.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="rounded-2xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: col.tone }} />
                      <h3 className="font-semibold">{col.label}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground">{colTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colTasks.map((t) => {
                      const agent = agents.find((a) => a.id === t.assigned_agent_id);
                      const pr = prs.find((p) => p.id === t.linked_pr_id);
                      return (
                        <div key={t.id} className="rounded-xl border border-border bg-background p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium">{t.title}</div>
                            <RiskBadge level={t.risk_level} />
                          </div>
                          {t.description && (
                            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</div>
                          )}
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{agent?.name ?? "Unassigned"}</span>
                            <span>Review: {t.reviewer_name ?? "—"}</span>
                          </div>
                          {t.status === "backlog" && (
                            <button
                              onClick={() => runOne(t.id)}
                              disabled={running !== null}
                              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
                            >
                              {running === t.id ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                              Build now
                            </button>
                          )}
                          {pr && (
                            <Link
                              to="/app/changes"
                              className="mt-2 inline-flex w-full items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                            >
                              <span>PR #{pr.number}</span>
                              <span className="text-muted-foreground">view →</span>
                            </Link>
                          )}
                        </div>
                      );
                    })}
                    {colTasks.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        Nothing here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    low: "bg-mint/20 text-mint",
    med: "bg-amber/20 text-amber",
    high: "bg-coral/20 text-coral",
  };
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${colors[level] ?? "bg-muted"}`}>
      {level}
    </span>
  );
}
