import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  Filter,
  GitPullRequest,
  LayoutList,
  Loader2,
  Play,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useForgeState, useRunTask, useRunAllTasks, useAddTask, useRunMyTasks } from "@/lib/client";
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
type TaskView = "board" | "list";
type FilterValue = "all" | string;
type AgentRow = { id: string; name: string };
type TaskRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  risk_level: string;
  requester_name?: string | null;
  assigned_agent_id?: string | null;
  reviewer_name?: string | null;
  linked_pr_id?: string | null;
  preview_url?: string | null;
  created_at?: number;
};
type PullRequestRow = {
  id: string;
  task_id?: string | null;
  number: number;
  title: string;
  status: string;
  preview_url?: string | null;
};
type ApprovalRow = { id: string; pr_id?: string | null; reason: string; risk_level: string };
type DeploymentRow = {
  pr_id?: string | null;
  environment: string;
  status: string;
  created_at: number;
};

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
  const runMine = useRunMyTasks();
  const addTask = useAddTask();
  const [running, setRunning] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newOwnerAgent, setNewOwnerAgent] = useState<string>("Frontend Agent");
  const [newRisk, setNewRisk] = useState<RiskLevel>("low");
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<TaskView>("board");
  const [statusFilter, setStatusFilter] = useState<FilterValue>("all");
  const [agentFilter, setAgentFilter] = useState<FilterValue>("all");
  const [reviewerFilter, setReviewerFilter] = useState<FilterValue>("all");
  const [riskFilter, setRiskFilter] = useState<FilterValue>("all");
  const [linkFilter, setLinkFilter] = useState<FilterValue>("all");

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

  const tasks = data.tasks as TaskRow[];
  const agents = data.agents as AgentRow[];
  const prs = data.prs as PullRequestRow[];
  const approvals = (data.approvals ?? []) as ApprovalRow[];
  const deployments = (data.deployments ?? []) as DeploymentRow[];
  const agentsById = new Map<string, AgentRow>(agents.map((agent) => [agent.id, agent]));
  const prsById = new Map<string, PullRequestRow>(prs.map((pr) => [pr.id, pr]));
  const prsByTaskId = new Map<string, PullRequestRow>(
    prs.filter((pr) => Boolean(pr.task_id)).map((pr) => [pr.task_id as string, pr]),
  );
  const approvalsByPrId = new Map<string, ApprovalRow>(
    approvals
      .filter((approval: { pr_id?: string | null }) => Boolean(approval.pr_id))
      .map((approval: { pr_id: string }) => [approval.pr_id, approval]),
  );
  const latestDeploymentByPrId = new Map<string, DeploymentRow>();
  for (const deployment of deployments) {
    if (!deployment.pr_id) continue;
    const previous = latestDeploymentByPrId.get(deployment.pr_id) as
      | ({ created_at?: number } & { environment: string; status: string })
      | undefined;
    if (!previous || deployment.created_at > (previous.created_at ?? 0)) {
      latestDeploymentByPrId.set(deployment.pr_id, deployment);
    }
  }
  const linkedPrForTask = (task: TaskRow) =>
    task.linked_pr_id ? prsById.get(task.linked_pr_id) : prsByTaskId.get(task.id);

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

  async function runMineAndAutoApprove() {
    if (running !== null) return;
    setRunning("mine");
    try {
      const me = data?.user?.name ?? "Sal";
      const result = await runMine.mutateAsync({
        reviewerName: me,
        includeReviewQueue: true,
      });
      toast.success(
        `Ran ${result.count} task(s) as ${result.reviewerName} — open PRs auto-approved.`,
      );
    } catch (err) {
      toast.error("Couldn't run my tasks", { description: (err as Error).message });
    } finally {
      setRunning(null);
    }
  }

  const myBacklogCount = tasks.filter(
    (t) =>
      t.status === "backlog" &&
      (t.reviewer_name === (data?.user?.name ?? "Sal") || !t.reviewer_name),
  ).length;

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
  const reviewerOptions = Array.from(
    new Set(tasks.map((task) => task.reviewer_name).filter(Boolean)),
  ) as string[];
  const filteredTasks = tasks.filter((task) => {
    const agent = agentsById.get(task.assigned_agent_id) as { name?: string } | undefined;
    const linkedPr = linkedPrForTask(task);
    const pendingApproval = linkedPr ? approvalsByPrId.get(linkedPr.id) : null;
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (agentFilter !== "all" && agent?.name !== agentFilter) return false;
    if (reviewerFilter !== "all" && task.reviewer_name !== reviewerFilter) return false;
    if (riskFilter !== "all" && task.risk_level !== riskFilter) return false;
    if (linkFilter === "with_pr" && !linkedPr) return false;
    if (linkFilter === "approval_needed" && !pendingApproval) return false;
    if (linkFilter === "with_preview" && !task.preview_url && !linkedPr?.preview_url) return false;
    return true;
  });
  const activeFilterCount = [
    statusFilter,
    agentFilter,
    reviewerFilter,
    riskFilter,
    linkFilter,
  ].filter((value) => value !== "all").length;

  function clearFilters() {
    setStatusFilter("all");
    setAgentFilter("all");
    setReviewerFilter("all");
    setRiskFilter("all");
    setLinkFilter("all");
  }

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
                  onClick={runMineAndAutoApprove}
                  disabled={running !== null}
                  title={`Run every task assigned to ${data?.user?.display_name ?? "me"} and auto-approve low-risk PRs`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 transition-all disabled:opacity-40"
                >
                  {running === "mine" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  Do my tasks ({myBacklogCount})
                </button>
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

      {tasks.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter className="size-4 text-brand" />
              Work filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] uppercase text-brand">
                  {activeFilterCount} active
                </span>
              )}
            </div>
            <div className="inline-flex overflow-hidden rounded-full border border-border bg-background">
              <button
                onClick={() => setView("board")}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition " +
                  (view === "board" ? "bg-foreground text-background" : "hover:bg-muted")
                }
              >
                <Columns3 className="size-3" />
                Board
              </button>
              <button
                onClick={() => setView("list")}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition " +
                  (view === "list" ? "bg-foreground text-background" : "hover:bg-muted")
                }
              >
                <LayoutList className="size-3" />
                List
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
              <option value="all">All statuses</option>
              {COLUMNS.map((col) => (
                <option key={col.key} value={col.key}>
                  {col.label}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Agent" value={agentFilter} onChange={setAgentFilter}>
              <option value="all">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.name}>
                  {agent.name}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Reviewer" value={reviewerFilter} onChange={setReviewerFilter}>
              <option value="all">All reviewers</option>
              {reviewerOptions.map((reviewer) => (
                <option key={reviewer} value={reviewer}>
                  {reviewer}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Risk" value={riskFilter} onChange={setRiskFilter}>
              <option value="all">All risks</option>
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </FilterSelect>
            <FilterSelect label="Links" value={linkFilter} onChange={setLinkFilter}>
              <option value="all">All tasks</option>
              <option value="with_pr">PR linked</option>
              <option value="with_preview">Preview linked</option>
              <option value="approval_needed">Approval needed</option>
            </FilterSelect>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Showing {filteredTasks.length} of {tasks.length} task
              {tasks.length === 1 ? "" : "s"}
            </span>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="rounded-full border border-border px-3 py-1.5 hover:bg-muted"
              >
                Clear filters
              </button>
            )}
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
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <p className="text-muted-foreground">
              No tasks match these filters. Clear filters to see the full board.
            </p>
          </div>
        ) : view === "list" ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="hidden border-b border-border bg-muted/40 px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground lg:grid lg:grid-cols-12">
              <div className="col-span-4">Task</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Agent</div>
              <div className="col-span-2">Reviewer</div>
              <div className="col-span-2 text-right">Linked work</div>
            </div>
            <div className="divide-y divide-border">
              {filteredTasks.map((task) => {
                const agent = task.assigned_agent_id
                  ? agentsById.get(task.assigned_agent_id)
                  : undefined;
                const pr = linkedPrForTask(task);
                const pendingApproval = pr ? approvalsByPrId.get(pr.id) : undefined;
                const deployment = pr ? latestDeploymentByPrId.get(pr.id) : undefined;
                return (
                  <div
                    key={task.id}
                    className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-12 lg:items-center"
                  >
                    <div className="lg:col-span-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{task.title}</div>
                        <RiskBadge level={task.risk_level} />
                      </div>
                      {task.description && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <div className="lg:col-span-2">
                      <StatusPill status={task.status} />
                    </div>
                    <div className="text-muted-foreground lg:col-span-2">
                      {agent?.name ?? "Unassigned"}
                    </div>
                    <div className="text-muted-foreground lg:col-span-2">
                      {task.reviewer_name ?? "Unassigned"}
                    </div>
                    <div className="flex flex-wrap justify-start gap-2 lg:col-span-2 lg:justify-end">
                      {pr ? (
                        <Link
                          to="/app/changes"
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] hover:bg-muted"
                        >
                          <GitPullRequest className="size-3" />
                          PR #{pr.number}
                        </Link>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                          No PR
                        </span>
                      )}
                      {pendingApproval && (
                        <Link
                          to="/app/changes"
                          className="rounded-full border border-amber/40 bg-amber/10 px-2 py-1 text-[11px] text-amber hover:bg-amber/20"
                        >
                          Approval
                        </Link>
                      )}
                      {deployment && (
                        <Link
                          to="/app/deployments"
                          className="rounded-full border border-border px-2 py-1 text-[11px] hover:bg-muted"
                        >
                          {deployment.environment}: {deployment.status}
                        </Link>
                      )}
                      {(task.preview_url || pr?.preview_url) && (
                        <Link
                          to="/app/preview"
                          className="rounded-full border border-border px-2 py-1 text-[11px] hover:bg-muted"
                        >
                          Preview
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            {COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.status === col.key);
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
                      const agent = t.assigned_agent_id
                        ? agentsById.get(t.assigned_agent_id)
                        : undefined;
                      const pr = linkedPrForTask(t);
                      const pendingApproval = pr ? approvalsByPrId.get(pr.id) : undefined;
                      const deployment = pr ? latestDeploymentByPrId.get(pr.id) : undefined;
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
                              <span className="text-muted-foreground">view</span>
                            </Link>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                            {pendingApproval && (
                              <span className="rounded-full bg-amber/10 px-2 py-0.5 font-semibold text-amber">
                                Approval needed
                              </span>
                            )}
                            {(t.preview_url || pr?.preview_url) && (
                              <Link
                                to="/app/preview"
                                className="rounded-full border border-border px-2 py-0.5 hover:bg-muted"
                              >
                                Preview
                              </Link>
                            )}
                            {deployment && (
                              <Link
                                to="/app/deployments"
                                className="rounded-full border border-border px-2 py-0.5 hover:bg-muted"
                              >
                                {deployment.environment}: {deployment.status}
                              </Link>
                            )}
                          </div>
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

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    backlog: "Backlog",
    building: "Building",
    review: "Review",
    done: "Done",
  };
  const colors: Record<string, string> = {
    backlog: "bg-muted text-muted-foreground",
    building: "bg-sky/20 text-sky",
    review: "bg-amber/20 text-amber",
    done: "bg-mint/20 text-mint",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${colors[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status === "done" && <CheckCircle2 className="size-3" />}
      {labels[status] ?? status}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      >
        {children}
      </select>
    </label>
  );
}
