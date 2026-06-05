import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useForgeState } from "@/lib/client";
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Radio,
  Rocket,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const Route = createFileRoute("/app/activity")({
  component: ActivityScreen,
});

type ActivityEvent = {
  id: string;
  actor_type: string;
  event_type: string;
  title: string;
  description?: string | null;
  linked_task_id?: string | null;
  linked_pr_id?: string | null;
  linked_deployment_id?: string | null;
  tool?: string | null;
  created_at: number;
  task_title?: string | null;
  pr_number?: number | null;
  pr_title?: string | null;
  deployment_environment?: string | null;
  deployment_status?: string | null;
};

type MemoryEntry = {
  id: string;
  source: string;
  title: string;
  body: string;
  confidence: string;
  created_at: number;
  task_title?: string | null;
  pr_number?: number | null;
  pr_title?: string | null;
};

type RocketRideRun = {
  id: string;
  workflow_type: string;
  status: string;
  mode: string;
  task_id?: string | null;
  pr_id?: string | null;
  deployment_id?: string | null;
  input_json?: string | null;
  error?: string | null;
  started_at: number;
  completed_at?: number | null;
};

const TOOL_META = {
  RocketRide: {
    icon: Rocket,
    label: "RocketRide",
    detail: "Agent workflow engine",
    tone: "text-violet bg-violet/10 border-violet/20",
  },
  Butterbase: {
    icon: Database,
    label: "Butterbase",
    detail: "Backend source of truth",
    tone: "text-sky bg-sky/10 border-sky/20",
  },
  XTrace: {
    icon: Brain,
    label: "XTrace",
    detail: "Project memory",
    tone: "text-mint bg-mint/10 border-mint/20",
  },
  Composio: {
    icon: Radio,
    label: "Composio",
    detail: "App connections",
    tone: "text-coral bg-coral/10 border-coral/20",
  },
} as const;

function ActivityScreen() {
  const { data, isLoading } = useForgeState();

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activityEvents = (data.activityEvents ?? []) as ActivityEvent[];
  const memoryEntries = (data.memoryEntries ?? []) as MemoryEntry[];
  const rocketRideRuns = (data.rocketRideRuns ?? []) as RocketRideRun[];
  const approvalEvents = activityEvents.filter((event) => event.event_type.includes("approval"));
  const guardrailEvents = activityEvents.filter((event) => event.event_type.includes("guardrail"));

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Activity"
        subtitle="Agent actions, tool handoffs, approvals, and project memory in one timeline."
        action={
          <Link
            to="/app/preview"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
          >
            <Brain className="size-3" />
            Ask blame
          </Link>
        }
      />

      <div className="space-y-6 p-4 sm:p-8">
        <div className="grid gap-3 md:grid-cols-4">
          {Object.values(TOOL_META).map((tool) => (
            <ToolSummary key={tool.label} {...tool} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.9fr)]">
          <section className="rounded-3xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-brand" />
                <h2 className="text-sm font-semibold">Project timeline</h2>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {activityEvents.length} events
              </span>
            </div>

            {activityEvents.length === 0 ? (
              <EmptyActivity />
            ) : (
              <div className="divide-y divide-border">
                {activityEvents.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Rocket className="size-4 text-violet" />
                <h2 className="text-sm font-semibold">Rocket Ride workflows</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Agent orchestration runs for chat planning, task builds, and deploy actions.
              </p>
              <div className="mt-4 space-y-3">
                {rocketRideRuns.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No workflow runs yet. Build a task to start Rocket Ride orchestration.
                  </p>
                ) : (
                  rocketRideRuns
                    .slice(0, 5)
                    .map((run) => <RocketRideRunCard key={run.id} run={run} />)
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Brain className="size-4 text-mint" />
                <h2 className="text-sm font-semibold">Memory log</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Stored context used for approvals, guardrails, and Plain-English Blame.
              </p>
              <div className="mt-4 space-y-3">
                {memoryEntries.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No memory entries yet. Preview comments and approval decisions will appear here.
                  </p>
                ) : (
                  memoryEntries.map((memory) => <MemoryCard key={memory.id} memory={memory} />)
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-amber" />
                <h2 className="text-sm font-semibold">Review pulse</h2>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Metric label="Approvals" value={approvalEvents.length} />
                <Metric label="Guardrails" value={guardrailEvents.length} />
                <Metric label="Memories" value={memoryEntries.length} />
                <Metric label="Workflows" value={rocketRideRuns.length} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ToolSummary({
  icon: Icon,
  label,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-4" />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="mt-1 text-xs opacity-80">{detail}</p>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Icon = eventIcon(event.event_type);
  const tool =
    event.tool && event.tool in TOOL_META ? TOOL_META[event.tool as keyof typeof TOOL_META] : null;

  return (
    <article className="grid gap-3 px-5 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <div className="text-xs text-muted-foreground">{formatWhen(event.created_at)}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-muted text-foreground">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{event.title}</h3>
            <p className="text-[11px] uppercase text-muted-foreground">{eventLabel(event)}</p>
          </div>
          {tool && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tool.tone}`}
            >
              {tool.label}
            </span>
          )}
        </div>
        {event.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{event.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {event.task_title && <LinkedPill label={`Task: ${event.task_title}`} to="/app/tasks" />}
          {event.pr_number && (
            <LinkedPill label={`PR #${event.pr_number}: ${event.pr_title}`} to="/app/changes" />
          )}
          {event.deployment_environment && (
            <LinkedPill
              label={`${event.deployment_environment}: ${event.deployment_status}`}
              to="/app/deployments"
            />
          )}
        </div>
      </div>
    </article>
  );
}

function MemoryCard({ memory }: { memory: MemoryEntry }) {
  return (
    <article className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{memory.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {memory.source} memory / {formatWhen(memory.created_at)}
          </p>
        </div>
        <span className="rounded-full bg-mint/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-mint">
          {memory.confidence}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{memory.body}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {memory.task_title && <LinkedPill label={memory.task_title} to="/app/tasks" />}
        {memory.pr_number && <LinkedPill label={`PR #${memory.pr_number}`} to="/app/changes" />}
      </div>
    </article>
  );
}

function RocketRideRunCard({ run }: { run: RocketRideRun }) {
  const input = parseRunInput(run.input_json);
  return (
    <article className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            {input.title ?? run.workflow_type.replace(/_/g, " ")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {run.mode} / {formatWhen(run.started_at)}
          </p>
        </div>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
            (run.status === "completed"
              ? "bg-mint/10 text-mint"
              : run.status === "failed"
                ? "bg-coral/10 text-coral"
                : "bg-violet/10 text-violet")
          }
        >
          {run.status}
        </span>
      </div>
      {input.description && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{input.description}</p>
      )}
      {run.error && <p className="mt-3 text-xs text-coral">{run.error}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {run.task_id && <LinkedPill label={`Task ${run.task_id}`} to="/app/tasks" />}
        {run.pr_id && <LinkedPill label={`PR ${run.pr_id}`} to="/app/changes" />}
      </div>
    </article>
  );
}

function parseRunInput(value?: string | null): { title?: string; description?: string | null } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { title?: string; description?: string | null };
    return parsed;
  } catch {
    return {};
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function LinkedPill({
  label,
  to,
}: {
  label: string;
  to: "/app/tasks" | "/app/changes" | "/app/deployments";
}) {
  return (
    <Link to={to} className="rounded-full border border-border bg-card px-2 py-0.5 hover:bg-muted">
      {label}
    </Link>
  );
}

function EmptyActivity() {
  return (
    <div className="p-8 text-center">
      <Clock3 className="mx-auto size-6 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">
        No activity yet. Start from Chat or seed the Pizza Ops demo.
      </p>
    </div>
  );
}

function eventIcon(type: string) {
  if (type.includes("chat")) return MessageSquare;
  if (type.includes("pr")) return GitPullRequest;
  if (type.includes("deploy") || type.includes("preview")) return Rocket;
  if (type.includes("guardrail") || type.includes("approval")) return ShieldCheck;
  if (type.includes("persist")) return Database;
  if (type.includes("memory") || type.includes("comment")) return Brain;
  if (type.includes("completed")) return CheckCircle2;
  return Bot;
}

function eventLabel(event: ActivityEvent) {
  return `${event.actor_type.replace(/_/g, " ")} / ${event.event_type.replace(/_/g, " ")}`;
}

function formatWhen(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
