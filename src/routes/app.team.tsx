import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Users, Bot, Loader2, UserPlus, Trash2, X, Check } from "lucide-react";
import { useForgeState, useAddTeamMember, useRemoveTeamMember } from "@/lib/client";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/team")({
  component: TeamScreen,
});

const AI_ROLES = [
  { name: "Frontend Agent", permissions: "Edit frontend files", approval: "Production deploy" },
  { name: "Backend Agent", permissions: "Build APIs + database", approval: "Database migrations" },
  { name: "Auth Agent", permissions: "Edit auth files", approval: "Auth changes" },
  { name: "DevOps Agent", permissions: "Build preview deploys", approval: "Production deploy" },
  {
    name: "Safety Agent",
    permissions: "Block risky actions",
    approval: "Cannot be overridden except by owner",
  },
];

const HUMAN_ROLES = [
  { role: "Owner", perms: "Everything" },
  { role: "Admin", perms: "Manage team, approve deploys" },
  { role: "Builder", perms: "Request features, review previews" },
  { role: "Reviewer", perms: "Approve assigned PRs" },
  { role: "Viewer", perms: "View progress only" },
];

const ROLE_OPTIONS = ["admin", "manager", "staff", "reviewer", "viewer"] as const;

type TeamMemberRow = {
  id: string;
  display_name: string;
  role: string;
  is_ai: number;
};

type AgentRow = {
  id: string;
  name: string;
  type: string;
  role: string;
};

function TeamScreen() {
  const { data, isLoading } = useForgeState();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof ROLE_OPTIONS)[number]>("staff");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const humans = (data.teamMembers as TeamMemberRow[]).filter((m) => !m.is_ai);
  const aiMembers = data.agents as AgentRow[];

  async function submitInvite() {
    const name = inviteName.trim();
    if (!name) return;
    try {
      await addMember.mutateAsync({ displayName: name, role: inviteRole });
      toast.success(`Invited ${name} as ${inviteRole}`);
      setInviteName("");
      setInviteRole("staff");
      setShowInvite(false);
    } catch (err) {
      toast.error("Couldn't invite member", { description: (err as Error).message });
    }
  }

  async function confirmRemove(memberId: string, displayName: string) {
    try {
      await removeMember.mutateAsync({ memberId });
      toast.success(`Removed ${displayName}`);
      setConfirmingRemoveId(null);
    } catch (err) {
      toast.error("Couldn't remove member", { description: (err as Error).message });
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Team"
        subtitle="Humans and AI agents, working together."
        action={
          <button
            onClick={() => setShowInvite((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all " +
              (showInvite
                ? "bg-foreground text-background hover:opacity-90"
                : "border border-border bg-card hover:bg-muted")
            }
          >
            {showInvite ? <X className="size-3" /> : <UserPlus className="size-3" />}
            {showInvite ? "Cancel" : "Invite member"}
          </button>
        }
      />

      <div className="space-y-8 p-8">
        {showInvite && (
          <div className="rounded-2xl border border-border bg-card p-5 card-hover">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Invite a team member</h3>
              <span className="text-[11px] text-muted-foreground">
                They'll show up across the workspace as a reviewer / approver.
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Display name (e.g. Jamie Chen)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitInvite();
                  }
                }}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
              <button
                onClick={submitInvite}
                disabled={!inviteName.trim() || addMember.isPending}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:brightness-105 disabled:opacity-40"
              >
                {addMember.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <UserPlus className="size-3" />
                )}
                Invite
              </button>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-4 text-lg font-semibold">
            Humans{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{humans.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {humans.map((m) => {
              const colors = [
                "var(--violet)",
                "var(--coral)",
                "var(--sky)",
                "var(--mint)",
                "var(--amber)",
              ];
              const color = colors[m.display_name.charCodeAt(0) % colors.length];
              const isOwner = m.role === "owner" || m.id === "tm-sal";
              const isConfirming = confirmingRemoveId === m.id;
              return (
                <div key={m.id} className="rounded-2xl border border-border bg-card p-5 card-hover">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 items-center justify-center squircle text-sm font-semibold text-white"
                      style={{ background: color }}
                    >
                      {m.display_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{m.display_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                    </div>
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {m.role}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Can request features, review changes, approve assigned PRs.
                  </div>
                  {!isOwner && (
                    <div className="mt-3 flex items-center justify-end gap-1.5">
                      {isConfirming ? (
                        <>
                          <button
                            onClick={() => setConfirmingRemoveId(null)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
                          >
                            <X className="size-3" /> Cancel
                          </button>
                          <button
                            onClick={() => confirmRemove(m.id, m.display_name)}
                            disabled={removeMember.isPending}
                            className="inline-flex items-center gap-1 rounded-lg bg-coral px-2 py-1 text-[11px] font-semibold text-white hover:brightness-105 disabled:opacity-40"
                          >
                            {removeMember.isPending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Check className="size-3" />
                            )}
                            Confirm
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmingRemoveId(m.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-coral"
                          title={`Remove ${m.display_name}`}
                        >
                          <Trash2 className="size-3" /> Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">
            AI agents{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {aiMembers.length}
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aiMembers.map((a) => {
              const def = AI_ROLES.find((r) => r.name === a.name);
              const colors: Record<string, string> = {
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
              const color = colors[a.type] ?? "var(--violet)";
              return (
                <Link
                  key={a.id}
                  to="/app/agents/$agentId"
                  params={{ agentId: a.id }}
                  className="block rounded-2xl border border-border bg-card p-5 card-hover hover:border-brand/40 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 items-center justify-center squircle"
                      style={{ background: color }}
                    >
                      <Bot className="size-5 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.type}</div>
                    </div>
                    <span className="ml-auto rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet">
                      AI
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs">
                    <div className="text-muted-foreground">
                      <span className="text-foreground">{def?.permissions ?? a.role}</span>
                    </div>
                    {def?.approval && (
                      <div className="text-amber">Needs approval: {def.approval}</div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Permission model</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">Human roles</div>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {HUMAN_ROLES.map((r) => (
                    <tr key={r.role} className="border-t border-border">
                      <td className="py-2 font-medium">{r.role}</td>
                      <td className="py-2 text-muted-foreground">{r.perms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-3xl border border-border bg-card p-6 card-hover">
              <div className="text-sm font-medium text-muted-foreground">
                Simple, legible permissions
              </div>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-mint" /> Can request features
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-mint" /> Can approve changes
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-mint" /> Can deploy
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-mint" /> Can edit data
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-mint" /> Can manage agents
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
