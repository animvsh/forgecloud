import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Bot, Loader2 } from "lucide-react";
import { useForgeState } from "@/lib/client";
import type { Agent } from "@/lib/db";

export const Route = createFileRoute("/app/agents")({
  component: AgentsScreen,
});

const typeColors: Record<string, string> = {
  product: "var(--violet)",
  design: "var(--coral)",
  frontend: "var(--sky)",
  backend: "var(--mint)",
  auth: "var(--amber)",
  qa: "var(--sky)",
  devops: "var(--mint)",
  safety: "var(--amber)",
  recovery: "var(--violet)",
};

function AgentsScreen() {
  const { data, isLoading } = useForgeState();

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading agents...</p>
        </div>
      </div>
    );
  }

  const agents = data.agents;
  const tasks = data.tasks;
  const working = agents.filter((a) => a.status === "working").length;
  const idle = agents.filter((a) => a.status === "idle").length;

  return (
    <div>
      <ScreenHeader
        title="Agent team"
        subtitle={`${agents.length} agents · ${working} working · ${idle} idle`}
      />

      <div className="mt-6">
        {agents.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Bot className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No agents yet. Start a project to spin up the team.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} tasks={tasks} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent, tasks }: { agent: Agent; tasks: { title: string; status: string; id: string }[] }) {
  const currentTask = tasks.find((t) => t.id === agent.current_task_id);
  const recent = tasks.filter((t) => t.assigned_agent_id === agent.id).slice(0, 3);
  const permissions: { allowed: string[]; needsApproval: string[] } = (() => {
    try { return JSON.parse(agent.permissions); } catch { return { allowed: [], needsApproval: [] }; }
  })();

  const color = typeColors[agent.type] ?? "var(--violet)";

  return (
    <div className="rounded-3xl border border-border bg-card p-5 card-hover">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 items-center justify-center squircle"
            style={{ background: color }}
          >
            <Bot className="size-5 text-white" />
          </div>
          <div>
            <div className="font-semibold">{agent.name}</div>
            <div className="text-xs text-muted-foreground">{agent.role}</div>
          </div>
        </div>
        <StatusPill status={agent.status} />
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Model</span>
          <span className="font-mono">{agent.model_primary.replace("claude-", "")}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Fallback</span>
          <span className="font-mono">{agent.model_fallback.replace("claude-", "")}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Retries</span>
          <span className="font-mono">{agent.retry_count}</span>
        </div>
      </div>

      {agent.last_action && (
        <div className="mt-4 rounded-xl border border-border bg-background p-3 text-xs">
          <div className="text-muted-foreground">Last action</div>
          <div className="mt-1">{agent.last_action}</div>
        </div>
      )}

      {currentTask && (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs">
          <div className="text-brand font-medium">Working on</div>
          <div className="mt-1 font-medium">{currentTask.title}</div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-muted-foreground">Recent</div>
          <div className="mt-1 space-y-1">
            {recent.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <span className={`size-1.5 rounded-full ${t.status === "done" ? "bg-mint" : t.status === "review" ? "bg-amber" : "bg-sky"}`} />
                <span className="line-clamp-1">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {permissions.needsApproval.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {permissions.needsApproval.map((p) => (
            <span key={p} className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] text-amber">
              {p.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    working: "bg-sky/20 text-sky",
    waiting: "bg-amber/20 text-amber",
    error: "bg-coral/20 text-coral",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}
