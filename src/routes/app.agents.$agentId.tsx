import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ArrowLeft, Bot, FileCode2, Loader2, Sparkles, Activity } from "lucide-react";
import { useAgentRuns, useForgeState } from "@/lib/client";
import type { Agent } from "@/lib/db";
import { useState } from "react";

export const Route = createFileRoute("/app/agents/$agentId")({
  component: AgentDetailScreen,
});

type AgentRun = {
  id: string;
  agent_id: string;
  task_id: string | null;
  status: string;
  input_prompt: string;
  output_summary: string | null;
  model_used: string | null;
  fallback_used: number;
  started_at: number;
  completed_at: number | null;
  task_title?: string | null;
  runtimeChecks?: RuntimeCheckRow[];
};

type RuntimeCheckRow = {
  id: string;
  check_type: string;
  status: string;
  summary: string;
  artifact_path: string | null;
  completed_at: number | null;
};

type ChangeRow = {
  id: string;
  pr_id: string;
  file_path: string;
  agent_id?: string | null;
};

type PR = { id: string; changes?: ChangeRow[] };

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

function AgentDetailScreen() {
  const { agentId } = Route.useParams();
  const { data, isLoading } = useForgeState();
  const { data: runs, isLoading: runsLoading } = useAgentRuns(agentId);

  const [promptOpen, setPromptOpen] = useState(false);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const agent: Agent | undefined = (data.agents ?? []).find((a: Agent) => a.id === agentId);

  if (!agent) {
    return (
      <div>
        <ScreenHeader title="Agent not found" />
        <div className="p-8">
          <Link
            to="/app/agents"
            className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
          >
            <ArrowLeft className="size-3" /> Back to all agents
          </Link>
          <div className="mt-6 rounded-3xl border-2 border-dashed border-border bg-card p-10 text-center">
            <Bot className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">
              No agent with id "{agentId}" in this project.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tasks: { id: string; title: string; status: string }[] = data.tasks ?? [];
  const currentTask = tasks.find((t) => t.id === agent.current_task_id);

  const permissions: { allowed: string[]; needsApproval: string[] } = (() => {
    try {
      const parsed = JSON.parse(agent.permissions);
      // Tolerate legacy array-shape rows.
      if (Array.isArray(parsed)) return { allowed: parsed, needsApproval: [] };
      return {
        allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [],
        needsApproval: Array.isArray(parsed.needsApproval) ? parsed.needsApproval : [],
      };
    } catch {
      return { allowed: [], needsApproval: [] };
    }
  })();

  const prs: PR[] = data.prs ?? [];
  const filesTouched = Array.from(
    new Set(
      prs
        .flatMap((p) => p.changes ?? [])
        .filter((c) => c.agent_id === agent.id)
        .map((c) => c.file_path),
    ),
  );

  const color = typeColors[agent.type] ?? "var(--violet)";
  const runRows: AgentRun[] = runs ?? [];

  function openPrompt(run: AgentRun) {
    setActiveRun(run);
    setPromptOpen(true);
  }

  return (
    <div>
      <ScreenHeader title={agent.name} subtitle={agent.role} />

      <div className="space-y-6 p-8">
        <Link
          to="/app/agents"
          className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
        >
          <ArrowLeft className="size-3" /> Back to all agents
        </Link>

        {/* Agent card */}
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex size-12 items-center justify-center squircle"
                style={{ background: color }}
              >
                <Bot className="size-6 text-white" />
              </div>
              <div>
                <div className="text-lg font-semibold">{agent.name}</div>
                <div className="text-xs text-muted-foreground">{agent.role}</div>
              </div>
            </div>
            <AgentStatusPill status={agent.status} />
          </div>

          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="text-muted-foreground">Model</div>
              <div className="mt-1 font-mono">{agent.model_primary.replace("claude-", "")}</div>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="text-muted-foreground">Fallback</div>
              <div className="mt-1 font-mono">{agent.model_fallback.replace("claude-", "")}</div>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <div className="text-muted-foreground">Retries</div>
              <div className="mt-1 font-mono">{agent.retry_count}</div>
            </div>
          </div>

          {currentTask && (
            <div className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs">
              <div className="font-medium text-brand">Working on</div>
              <div className="mt-1 font-medium">{currentTask.title}</div>
            </div>
          )}

          {(permissions.allowed.length > 0 || permissions.needsApproval.length > 0) && (
            <div className="mt-4">
              <div className="text-xs text-muted-foreground">Permissions</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {permissions.allowed.map((p) => (
                  <span
                    key={`a-${p}`}
                    className="rounded-full bg-mint/15 px-2 py-0.5 text-[10px] text-mint"
                  >
                    {p.replace(/_/g, " ")}
                  </span>
                ))}
                {permissions.needsApproval.map((p) => (
                  <span
                    key={`n-${p}`}
                    className="rounded-full bg-amber/15 px-2 py-0.5 text-[10px] text-amber"
                  >
                    needs approval · {p.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <h3 className="font-semibold">Activity timeline</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every run by this agent — input prompt, model used, fallback flag, status, and
            timestamps.
          </p>

          <div className="mt-4 space-y-2">
            {runsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading runs…
              </div>
            ) : runRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                No runs yet for this agent.
              </div>
            ) : (
              runRows.map((run) => {
                const failedChecks = (run.runtimeChecks ?? []).filter(
                  (check) => check.status === "failed",
                ).length;
                const passedChecks = (run.runtimeChecks ?? []).filter(
                  (check) => check.status === "passed",
                ).length;
                return (
                  <div key={run.id} className="rounded-2xl border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(run.started_at).toLocaleString()}
                      </div>
                      <span className="text-muted-foreground">·</span>
                      <RunStatusPill status={run.status} />
                      <span className="text-muted-foreground">·</span>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="font-mono">
                          {(run.model_used ?? "—").replace("claude-", "")}
                        </span>
                        {run.fallback_used === 1 && (
                          <span className="rounded-full bg-amber/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber">
                            fallback
                          </span>
                        )}
                      </div>
                      <span className="text-muted-foreground">·</span>
                      <div className="flex-1 text-sm line-clamp-1">
                        {run.task_title ?? (
                          <span className="text-muted-foreground italic">no task</span>
                        )}
                      </div>
                      <button
                        onClick={() => openPrompt(run)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted transition-colors"
                      >
                        <Sparkles className="size-3 text-violet" /> View prompt
                      </button>
                    </div>
                    {(run.runtimeChecks ?? []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-medium text-mint">
                          {passedChecks} checks passed
                        </span>
                        {failedChecks > 0 && (
                          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-medium text-coral">
                            {failedChecks} failed
                          </span>
                        )}
                        {(run.runtimeChecks ?? []).map((check) => (
                          <span
                            key={check.id}
                            title={check.summary}
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {check.check_type.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Files touched */}
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            <FileCode2 className="size-4 text-muted-foreground" />
            <h3 className="font-semibold">Files touched</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Distinct files this agent has changed across all PRs.
          </p>

          <div className="mt-4">
            {filesTouched.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
                No files touched by this agent yet.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {filesTouched.map((path) => (
                  <li
                    key={path}
                    className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"
                  >
                    <FileCode2 className="size-3 text-muted-foreground" />
                    <span className="font-mono">{path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {promptOpen && activeRun && (
        <Modal onClose={() => setPromptOpen(false)}>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet" />
            <h3 className="text-lg font-semibold">Run prompt</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeRun.task_title ?? "Untitled run"} ·{" "}
            {new Date(activeRun.started_at).toLocaleString()}
          </p>

          <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Input prompt
              </div>
              <pre className="mt-1.5 whitespace-pre-wrap rounded-2xl border border-border bg-background p-3 text-[12px] leading-relaxed font-mono text-foreground/90">
                {activeRun.input_prompt || "(no prompt captured)"}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Output summary
              </div>
              <p className="mt-1.5 rounded-2xl border border-border bg-background p-3 text-sm leading-relaxed text-foreground/90">
                {activeRun.output_summary || "(no output recorded yet)"}
              </p>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              onClick={() => setPromptOpen(false)}
              className="rounded-full border border-border px-4 py-1.5 text-xs hover:bg-muted"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-6 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function AgentStatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    working: "bg-sky/20 text-sky",
    waiting: "bg-amber/20 text-amber",
    error: "bg-coral/20 text-coral",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        colors[status] ?? "bg-muted"
      }`}
    >
      {status}
    </span>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-sky/20 text-sky",
    completed: "bg-mint/20 text-mint",
    recovered: "bg-amber/20 text-amber",
    failed: "bg-coral/20 text-coral",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        colors[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}
