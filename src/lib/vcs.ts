/**
 * Git-like primitives for ForgeCloud (vibecoding edition).
 * Branches, commits, and worktrees are all modeled in SQLite. None of this
 * touches a real git repo — the goal is to give non-technical users a familiar
 * mental model ("branches I'm working on", "commits I've shipped") without
 * exposing them to porcelain commands.
 */
import { randomBytes } from "node:crypto";
import { getDb, type Branch, type Commit, type Notification, type Worktree } from "./db";
import { ids } from "./seed";

export function newSha(): string {
  return randomBytes(4).toString("hex"); // 8 hex chars, matches the GitHub-style abbreviation
}

// ---------- branches --------------------------------------------------------

export function listBranches(projectId: string): Branch[] {
  return getDb()
    .prepare("SELECT * FROM branches WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Branch[];
}

export function getBranch(branchId: string): Branch | undefined {
  return getDb().prepare("SELECT * FROM branches WHERE id = ?").get(branchId) as Branch | undefined;
}

export function findOrCreateBranchByName(
  projectId: string,
  name: string,
  agentId: string | null,
  prId: string | null = null,
): Branch {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM branches WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Branch | undefined;
  if (existing) {
    if (prId && !existing.head_pr_id) {
      db.prepare("UPDATE branches SET head_pr_id = ? WHERE id = ?").run(prId, existing.id);
    }
    return getBranch(existing.id)!;
  }
  const id = `branch-${ids.newPR().slice(3)}`; // reuse uuid generator with branch- prefix
  db.prepare(
    `INSERT INTO branches (id, project_id, name, base_branch, head_pr_id, status, created_by_agent_id) VALUES (?, ?, ?, 'main', ?, 'active', ?)`,
  ).run(id, projectId, name, prId, agentId);
  return getBranch(id)!;
}

export function mergeBranch(branchId: string): Branch | undefined {
  const db = getDb();
  db.prepare(
    `UPDATE branches SET status = 'merged', merged_at = ? WHERE id = ?`,
  ).run(Date.now(), branchId);
  return getBranch(branchId);
}

export function archiveBranch(branchId: string): Branch | undefined {
  const db = getDb();
  db.prepare(`UPDATE branches SET status = 'archived' WHERE id = ?`).run(branchId);
  return getBranch(branchId);
}

// ---------- commits ---------------------------------------------------------

export function listCommits(projectId: string, branchId?: string): Commit[] {
  const db = getDb();
  if (branchId) {
    return db
      .prepare(
        "SELECT * FROM commits WHERE project_id = ? AND branch_id = ? ORDER BY created_at DESC",
      )
      .all(projectId, branchId) as Commit[];
  }
  return db
    .prepare("SELECT * FROM commits WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Commit[];
}

export function recordCommit(opts: {
  projectId: string;
  branchId: string | null;
  prId: string | null;
  message: string;
  author: string;
  filesChanged?: number;
}): Commit {
  const db = getDb();
  const id = `commit-${ids.newPR().slice(3)}`;
  const sha = newSha();
  db.prepare(
    `INSERT INTO commits (id, project_id, branch_id, pr_id, sha, message, author, files_changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.projectId,
    opts.branchId,
    opts.prId,
    sha,
    opts.message,
    opts.author,
    opts.filesChanged ?? 0,
  );
  return db.prepare("SELECT * FROM commits WHERE id = ?").get(id) as Commit;
}

// ---------- worktrees -------------------------------------------------------

export function listWorktrees(projectId: string): Worktree[] {
  return getDb()
    .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Worktree[];
}

export function spawnWorktree(opts: {
  projectId: string;
  branchId: string | null;
  name: string;
  assignedAgentId?: string | null;
  previewUrl?: string;
}): Worktree {
  const db = getDb();
  const id = `wt-${ids.newPR().slice(3)}`;
  db.prepare(
    `INSERT INTO worktrees (id, project_id, branch_id, name, status, assigned_agent_id, preview_url) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, opts.projectId, opts.branchId, opts.name, opts.assignedAgentId ?? null, opts.previewUrl ?? null);
  return db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id) as Worktree;
}

export function archiveWorktree(worktreeId: string): Worktree | undefined {
  const db = getDb();
  db.prepare(`UPDATE worktrees SET status = 'archived' WHERE id = ?`).run(worktreeId);
  return db.prepare("SELECT * FROM worktrees WHERE id = ?").get(worktreeId) as Worktree | undefined;
}

// ---------- notifications ---------------------------------------------------

export type NotificationKind =
  | "task_created"
  | "task_done"
  | "pr_opened"
  | "pr_approved"
  | "pr_rolled_back"
  | "approval_needed"
  | "secret_blocked"
  | "deploy_live"
  | "deploy_failed"
  | "recovery"
  | "comment"
  | "system";

export function createNotification(opts: {
  workspaceId: string;
  projectId?: string | null;
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
}): Notification {
  const db = getDb();
  const id = `notif-${ids.newPR().slice(3)}`;
  db.prepare(
    `INSERT INTO notifications (id, workspace_id, project_id, user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.workspaceId,
    opts.projectId ?? null,
    opts.userId ?? null,
    opts.kind,
    opts.title,
    opts.body ?? null,
    opts.link ?? null,
  );
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as Notification;
}

export function listNotifications(workspaceId: string, limit = 50): Notification[] {
  return getDb()
    .prepare(
      "SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(workspaceId, limit) as Notification[];
}

export function unreadCount(workspaceId: string): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE workspace_id = ? AND read_at IS NULL",
    )
    .get(workspaceId) as { n: number };
  return row.n;
}

export function markNotificationRead(notificationId: string): void {
  getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE id = ?")
    .run(Date.now(), notificationId);
}

export function markAllRead(workspaceId: string): void {
  getDb()
    .prepare(
      "UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL",
    )
    .run(Date.now(), workspaceId);
}
