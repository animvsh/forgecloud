import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Bot, Loader2 } from "lucide-react";
import { useForgeState } from "@/lib/client";
import type { Agent, PullRequest, Task } from "@/lib/db";

export const Route = createFileRoute("/app/agents")({
  component: AgentsRoute,
});

function AgentsRoute() {
  // When a child route like /app/agents/$agentId is active, render only the
  // child via <Outlet />. Otherwise render the agent list.
  const matchRoute = useMatchRoute();
  const inDetail = matchRoute({ to: "/app/agents/$agentId", fuzzy: false });
  if (inDetail) return <Outlet />;
  return <AgentsScreen />;
}

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

      <section className="mt-6">
        <h2 className="text-base font-semibold tracking-tight">Agent activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live flow from agents to in-flight tasks to open PRs.
        </p>
        <div className="mt-3 rounded-3xl border border-border bg-card p-4">
          <AgentFlowGraph
            agents={agents}
            tasks={tasks as Task[]}
            prs={(data.prs ?? []) as PullRequest[]}
          />
        </div>
      </section>

      <div className="mt-6">
        {agents.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Bot className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              No agents yet. Start a project to spin up the team.
            </p>
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

function AgentCard({
  agent,
  tasks,
}: {
  agent: Agent;
  tasks: { title: string; status: string; id: string }[];
}) {
  const safeTasks = tasks ?? [];
  const currentTask = safeTasks.find((t) => t.id === agent.current_task_id);
  const recent = safeTasks.filter((t) => t.assigned_agent_id === agent.id).slice(0, 3);
  const permissions: { allowed: string[]; needsApproval: string[] } = (() => {
    try {
      return JSON.parse(agent.permissions);
    } catch {
      return { allowed: [], needsApproval: [] };
    }
  })();

  const color = typeColors[agent.type] ?? "var(--violet)";

  return (
    <Link
      to="/app/agents/$agentId"
      params={{ agentId: agent.id }}
      className="block rounded-3xl border border-border bg-card p-5 card-hover cursor-pointer hover:border-brand/40 hover:shadow-md transition-all"
    >
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
                <span
                  className={`size-1.5 rounded-full ${t.status === "done" ? "bg-mint" : t.status === "review" ? "bg-amber" : "bg-sky"}`}
                />
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
    </Link>
  );
}

function truncate(s: string, n = 22) {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function distribute(count: number, top: number, bottom: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, i) => top + i * step);
}

function AgentFlowGraph({
  agents,
  tasks,
  prs,
}: {
  agents: Agent[];
  tasks: Task[];
  prs: PullRequest[];
}) {
  // Active agents: working OR have a current task.
  const activeAgents = agents
    .filter((a) => a.status === "working" || a.current_task_id)
    .slice(0, 9);

  // In-flight tasks.
  const inFlightTasks = tasks
    .filter((t) => t.status === "building" || t.status === "review")
    .slice(0, 6);

  // Open PRs.
  const openPrs = prs.filter((p) => p.status === "open").slice(0, 5);

  if (activeAgents.length === 0 && inFlightTasks.length === 0 && openPrs.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-background p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No activity right now — start a build to see the graph.
        </p>
      </div>
    );
  }

  const W = 900;
  const H = 360;
  const colX = { left: 130, mid: 450, right: 770 };
  const top = 40;
  const bottom = H - 30;

  const agentYs = distribute(activeAgents.length, top, bottom);
  const taskYs = distribute(inFlightTasks.length, top + 10, bottom - 10);
  const prYs = distribute(openPrs.length, top + 20, bottom - 20);

  const agentPos = new Map(activeAgents.map((a, i) => [a.id, { x: colX.left, y: agentYs[i] }]));
  const taskPos = new Map(inFlightTasks.map((t, i) => [t.id, { x: colX.mid, y: taskYs[i] }]));
  const prPos = new Map(openPrs.map((p, i) => [p.id, { x: colX.right, y: prYs[i] }]));

  // Curve helper: cubic bezier with horizontal control points for smooth S-curve.
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  type Edge = { d: string; active: boolean; key: string };
  const agentTaskEdges: Edge[] = [];
  for (const task of inFlightTasks) {
    if (!task.assigned_agent_id) continue;
    const ap = agentPos.get(task.assigned_agent_id);
    const tp = taskPos.get(task.id);
    if (!ap || !tp) continue;
    const agent = activeAgents.find((a) => a.id === task.assigned_agent_id);
    const active = !!agent && agent.current_task_id === task.id;
    agentTaskEdges.push({
      d: curve(ap.x + 24, ap.y, tp.x - 70, tp.y),
      active,
      key: `at-${agent?.id}-${task.id}`,
    });
  }

  const taskPrEdges: Edge[] = [];
  for (const pr of openPrs) {
    if (!pr.task_id) continue;
    const tp = taskPos.get(pr.task_id);
    const pp = prPos.get(pr.id);
    if (!tp || !pp) continue;
    taskPrEdges.push({
      d: curve(tp.x + 70, tp.y, pp.x - 40, pp.y),
      active: false,
      key: `tp-${pr.task_id}-${pr.id}`,
    });
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Agent activity flow graph"
    >
      {/* Column headers */}
      <text
        x={colX.left}
        y={18}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize="11"
      >
        Agents
      </text>
      <text x={colX.mid} y={18} textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        In-flight tasks
      </text>
      <text
        x={colX.right}
        y={18}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize="11"
      >
        Open PRs
      </text>

      {/* Edges (drawn first so nodes overlay them) */}
      <g fill="none" stroke="var(--brand)" strokeWidth="1.5">
        {agentTaskEdges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            opacity={e.active ? 0.9 : 0.45}
            className="transition-opacity hover:opacity-100"
          >
            {e.active && (
              <animate
                attributeName="stroke-opacity"
                values="0.9;0.35;0.9"
                dur="2.2s"
                repeatCount="indefinite"
              />
            )}
          </path>
        ))}
        {taskPrEdges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            opacity={0.45}
            className="transition-opacity hover:opacity-100"
          />
        ))}
      </g>

      {/* Agent nodes */}
      {activeAgents.map((a, i) => {
        const y = agentYs[i];
        const color = typeColors[a.type] ?? "var(--violet)";
        const isActive = !!a.current_task_id || a.status === "working";
        const r = isActive ? 18 : 12;
        return (
          <g key={a.id}>
            <circle
              cx={colX.left}
              cy={y}
              r={r}
              fill={color}
              stroke="var(--background)"
              strokeWidth="2"
            />
            <text
              x={colX.left}
              y={y + r + 14}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
            >
              {truncate(a.name, 18)}
            </text>
          </g>
        );
      })}

      {/* Task nodes */}
      {inFlightTasks.map((t, i) => {
        const y = taskYs[i];
        return (
          <g key={t.id}>
            <rect
              x={colX.mid - 70}
              y={y - 14}
              width={140}
              height={28}
              rx={10}
              fill="var(--amber)"
              opacity={0.9}
              stroke="var(--background)"
              strokeWidth="2"
            />
            <text
              x={colX.mid}
              y={y + 4}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
            >
              {truncate(t.title, 22)}
            </text>
          </g>
        );
      })}

      {/* PR nodes */}
      {openPrs.map((p, i) => {
        const y = prYs[i];
        return (
          <g key={p.id}>
            <rect
              x={colX.right - 40}
              y={y - 14}
              width={80}
              height={28}
              rx={14}
              fill="var(--sky)"
              opacity={0.9}
              stroke="var(--background)"
              strokeWidth="2"
            />
            <text
              x={colX.right}
              y={y + 4}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
            >
              PR #{p.number}
            </text>
          </g>
        );
      })}
    </svg>
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
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}
