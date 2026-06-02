import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Switch } from "@/components/ui/switch";
import { useForgeState, useResetProject } from "@/lib/client";
import {
  AlertTriangle,
  Bot,
  Brain,
  Copy,
  Link as LinkIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  Bell,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/app/settings")({
  component: SettingsScreen,
});

function SettingsScreen() {
  const { data, isLoading } = useForgeState();
  const resetProject = useResetProject();

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDangerReset, setConfirmDangerReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [notifySlack, setNotifySlack] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const project = data.project;
  const providerName: string = data.providerName ?? "AI";
  const aiAvailable: boolean = !!data.aiAvailable;
  const agents = data.agents ?? [];
  const teamMembers = (data.teamMembers ?? []) as Array<{
    id: string;
    display_name: string;
    role: string;
    is_ai: number;
  }>;

  const providerDescription = providerName.toLowerCase().includes("minimax")
    ? "MiniMax (MiniMax-Text-01 → MiniMax-M1 fallback)"
    : providerName.toLowerCase().includes("anthropic")
      ? "Anthropic (claude-sonnet-4-6 → claude-haiku-4-5 fallback)"
      : "Deterministic template responses (no LLM credentials configured)";

  async function copyInvite(memberId: string) {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      await navigator.clipboard.writeText(`${origin}/invite/${memberId}`);
      toast.success("Invite link copied");
    } catch (err) {
      toast.error("Could not copy", { description: (err as Error).message });
    }
  }

  async function copyProjectId() {
    try {
      await navigator.clipboard.writeText(project.id);
      toast.success("Project ID copied");
    } catch (err) {
      toast.error("Could not copy", { description: (err as Error).message });
    }
  }

  async function doReset(fromDangerZone: boolean) {
    setResetting(true);
    try {
      await resetProject.mutateAsync();
      toast.success("Project reset", {
        description: "Demo data has been re-seeded.",
      });
      if (fromDangerZone) setConfirmDangerReset(false);
      else setConfirmReset(false);
    } catch (err) {
      toast.error("Reset failed", { description: (err as Error).message });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader title="Settings" subtitle="Project, intelligence, team, and notifications." />

      <div className="space-y-6 p-8">
        {/* Project */}
        <section className="rounded-3xl border border-border bg-card p-6 card-hover">
          <SectionHeader
            icon={<Sparkles className="size-4 text-violet" />}
            title="Project"
            subtitle="Identity and lifecycle of this workspace's active project."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <div className="text-base font-semibold">{project.name}</div>
            </Field>
            <Field label="Status">
              <ProjectStatusPill status={project.status} />
            </Field>
            <Field label="Project ID">
              <div className="flex items-center gap-2">
                <code className="rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs text-foreground/90">
                  {project.id}
                </code>
                <button
                  onClick={copyProjectId}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <Copy className="size-3" /> Copy
                </button>
              </div>
            </Field>
            <Field label="Created">
              <div className="text-sm text-muted-foreground">
                {project.created_at ? new Date(project.created_at).toLocaleString() : "—"}
              </div>
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!confirmReset ? (
              <button
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-coral/40 bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral/20"
              >
                <RotateCcw className="size-3" /> Reset project
              </button>
            ) : (
              <div className="flex-1 rounded-xl border border-coral/40 bg-coral/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 text-coral" />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground">
                      Reset project to seeded demo state?
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This deletes all tasks, PRs, recovery events, deployments, and chat history
                      for the current project and re-seeds the Pielot Waitlist demo. This cannot be
                      undone.
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => doReset(false)}
                        disabled={resetting}
                        className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                      >
                        {resetting ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        Confirm reset
                      </button>
                      <button
                        onClick={() => setConfirmReset(false)}
                        disabled={resetting}
                        className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Intelligence */}
        <section className="rounded-3xl border border-border bg-card p-6 card-hover">
          <SectionHeader
            icon={<Brain className="size-4 text-brand" />}
            title="Intelligence"
            subtitle="Active model provider powering plan, summary, and narration calls."
          />
          <div className="mt-4 rounded-2xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex size-10 items-center justify-center squircle bg-violet/20">
                <Sparkles className="size-5 text-violet" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{providerName}</div>
                <div className="text-xs text-muted-foreground">{providerDescription}</div>
              </div>
              {aiAvailable ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-mint">
                  <span className="size-1.5 rounded-full bg-mint" /> Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-amber">
                  <span className="size-1.5 rounded-full bg-amber" /> Fallback
                </span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Switch providers via the{" "}
            <code className="rounded bg-muted px-1 font-mono">AI_PROVIDER</code> env var; see{" "}
            <code className="rounded bg-muted px-1 font-mono">.env.example</code>.
          </p>
        </section>

        {/* Team */}
        <section className="rounded-3xl border border-border bg-card p-6 card-hover">
          <SectionHeader
            icon={<Users className="size-4 text-sky" />}
            title="Team"
            subtitle="People with access to this workspace. Copy an invite link to share."
          />
          <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-background">
            {teamMembers.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No team members yet.</div>
            )}
            {teamMembers.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex size-8 items-center justify-center squircle bg-foreground/10 text-xs font-semibold text-foreground">
                  {m.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {m.display_name}
                    {m.is_ai ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet">
                        <Bot className="size-2.5" /> AI
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {m.role}
                </span>
                <button
                  onClick={() => copyInvite(m.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <LinkIcon className="size-3" /> Invite link
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Agents */}
        <section className="rounded-3xl border border-border bg-card p-6 card-hover">
          <SectionHeader
            icon={<Bot className="size-4 text-mint" />}
            title="Agents"
            subtitle="Configured models and retry policy for each agent."
            action={
              <Link
                to="/app/agents"
                className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                View agents
              </Link>
            }
          />
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Agent</th>
                  <th className="px-3 py-2 font-semibold">Primary model</th>
                  <th className="px-3 py-2 font-semibold">Fallback model</th>
                  <th className="px-3 py-2 font-semibold text-right">Retries</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(
                  (a: {
                    id: string;
                    name: string;
                    type: string;
                    model_primary: string;
                    model_fallback: string;
                    retry_count: number;
                  }) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground">{a.type}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-foreground/90">
                        {a.model_primary}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {a.model_fallback}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {a.retry_count}
                      </td>
                    </tr>
                  ),
                )}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">
                      No agents configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-3xl border border-border bg-card p-6 card-hover">
          <SectionHeader
            icon={<Bell className="size-4 text-amber" />}
            title="Notifications"
            subtitle="Pick which events ping you. Wiring coming soon."
          />
          <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-background">
            <NotificationRow
              title="Slack on task done"
              description="Post to your Slack channel when an agent finishes a task."
              checked={notifySlack}
              onChange={setNotifySlack}
            />
            <NotificationRow
              title="Email on approval needed"
              description="Get an email when a high-risk PR is waiting on you."
              checked={notifyEmail}
              onChange={setNotifyEmail}
            />
            <NotificationRow
              title="Push on deploy failure"
              description="Mobile push when a production deploy fails or rolls back."
              checked={notifyPush}
              onChange={setNotifyPush}
            />
          </div>
        </section>

        {/* Danger zone */}
        <section className="rounded-3xl border-2 border-coral/40 bg-coral/5 p-6">
          <div className="flex items-center gap-2 text-coral">
            <ShieldAlert className="size-4" />
            <h3 className="font-semibold">Danger zone</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Destructive actions. Read the fine print first.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-coral/30 bg-background p-4">
              <div className="text-sm font-semibold">Reset project data</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Wipe all tasks, PRs, deployments, and chat for this project and reseed the demo.
              </p>
              {!confirmDangerReset ? (
                <button
                  onClick={() => setConfirmDangerReset(true)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  <RotateCcw className="size-3" /> Reset project data
                </button>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => doReset(true)}
                    disabled={resetting}
                    className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                  >
                    {resetting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3" />
                    )}
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDangerReset(false)}
                    disabled={resetting}
                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-coral/30 bg-background p-4">
              <div className="text-sm font-semibold">Clear preview comments</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Remove every inline comment left on the preview page.
              </p>
              <button
                onClick={() =>
                  toast("Coming soon", {
                    description: "Bulk-clearing preview comments isn't wired up yet.",
                  })
                }
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-coral/40 bg-coral/10 px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral/20"
              >
                <Trash2 className="size-3" /> Clear preview comments
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 items-center justify-center squircle bg-foreground/5">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ProjectStatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    building: "bg-sky/20 text-sky",
    ready: "bg-mint/20 text-mint",
    live: "bg-mint/20 text-mint",
    paused: "bg-amber/20 text-amber",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${colors[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function NotificationRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
