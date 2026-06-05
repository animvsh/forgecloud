import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  ArrowUp,
  Sparkles,
  AlertTriangle,
  Loader2,
  Bot,
  CheckCircle2,
  Clock3,
  GitPullRequest,
  Rocket,
  ShieldCheck,
  WandSparkles,
  Zap,
  Pencil,
  ExternalLink,
  ChevronDown,
  GitMerge,
} from "lucide-react";
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useApprovePlan, useForgeState, useSendChat } from "@/lib/client";

export const Route = createFileRoute("/app/chat")({
  component: ChatScreen,
});

const DEMO_PROMPTS = [
  "Build a POS system for my pizza shop",
  "Build a simple CRM for my sales team",
  "Build a waitlist app for my new product",
];

const FOLLOW_UP_PROMPTS = [
  "What is blocked right now?",
  "Ship the safest next change",
  "Summarize what changed since the last preview",
  "Prepare this for production review",
];

function ChatScreen() {
  const { data, isLoading } = useForgeState();
  const send = useSendChat();
  const approvePlan = useApprovePlan();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [addingFeatureFor, setAddingFeatureFor] = useState<string | null>(null);
  const [extraFeature, setExtraFeature] = useState("");
  const [editingPlanFor, setEditingPlanFor] = useState<string | null>(null);
  const [planEditNote, setPlanEditNote] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const [openStudioAgent, setOpenStudioAgent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.chatMessages?.length]);

  const hasProject = (data?.tasks?.length ?? 0) > 0;
  const projectId = data?.project?.id;
  const tasks = data?.tasks ?? [];
  const prs = data?.prs ?? [];
  const rawAgents = (data?.agents ?? []).filter(
    (agent: { project_id?: string | null }) => !projectId || agent.project_id === projectId,
  );
  const assignedTaskAgentIds = new Set(
    tasks
      .map((task: { assigned_agent_id?: string | null }) => task.assigned_agent_id)
      .filter(Boolean),
  );
  const agents = Array.from(
    rawAgents
      .reduce((map, agent: { id: string; name: string; type?: string | null }) => {
        const key = agent.type ?? agent.name;
        const existing = map.get(key);
        if (!existing || assignedTaskAgentIds.has(agent.id)) {
          map.set(key, agent);
        }
        return map;
      }, new Map<string, { id: string; name: string; type?: string | null; status: string; last_action?: string | null }>())
      .values(),
  );
  const approvals = data?.approvals ?? [];
  const deployments = data?.deployments ?? [];
  const recovery = data?.recovery ?? [];
  const doneTasks = tasks.filter((task: { status: string }) => task.status === "done").length;
  const reviewTasks = tasks.filter((task: { status: string }) => task.status === "review").length;
  const buildingTasks = tasks.filter(
    (task: { status: string }) => task.status === "building",
  ).length;
  const openPrs = prs.filter((pr: { status: string }) =>
    ["open", "approved", "changes_requested"].includes(pr.status),
  ).length;
  const activeAgents = agents.filter((agent: { status: string }) => agent.status !== "idle");
  const latestDeployment = deployments[0];
  const branches = data?.branches ?? [];
  const rocketRideRuns = data?.rocketRide?.runs ?? [];
  const suggestedPrompts = hasProject ? FOLLOW_UP_PROMPTS : DEMO_PROMPTS;

  async function handleSend(text: string) {
    if (!text.trim() || send.isPending) return;
    setInput("");
    try {
      await send.mutateAsync({ message: text });
    } catch (err) {
      toast.error("Message failed", {
        description: err instanceof Error ? err.message : "ForgeCloud could not send that request.",
      });
      setInput(text);
    }
  }

  async function approveAndStart(taskIds: string[]) {
    if (approvePlan.isPending) return;
    if (taskIds.length === 0) {
      toast.error("Plan has no scoped tasks", {
        description: "Ask ForgeCloud to regenerate the plan before starting agents.",
      });
      return;
    }
    try {
      const result = await approvePlan.mutateAsync({ taskIds });
      const count = result?.results?.length ?? taskIds.length;
      toast.success("Plan approved", {
        description: `${count} task${count === 1 ? "" : "s"} sent to the assigned agents.`,
      });
      navigate({ to: "/app/tasks" });
    } catch (err) {
      toast.error("Could not approve plan", {
        description: err instanceof Error ? err.message : "ForgeCloud could not start that plan.",
      });
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
        <ScreenHeader
          title="Build Room"
          subtitle="Tell ForgeCloud what outcome you want; the workspace turns it into tasks, reviews, previews, and deploy gates."
          action={
            data && !data.aiAvailable ? (
              <span className="rounded-full border border-amber bg-amber/10 px-3 py-1 text-xs font-medium text-amber">
                <AlertTriangle className="mr-1 inline size-3" />
                Fallback AI mode
              </span>
            ) : null
          }
        />
        {data && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatusTile
              icon={CheckCircle2}
              label="Tasks done"
              value={`${doneTasks}/${tasks.length}`}
              tone="mint"
            />
            <StatusTile
              icon={Clock3}
              label="In motion"
              value={buildingTasks + reviewTasks}
              tone="sky"
            />
            <StatusTile icon={GitPullRequest} label="Open PRs" value={openPrs} tone="violet" />
            <StatusTile
              icon={ShieldCheck}
              label="Approvals"
              value={approvals.length}
              tone="amber"
            />
          </div>
        )}
      </div>

      {data && (
        <div className="px-4 sm:px-6 lg:px-8 xl:hidden">
          <PreviewPanel
            previewKey={previewKey}
            setPreviewKey={setPreviewKey}
            hasProject={hasProject}
            compact
          />
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <div className="flex min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="mx-auto max-w-3xl space-y-4 pb-4">
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {data && data.chatMessages.length === 0 && !hasProject && (
                <EmptyBuildRoom onSend={handleSend} pending={send.isPending} />
              )}

              {data && hasProject && data.chatMessages.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                      <WandSparkles className="size-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold">Workspace is awake</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Ask for a new feature, a risk review, or the safest next ship step.
                      </p>
                    </div>
                  </div>
                  <PromptGrid
                    prompts={FOLLOW_UP_PROMPTS}
                    onSend={handleSend}
                    pending={send.isPending}
                  />
                </div>
              )}

              {data?.chatMessages.map((m) => {
                if (m.role === "user") {
                  return (
                    <div
                      key={m.id}
                      className="flex justify-end animate-in fade-in slide-in-from-right-2"
                    >
                      <div className="max-w-xl rounded-2xl bg-foreground px-5 py-3 text-sm leading-relaxed text-background shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                const meta = m.metadata
                  ? (() => {
                      try {
                        return JSON.parse(m.metadata);
                      } catch {
                        return null;
                      }
                    })()
                  : null;
                if (meta?.kind === "plan" && meta.plan) {
                  const plan = meta.plan;
                  const taskIds = Array.isArray(meta.taskIds) ? meta.taskIds : [];
                  return (
                    <div key={m.id} className="space-y-3 animate-in fade-in slide-in-from-left-2">
                      <Message from="ForgeCloud" accent>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                            <Sparkles className="size-3.5" />
                            Plan ready
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {plan.features.length} tasks queued for review
                          </span>
                        </div>
                        <div className="mt-3 text-sm leading-relaxed text-muted-foreground">
                          {plan.summary}
                        </div>
                        <div className="mt-4 grid gap-3">
                          {plan.features.map(
                            (
                              f: {
                                title: string;
                                description: string;
                                ownerAgent: string;
                                riskLevel: string;
                              },
                              i: number,
                            ) => (
                              <div
                                key={i}
                                className="grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-[minmax(0,1fr)_9rem_4.5rem]"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium">{f.title}</div>
                                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                    {f.description}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Bot className="size-4 text-violet" />
                                  <span>{f.ownerAgent}</span>
                                </div>
                                <div className="flex items-center sm:justify-end">
                                  <span
                                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${riskColor(f.riskLevel)}`}
                                  >
                                    {f.riskLevel}
                                  </span>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => approveAndStart(taskIds)}
                            disabled={approvePlan.isPending || taskIds.length === 0}
                            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-foreground hover:brightness-105 transition-all disabled:opacity-40"
                          >
                            {approvePlan.isPending ? (
                              <>
                                <Loader2 className="size-3 animate-spin" /> Starting agents
                              </>
                            ) : (
                              <>
                                <Zap className="size-3.5" /> Approve plan
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPlanFor(editingPlanFor === m.id ? null : m.id);
                              setPlanEditNote("");
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <Pencil className="size-3.5" /> Edit plan
                          </button>
                          <Link
                            to="/app/tasks"
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <CheckCircle2 className="size-3.5" /> Task board
                          </Link>
                          <button
                            type="button"
                            onClick={() => setAddingFeatureFor(m.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <Sparkles className="size-3.5" /> Add feature
                          </button>
                          <Link
                            to="/app/preview"
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <Rocket className="size-3.5" /> Preview
                          </Link>
                        </div>
                        {editingPlanFor === m.id && (
                          <form
                            className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-start"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!planEditNote.trim()) return;
                              const msg = `Refine the plan: ${planEditNote.trim()}\n\nCurrent plan: ${plan.summary}\nFeatures: ${plan.features.map((f: { title: string }) => f.title).join("; ")}`;
                              setPlanEditNote("");
                              setEditingPlanFor(null);
                              void handleSend(msg);
                            }}
                          >
                            <input
                              value={planEditNote}
                              onChange={(e) => setPlanEditNote(e.target.value)}
                              placeholder="e.g. drop the export feature, make onboarding more visual"
                              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/25"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={!planEditNote.trim()}
                                className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-30"
                              >
                                Refine
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPlanFor(null);
                                  setPlanEditNote("");
                                }}
                                className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                        {addingFeatureFor === m.id && (
                          <form
                            className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-start"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!extraFeature.trim()) return;
                              const msg = `Add a feature: ${extraFeature.trim()}`;
                              setExtraFeature("");
                              setAddingFeatureFor(null);
                              void handleSend(msg);
                            }}
                          >
                            <input
                              value={extraFeature}
                              onChange={(e) => setExtraFeature(e.target.value)}
                              placeholder="e.g. add a referral link to the thank-you page"
                              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/25"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={!extraFeature.trim()}
                                className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-30"
                              >
                                Add
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingFeatureFor(null);
                                  setExtraFeature("");
                                }}
                                className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </Message>
                    </div>
                  );
                }
                if (meta?.kind === "build_complete") {
                  return (
                    <Message key={m.id} from="ForgeCloud" accent>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-mint/15 px-3 py-1 text-xs font-semibold text-mint">
                          <GitMerge className="size-3.5" />
                          Safe PRs merged
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-sky/15 px-3 py-1 text-xs font-semibold text-sky">
                          <Rocket className="size-3.5" />
                          Preview live
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {m.content}
                      </p>
                      {meta.previewUrl && (
                        <a
                          href={meta.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90"
                        >
                          Open platform link <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </Message>
                  );
                }
                if (meta?.kind === "secret_block" || meta?.kind === "guardrail_block") {
                  return (
                    <Message key={m.id} from="Safety Agent">
                      <div className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="mt-0.5 size-4 text-coral" />
                        <div>
                          <div className="font-medium text-coral">Blocked</div>
                          <div className="mt-1 text-muted-foreground">{m.content}</div>
                        </div>
                      </div>
                    </Message>
                  );
                }
                return (
                  <Message key={m.id} from="ForgeCloud">
                    {m.content}
                  </Message>
                );
              })}

              {send.isPending && (
                <Message from="ForgeCloud" accent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="size-4 animate-spin text-brand" />
                      Working through the request
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {["Product", "Safety", "Builder"].map((agent) => (
                        <div
                          key={agent}
                          className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
                        >
                          <span className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-mint" />
                          {agent} Agent
                        </div>
                      ))}
                    </div>
                  </div>
                </Message>
              )}
            </div>
          </div>
          <Composer
            input={input}
            setInput={setInput}
            onSend={handleSend}
            pending={send.isPending}
            prompts={suggestedPrompts}
          />
        </div>

        {data && (
          <PreviewPanel
            previewKey={previewKey}
            setPreviewKey={setPreviewKey}
            hasProject={hasProject}
            className="hidden xl:flex"
          />
        )}

        {data && (
          <aside className="space-y-3">
            <BuildStudioPanel
              agents={agents}
              tasks={tasks}
              prs={prs}
              deployments={deployments}
              branches={branches}
              rocketRideRuns={rocketRideRuns}
              openAgentId={openStudioAgent}
              setOpenAgentId={setOpenStudioAgent}
            />
            <ContextPanel
              activeAgents={activeAgents}
              agents={agents}
              approvals={approvals}
              latestDeployment={latestDeployment}
              recentPrs={prs.slice(0, 3)}
              recentRecovery={recovery.slice(0, 3)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({
  previewKey,
  setPreviewKey,
  hasProject,
  compact = false,
  className = "",
}: {
  previewKey: number;
  setPreviewKey: Dispatch<SetStateAction<number>>;
  hasProject: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${className} ${
        compact ? "flex min-h-[24rem]" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-mint" />
          <h2 className="truncate text-sm font-semibold">Live preview</h2>
          <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-mint">
            Demo app
          </span>
        </div>
        <Link
          to="/app/preview"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Open full <ExternalLink className="size-3" />
        </Link>
      </div>
      <iframe
        key={previewKey}
        src="/demo-preview"
        title="Live app preview"
        sandbox="allow-scripts allow-forms allow-same-origin"
        className={`w-full flex-1 bg-background ${compact ? "min-h-[18rem]" : "h-full min-h-[28rem]"}`}
        onLoad={() => setPreviewKey((k) => k)}
      />
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {hasProject
            ? "Your build is reflected here. Click to comment or blame any element."
            : "Preview will populate as agents ship features."}
        </span>
        <button
          type="button"
          onClick={() => setPreviewKey((k) => k + 1)}
          className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function EmptyBuildRoom({ onSend, pending }: { onSend: (text: string) => void; pending: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background animate-in fade-in">
      <div className="border-b border-border bg-muted/30 p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-violet text-white">
            <WandSparkles className="size-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Start with the outcome</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              ForgeCloud will turn the request into a scoped plan, assign agents, create reviewable
              work, and hold risky actions for approval.
            </p>
          </div>
        </div>
      </div>
      <div className="p-5">
        <PromptGrid prompts={DEMO_PROMPTS} onSend={onSend} pending={pending} />
      </div>
    </div>
  );
}

function PromptGrid({
  prompts,
  onSend,
  pending,
}: {
  prompts: string[];
  onSend: (text: string) => void;
  pending: boolean;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          onClick={() => onSend(prompt)}
          disabled={pending}
          className="group rounded-xl border border-border bg-card p-3 text-left text-sm transition-all hover:border-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="mb-2 size-4 text-brand transition-transform group-hover:scale-110" />
          {prompt}
        </button>
      ))}
    </div>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  pending,
  prompts,
}: {
  input: string;
  setInput: (value: string) => void;
  onSend: (text: string) => void;
  pending: boolean;
  prompts: string[];
}) {
  return (
    <div className="border-t border-border bg-background/95 p-3">
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSend(prompt)}
            disabled={pending}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(input);
        }}
        className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:ring-2 focus-within:ring-brand/20"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(input);
            }
          }}
          placeholder="Describe the next outcome..."
          className="max-h-36 min-h-12 flex-1 resize-none rounded-lg border-0 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
          rows={1}
        />
        <button
          type="submit"
          disabled={!input.trim() || pending}
          aria-label="Send message"
          title="Send message"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm transition-all hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
        >
          {pending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
        </button>
      </form>
    </div>
  );
}

function BuildStudioPanel({
  agents,
  tasks,
  prs,
  deployments,
  branches,
  rocketRideRuns,
  openAgentId,
  setOpenAgentId,
}: {
  agents: Array<{ id: string; name: string; status: string; last_action?: string | null }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    assigned_agent_id?: string | null;
    linked_pr_id?: string | null;
  }>;
  prs: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    risk_level: string;
    created_by_agent_id?: string | null;
    task_id?: string | null;
    preview_url?: string | null;
  }>;
  deployments: Array<{
    environment: string;
    status: string;
    cloudflare_url?: string | null;
    railway_url?: string | null;
  }>;
  branches: Array<{
    id: string;
    name: string;
    status: string;
    head_pr_id?: string | null;
    pr_id?: string | null;
  }>;
  rocketRideRuns: Array<{
    id: string;
    workflow_type: string;
    status: string;
    task_id?: string | null;
  }>;
  openAgentId: string | null;
  setOpenAgentId: (id: string | null) => void;
}) {
  const liveDeployment = deployments.find((deployment) => deployment.status === "live");
  const liveUrl =
    liveDeployment?.cloudflare_url ??
    liveDeployment?.railway_url ??
    prs.find((pr) => pr.preview_url)?.preview_url ??
    null;
  const mergedCount = prs.filter((pr) => pr.status === "merged").length;
  const workingCount = agents.filter((agent) => agent.status !== "idle").length;
  const completedRuns = rocketRideRuns.filter((run) => run.status === "completed").length;

  return (
    <div
      data-testid="build-studio-panel"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">AI software studio</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Agents turn the request into tasks, commits, merged PRs, and a live preview.
          </p>
        </div>
        <span className="rounded-full bg-violet/15 px-2 py-1 text-[10px] font-semibold uppercase text-violet">
          Build Mode
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <StudioMetric label="agents" value={workingCount > 0 ? workingCount : agents.length} />
        <StudioMetric label="merged" value={mergedCount} />
        <StudioMetric label="runs" value={completedRuns} />
      </div>

      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-mint/30 bg-mint/10 px-3 py-2 text-xs font-medium text-mint hover:bg-mint/15"
        >
          <span className="truncate">Platform link ready</span>
          <ExternalLink className="size-3.5 shrink-0" />
        </a>
      )}

      <div className="mt-3 space-y-2">
        {agents.slice(0, 7).map((agent) => {
          const agentTasks = tasks.filter((task) => task.assigned_agent_id === agent.id);
          const agentPrs = prs.filter(
            (pr) =>
              pr.created_by_agent_id === agent.id ||
              agentTasks.some((task) => task.id === pr.task_id || task.linked_pr_id === pr.id),
          );
          const agentBranches = branches.filter((branch) =>
            agentPrs.some((pr) => pr.id === (branch.head_pr_id ?? branch.pr_id)),
          );
          const activeTask =
            agentTasks.find((task) => task.status === "building") ??
            agentTasks.find((task) => task.status === "review") ??
            agentTasks[0];
          const isOpen = openAgentId === agent.id;
          const pulse =
            agent.status !== "idle" || agentTasks.some((task) => task.status !== "done");

          return (
            <div key={agent.id} className="overflow-hidden rounded-xl border border-border">
              <button
                type="button"
                data-testid={`build-studio-agent-${agent.id}`}
                aria-label={`Toggle ${agent.name} build details`}
                onClick={() => setOpenAgentId(isOpen ? null : agent.id)}
                className="flex w-full items-center gap-3 bg-background px-3 py-2.5 text-left hover:bg-muted/60"
              >
                <span
                  className={`size-2 rounded-full ${pulse ? "animate-pulse bg-mint" : "bg-muted-foreground/40"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{agent.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {activeTask?.title ?? agent.last_action ?? "Ready"}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {agent.status}
                </span>
                <ChevronDown
                  className={`size-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-border bg-card px-3 py-3 text-xs">
                  <StudioRow
                    label="Working on"
                    value={activeTask?.title ?? "No active task yet"}
                    tone="sky"
                  />
                  <StudioRow
                    label="Commit"
                    value={
                      agentBranches[0]
                        ? `${agentBranches[0].name} / ${agentBranches[0].status}`
                        : agentPrs[0]
                          ? `PR #${agentPrs[0].number}`
                          : "Waiting for generated work"
                    }
                    tone="violet"
                  />
                  <StudioRow
                    label="Review"
                    value={
                      agentPrs[0]
                        ? `${agentPrs[0].status.replace(/_/g, " ")} / ${agentPrs[0].risk_level} risk`
                        : "No PR yet"
                    }
                    tone={agentPrs[0]?.risk_level === "high" ? "amber" : "mint"}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StudioMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background px-2 py-2">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function StudioRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "sky" | "violet" | "mint" | "amber";
}) {
  const toneClass =
    tone === "sky"
      ? "text-sky"
      : tone === "violet"
        ? "text-violet"
        : tone === "amber"
          ? "text-amber"
          : "text-mint";
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </span>
      <span className={`min-w-0 text-right font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

function ContextPanel({
  activeAgents,
  agents,
  approvals,
  latestDeployment,
  recentPrs,
  recentRecovery,
}: {
  activeAgents: { id: string; name: string; status: string; last_action?: string | null }[];
  agents: { id: string; name: string; status: string; last_action?: string | null }[];
  approvals: { id: string; reason: string; risk_level: string }[];
  latestDeployment?: {
    id: string;
    environment: string;
    status: string;
    cloudflare_url?: string | null;
  };
  recentPrs: { id: string; number: number; title: string; status: string; risk_level: string }[];
  recentRecovery: { id: string; failure_type: string; status: string; message: string }[];
}) {
  const visibleAgents = activeAgents.length > 0 ? activeAgents.slice(0, 4) : agents.slice(0, 4);
  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Agent pulse</h2>
          <span className="rounded-full bg-mint/15 px-2 py-1 text-[10px] font-semibold uppercase text-mint">
            {activeAgents.length > 0 ? "Live" : "Ready"}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {visibleAgents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2 rounded-full bg-mint" />
                {agent.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {agent.last_action ?? agent.status}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Trust gates</h2>
        <div className="mt-3 space-y-2 text-sm">
          <ContextRow icon={ShieldCheck} label="Pending approvals" value={approvals.length} />
          <ContextRow
            icon={Rocket}
            label="Latest deploy"
            value={latestDeployment ? latestDeployment.status : "none"}
          />
        </div>
      </div>
      {approvals.length > 0 && (
        <div className="rounded-2xl border border-amber/40 bg-amber/5 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-amber">
            <ShieldCheck className="size-3.5" />
            <h2 className="text-sm font-semibold">Needs your call</h2>
          </div>
          <ul className="mt-3 space-y-2">
            {approvals.slice(0, 3).map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-amber/30 bg-background p-3 text-xs"
              >
                <div className="font-medium text-foreground">{a.reason}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-amber">
                  {a.risk_level} risk
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recentPrs.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent PRs</h2>
            <Link
              to="/app/changes"
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {recentPrs.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-background p-2.5 text-xs"
              >
                <span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">
                  #{p.number}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    p.risk_level === "high"
                      ? "bg-coral/20 text-coral"
                      : p.risk_level === "med"
                        ? "bg-amber/20 text-amber"
                        : "bg-mint/20 text-mint"
                  }`}
                >
                  {p.risk_level}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recentRecovery.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Latest activity</h2>
            <Link
              to="/app/failures"
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Timeline
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {recentRecovery.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-background p-2.5 text-xs"
              >
                <div className="flex items-center gap-1.5 text-violet">
                  <span className="size-1.5 rounded-full bg-violet" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                    {r.failure_type.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-muted-foreground">{r.message}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ContextRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string | number;
  tone: "mint" | "sky" | "violet" | "amber";
}) {
  const toneClass =
    tone === "mint"
      ? "bg-mint/15 text-mint"
      : tone === "sky"
        ? "bg-sky/20 text-sky"
        : tone === "violet"
          ? "bg-violet/15 text-violet"
          : "bg-amber/15 text-amber";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2">
      <span className={`flex size-8 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function Message({
  from,
  children,
  accent = false,
}: {
  from: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex gap-3 animate-in fade-in slide-in-from-left-2">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet">
        <Bot className="size-4" />
      </div>
      <div
        className={`flex-1 rounded-2xl border p-5 text-sm shadow-sm ${
          accent ? "border-brand/30 bg-card" : "border-border bg-background"
        }`}
      >
        <div className="text-xs font-medium text-muted-foreground">{from}</div>
        <div className="mt-2 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function riskColor(level: string) {
  if (level === "high") return "bg-coral/20 text-coral";
  if (level === "med") return "bg-amber/20 text-amber";
  return "bg-mint/20 text-mint";
}
