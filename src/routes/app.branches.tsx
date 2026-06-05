import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  GitBranch,
  GitMerge,
  Archive,
  Loader2,
  AlertTriangle,
  ExternalLink,
  GitCommit,
  Plus,
  Bot,
  FileCode2,
  Eye,
  Box,
} from "lucide-react";
import { useForgeState, useMergeBranch, useArchiveBranch, useSpawnWorktree } from "@/lib/client";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/branches")({
  component: BranchesScreen,
});

type Branch = {
  id: string;
  project_id: string;
  name: string;
  base_branch: string;
  head_pr_id: string | null;
  status: "active" | "merged" | "archived";
  created_by_agent_id: string | null;
  created_at: number;
  merged_at: number | null;
};

type Commit = {
  id: string;
  branch_id: string;
  pr_id: string | null;
  sha: string;
  message: string;
  author: string;
  files_changed: number;
  created_at: number;
};

type Worktree = {
  id: string;
  branch_id: string;
  name: string;
  status: string;
  assigned_agent_id: string | null;
  preview_url: string | null;
  created_at: number;
};

type Agent = { id: string; name: string; role?: string };
type PR = { id: string; number: number; title: string };

function relativeTime(ms: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function BranchesScreen() {
  const { data, isLoading } = useForgeState();
  const mergeBranch = useMergeBranch();
  const archiveBranch = useArchiveBranch();
  const spawnWorktree = useSpawnWorktree();

  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [wtOpenFor, setWtOpenFor] = useState<string | null>(null);
  const [wtNameDraft, setWtNameDraft] = useState<Record<string, string>>({});
  const [highlightedBranchId, setHighlightedBranchId] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const branches: Branch[] = data.branches ?? [];
  const commits: Commit[] = data.commits ?? [];
  const worktrees: Worktree[] = data.worktrees ?? [];
  const agents: Agent[] = data.agents ?? [];
  const prs: PR[] = data.prs ?? [];

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const prMap = new Map(prs.map((p) => [p.id, p]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  const activeBranches = branches.filter((b) => b.status === "active");
  const mergedBranches = branches.filter((b) => b.status === "merged");
  const activeWorktrees = worktrees.filter((w) => w.status === "active");

  const sortedCommits = [...commits].sort((a, b) => b.created_at - a.created_at);

  async function onMerge(branchId: string) {
    setBusyBranchId(branchId);
    try {
      await mergeBranch.mutateAsync({ branchId });
      toast.success("Branch merged", {
        description: "A merge commit was recorded.",
      });
    } catch (err) {
      toast.error("Merge failed", { description: (err as Error).message });
    } finally {
      setBusyBranchId(null);
    }
  }

  async function onArchive(branchId: string) {
    setBusyBranchId(branchId);
    try {
      await archiveBranch.mutateAsync({ branchId });
      toast.success("Branch archived");
      setConfirmArchiveId(null);
    } catch (err) {
      toast.error("Archive failed", { description: (err as Error).message });
    } finally {
      setBusyBranchId(null);
    }
  }

  async function onSpawn(branch: Branch) {
    const name = (wtNameDraft[branch.id] ?? `wt/${branch.name}`).trim();
    if (!name) {
      toast.error("Worktree name is required");
      return;
    }
    setBusyBranchId(branch.id);
    try {
      await spawnWorktree.mutateAsync({ branchId: branch.id, name });
      toast.success("Worktree spawned", { description: name });
      setWtOpenFor(null);
      setWtNameDraft((d) => ({ ...d, [branch.id]: "" }));
    } catch (err) {
      toast.error("Spawn failed", { description: (err as Error).message });
    } finally {
      setBusyBranchId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Branches & commits"
        subtitle="Every parallel piece of work has its own branch, commits, and a sandbox preview."
      />

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Active branches"
            value={activeBranches.length}
            tint="sky"
            Icon={GitBranch}
          />
          <StatCard
            label="Merged branches"
            value={mergedBranches.length}
            tint="mint"
            Icon={GitMerge}
          />
          <StatCard label="Total commits" value={commits.length} tint="violet" Icon={GitCommit} />
          <StatCard
            label="Active worktrees"
            value={activeWorktrees.length}
            tint="amber"
            Icon={Box}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* LEFT — Branches */}
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Branches</h3>
            {branches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No branches yet. Agents create branches when they pick up tasks.
              </div>
            ) : (
              branches.map((b) => {
                const agent = b.created_by_agent_id
                  ? agentMap.get(b.created_by_agent_id)
                  : undefined;
                const commitCount = commits.filter((c) => c.branch_id === b.id).length;
                const pr = b.head_pr_id ? prMap.get(b.head_pr_id) : undefined;
                const isHighlighted = highlightedBranchId === b.id;
                const confirming = confirmArchiveId === b.id;
                const wtOpen = wtOpenFor === b.id;
                const busy = busyBranchId === b.id;

                return (
                  <div
                    key={b.id}
                    id={`branch-${b.id}`}
                    className={`rounded-3xl border bg-card p-5 card-hover transition-all duration-200 ${
                      isHighlighted ? "border-brand ring-2 ring-brand/20" : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <GitBranch className="size-4 text-muted-foreground" />
                      <span className="font-mono text-sm font-semibold">{b.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ← <span className="font-mono">{b.base_branch}</span>
                      </span>
                      <BranchStatusPill status={b.status} />
                      <span className="ml-auto text-xs text-muted-foreground">
                        {relativeTime(b.created_at)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {agent && (
                        <span className="inline-flex items-center gap-1">
                          <Bot className="size-3" />
                          {agent.name}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <GitCommit className="size-3" />
                        {commitCount} commit{commitCount !== 1 ? "s" : ""}
                      </span>
                      {pr && (
                        <Link
                          to="/app/changes"
                          className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-foreground hover:bg-foreground/10 transition-colors"
                        >
                          <span className="font-mono">PR #{pr.number}</span>
                          <span className="max-w-[180px] truncate">— {pr.title}</span>
                        </Link>
                      )}
                    </div>

                    {b.status === "active" && (
                      <>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => onMerge(b.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:brightness-105 transition-all disabled:opacity-40"
                          >
                            {busy && mergeBranch.isPending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <GitMerge className="size-3" />
                            )}
                            Merge
                          </button>
                          <button
                            onClick={() => setConfirmArchiveId(b.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40"
                          >
                            <Archive className="size-3" />
                            Archive
                          </button>
                          <button
                            onClick={() => {
                              setWtOpenFor(wtOpen ? null : b.id);
                              if (!wtOpen && !wtNameDraft[b.id]) {
                                setWtNameDraft((d) => ({
                                  ...d,
                                  [b.id]: `wt/${b.name}`,
                                }));
                              }
                            }}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40"
                          >
                            <Plus className="size-3" />
                            Spawn worktree
                          </button>
                        </div>

                        {confirming && (
                          <div className="mt-3 rounded-xl border border-coral/40 bg-coral/5 p-3">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 size-4 text-coral" />
                              <div className="flex-1">
                                <div className="text-sm font-semibold">Archive {b.name}?</div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  The branch will be hidden from active work. Commits stay in the
                                  history.
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                  <button
                                    onClick={() => onArchive(b.id)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                                  >
                                    {busy ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <Archive className="size-3" />
                                    )}
                                    Confirm archive
                                  </button>
                                  <button
                                    onClick={() => setConfirmArchiveId(null)}
                                    disabled={busy}
                                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {wtOpen && (
                          <div className="mt-3 rounded-xl border border-border bg-background p-3">
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                              <Box className="size-3" /> Worktree name
                            </label>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                value={wtNameDraft[b.id] ?? `wt/${b.name}`}
                                onChange={(e) =>
                                  setWtNameDraft((d) => ({
                                    ...d,
                                    [b.id]: e.target.value,
                                  }))
                                }
                                placeholder={`wt/${b.name}`}
                                className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs focus:border-brand focus:outline-none"
                              />
                              <button
                                onClick={() => onSpawn(b)}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-40"
                              >
                                {busy ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Plus className="size-3" />
                                )}
                                Spawn
                              </button>
                              <button
                                onClick={() => setWtOpenFor(null)}
                                disabled={busy}
                                className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* RIGHT — Commit history */}
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Commit history</h3>
            {sortedCommits.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                No commits yet.
              </div>
            ) : (
              <div className="rounded-3xl border border-border bg-card divide-y divide-border">
                {sortedCommits.map((c) => {
                  const branch = branchMap.get(c.branch_id);
                  return (
                    <div key={c.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <GitCommit className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                              {c.sha.slice(0, 7)}
                            </span>
                            <span className="text-muted-foreground">{c.author}</span>
                            {branch && (
                              <a
                                href={`#branch-${branch.id}`}
                                onMouseEnter={() => setHighlightedBranchId(branch.id)}
                                onMouseLeave={() => setHighlightedBranchId(null)}
                                className="inline-flex items-center gap-1 rounded-full bg-sky/10 px-2 py-0.5 font-mono text-sky hover:bg-sky/20 transition-colors"
                              >
                                <GitBranch className="size-3" />
                                {branch.name}
                              </a>
                            )}
                            <span className="ml-auto text-muted-foreground">
                              {relativeTime(c.created_at)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm text-foreground/90">{c.message}</p>
                          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <FileCode2 className="size-3" />
                            {c.files_changed} file
                            {c.files_changed !== 1 ? "s" : ""} changed
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Worktrees */}
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Worktrees</h3>
          {activeWorktrees.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No active sandboxes. Spawn one from a branch to get a preview URL.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {activeWorktrees.map((w) => {
                const branch = branchMap.get(w.branch_id);
                const agent = w.assigned_agent_id ? agentMap.get(w.assigned_agent_id) : undefined;
                return (
                  <div
                    key={w.id}
                    className="rounded-3xl border border-border bg-card p-5 card-hover"
                  >
                    <div className="flex items-center gap-2">
                      <Box className="size-4 text-amber" />
                      <span className="font-mono text-sm font-semibold truncate">{w.name}</span>
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                      {branch && (
                        <div className="inline-flex items-center gap-1">
                          <GitBranch className="size-3" />
                          <span className="font-mono">{branch.name}</span>
                        </div>
                      )}
                      {agent && (
                        <div className="inline-flex items-center gap-1">
                          <Bot className="size-3" />
                          {agent.name}
                        </div>
                      )}
                      <div className="text-[11px]">Spawned {relativeTime(w.created_at)}</div>
                    </div>
                    {w.preview_url && (
                      <a
                        href={w.preview_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                      >
                        <Eye className="size-3" />
                        Open preview
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tint,
  Icon,
}: {
  label: string;
  value: number;
  tint: "sky" | "mint" | "violet" | "amber";
  Icon: typeof GitBranch;
}) {
  const tints: Record<string, string> = {
    sky: "bg-sky/10 text-sky",
    mint: "bg-mint/10 text-mint",
    violet: "bg-violet/10 text-violet",
    amber: "bg-amber/10 text-amber",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 card-hover">
      <div className="flex items-center gap-2">
        <div className={`flex size-7 items-center justify-center rounded-lg ${tints[tint]}`}>
          <Icon className="size-4" />
        </div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function BranchStatusPill({ status }: { status: Branch["status"] }) {
  const colors: Record<Branch["status"], string> = {
    active: "bg-sky/20 text-sky",
    merged: "bg-mint/20 text-mint",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[status]}`}
    >
      {status}
    </span>
  );
}
