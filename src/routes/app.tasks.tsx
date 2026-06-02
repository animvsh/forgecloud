import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Loader2, Play, AlertTriangle, Sparkles, Plus, X } from "lucide-react";
import { useForgeState, useRunTask, useRunAllTasks, useAddTask } from "@/lib/client";
import { useState } from "react";
import { toast } from "sonner";

const AGENT_OPTIONS = [
  "Frontend Agent",
  "Backend Agent",
  "Design Agent",
  "QA Agent",
  "Auth Agent",
  "DevOps Agent",
  "Safety Agent",
  "Recovery Agent",
  "Product Agent",
] as const;

type RiskLevel = "low" | "med" | "high";

export const Route = createFileRoute("/app/tasks")({
  component: TasksScreen,
});

const COLUMNS = [
  { key: "backlog", label: "Backlog", tone: "var(--muted-foreground)", bg: "bg-muted" },
  { key: "building", label: "Building", tone: "var(--sky)", bg: "bg-sky/10" },
  { key: "review", label: "Review", tone: "var(--amber)", bg: "bg-amber/10" },
  { key: "done", label: "Done", tone: "var(--mint)", bg: "bg-mint/10" },
] as const;

function TasksScreen() {
  const { data, isLoading } = useForgeState();
  const runTask = useRunTask();
  const runAll = useRunAllTasks();
  const addTask = useAddTask();
  const [running, setRunning] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newOwnerAgent, setNewOwnerAgent] = useState<string>("Frontend Agent");
  const [newRisk, setNewRisk] = useState<RiskLevel>("low");
  const [submitting, setSubmitting] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        </div>
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

  async function submitNewTask() {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    try {
      await addTask.mutateAsync({
        title,
        description: newDescription.trim() || undefined,
        ownerAgent: newOwnerAgent,
        riskLevel: newRisk,
      });
      toast.success(`Task added: ${title}`);
      setNewTitle("");
      setNewDescription("");
      setNewOwnerAgent("Frontend Agent");
      setNewRisk("low");
      setShowAddForm(false);
    } catch (err) {
      toast.error("Couldn't add task", { description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const hasBacklog = tasks.some((t) => t.status === "backlog");

  return (
    <div>
      <ScreenHeader
        title="Tasks"
        subtitle={`${tasks.length} tasks across ${new Set(tasks.map((t) => t.assigned_agent_id).filter(Boolean)).size} agents`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all " +
                (showAddForm
                  ? "bg-foreground text-background hover:opacity-90"
                  : "border border-border bg-card hover:bg-muted")
              }
            >
              {showAddForm ? <X className="size-3" /> : <Plus className="size-3" />}
              {showAddForm ? "Cancel" : "Add task"}
            </button>
            {hasBacklog && (
              <>
                <button
                  onClick={() => runEverything("build_failed")}
                  disabled={running !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-3 py-1.5 text-xs text-coral hover:bg-coral/20 transition-all disabled:opacity-40"
                >
                  {running === "all" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <AlertTriangle className="size-3" />
                  )}
                  Run all (with failure)
                </button>
                <button
                  onClick={() => runEverything()}
                  disabled={running !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs text-brand-foreground hover:brightness-105 transition-all disabled:opacity-40"
                >
                  {running === "all" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  Run all
                </button>
              </>
            )}
          </div>
        }
      />

      {showAddForm && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5 card-hover">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">New task</h3>
            <span className="text-[11px] text-muted-foreground">
              Goes straight to backlog and is assigned to the chosen agent.
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Add a phone number field to the signup form"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitNewTask();
                  }
                }}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Description <span className="font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                placeholder="Any helpful context for the agent"
                className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Owner agent
              </label>
              <select
                value={newOwnerAgent}
                onChange={(e) => setNewOwnerAgent(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {AGENT_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Risk
              </label>
              <div className="mt-1 inline-flex w-full overflow-hidden rounded-lg border border-border bg-background">
                {(["low", "med", "high"] as const).map((r) => {
                  const active = newRisk === r;
                  const activeCls =
                    r === "low"
                      ? "bg-mint text-white"
                      : r === "med"
                        ? "bg-amber text-white"
                        : "bg-coral text-white";
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewRisk(r)}
                      className={
                        "flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition " +
                        (active ? activeCls : "text-muted-foreground hover:bg-muted")
                      }
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              disabled={submitting}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={submitNewTask}
              disabled={!newTitle.trim() || submitting}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:brightness-105 disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Add to backlog
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {tasks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <p className="text-muted-foreground">
              No tasks yet. The Product Agent will create them when you start a project.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="rounded-2xl border border-border bg-card p-4">
                  <div
                    className={`mb-3 flex items-center justify-between rounded-xl px-3 py-2 ${col.bg}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: col.tone }} />
                      <h3 className="font-semibold text-sm">{col.label}</h3>
                    </div>
                    <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {colTasks.map((t) => {
                      const agent = agents.find((a) => a.id === t.assigned_agent_id);
                      const pr = prs.find((p) => p.id === t.linked_pr_id);
                      return (
                        <div
                          key={t.id}
                          className="rounded-xl border border-border bg-background p-3 text-sm card-hover"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium">{t.title}</div>
                            <RiskBadge level={t.risk_level} />
                          </div>
                          {t.description && (
                            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                              {t.description}
                            </div>
                          )}
                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{agent?.name ?? "Unassigned"}</span>
                            <span>Review: {t.reviewer_name ?? "—"}</span>
                          </div>
                          {t.status === "backlog" && (
                            <button
                              onClick={() => runOne(t.id)}
                              disabled={running !== null}
                              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-all disabled:opacity-40"
                            >
                              {running === t.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Play className="size-3" />
                              )}
                              Build now
                            </button>
                          )}
                          {pr && (
                            <Link
                              to="/app/changes"
                              className="mt-2 inline-flex w-full items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
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
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${colors[level] ?? "bg-muted"}`}
    >
      {level}
    </span>
  );
}
