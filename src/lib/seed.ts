import { getDb, type User, type Workspace } from "./db";
import { randomUUID } from "node:crypto";

const DEFAULT_USER_ID = "user-animesh";
const DEFAULT_WORKSPACE_ID = "ws-default";

export function ensureSeed(): { user: User; workspace: Workspace } {
  const db = getDb();
  const existingUser = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(DEFAULT_USER_ID) as User | undefined;
  if (existingUser) {
    const existingWs = db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(DEFAULT_WORKSPACE_ID) as Workspace;
    return { user: existingUser, workspace: existingWs };
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, email, avatar_url, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_USER_ID,
    "Animesh",
    "animesh@forgecloud.dev",
    null,
    "owner",
    now,
  );

  db.prepare(
    `INSERT INTO workspaces (id, name, owner_id, plan, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_WORKSPACE_ID,
    "Animesh's Workspace",
    DEFAULT_USER_ID,
    "pro",
    now,
  );

  const teamMembers: Array<[string, string, string, string, number]> = [
    ["tm-animesh", DEFAULT_WORKSPACE_ID, "Animesh", "owner", 0],
    ["tm-sarah", DEFAULT_WORKSPACE_ID, "Sarah", "reviewer", 0],
    ["tm-david", DEFAULT_WORKSPACE_ID, "David", "reviewer", 0],
  ];
  const insertTm = db.prepare(
    `INSERT INTO team_members (id, workspace_id, display_name, role, is_ai, permissions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [id, ws, name, role, isAi] of teamMembers) {
    insertTm.run(id, ws, name, role, isAi, JSON.stringify(["approve", "request", "view"]));
  }

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(DEFAULT_USER_ID) as User;
  const workspace = db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(DEFAULT_WORKSPACE_ID) as Workspace;
  return { user, workspace };
}

export const ids = {
  user: DEFAULT_USER_ID,
  workspace: DEFAULT_WORKSPACE_ID,
  newProject: () => `proj-${randomUUID()}`,
  newAgent: () => `agent-${randomUUID()}`,
  newTask: () => `task-${randomUUID()}`,
  newPR: () => `pr-${randomUUID()}`,
  newChange: () => `chg-${randomUUID()}`,
  newRun: () => `run-${randomUUID()}`,
  newRecovery: () => `rec-${randomUUID()}`,
  newDeployment: () => `dep-${randomUUID()}`,
  newApproval: () => `apr-${randomUUID()}`,
  newMessage: () => `msg-${randomUUID()}`,
  newComment: () => `cmt-${randomUUID()}`,
};
