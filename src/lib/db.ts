import type Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.INSFORGE_DB_PATH
  ? resolve(process.env.INSFORGE_DB_PATH)
  : resolve(process.cwd(), ".data", "forgecloud.sqlite");

let _db: Database.Database | null = null;

export function getDbPath(): string {
  return DB_PATH;
}

// Use createRequire to load the native module from a CJS context.
// Top-level await with a dynamic import would force this module to be async,
// which would ripple through every call site that imports it.
const nodeRequire = createRequire(typeof __filename !== "undefined" ? __filename : import.meta.url);

export function getDb(): Database.Database {
  if (_db) return _db;
  // Dynamic require so client bundles never see the native module.
  const DatabaseCtor = nodeRequire("better-sqlite3") as typeof import("better-sqlite3");
  if (!existsSync(dirname(DB_PATH))) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }
  _db = new DatabaseCtor(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_prefs (
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (workspace_id, key),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS auth_login_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      requested_ip TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      revoked_at INTEGER,
      user_agent TEXT,
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'building',
      repo_url TEXT,
      cloudflare_project_id TEXT,
      insforge_project_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      is_ai INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      current_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model_primary TEXT NOT NULL DEFAULT 'MiniMax-Text-01',
      model_fallback TEXT NOT NULL DEFAULT 'MiniMax-M1',
      last_action TEXT,
      last_action_at INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'med',
      risk_level TEXT NOT NULL DEFAULT 'low',
      requester_id TEXT,
      requester_name TEXT,
      assigned_agent_id TEXT,
      reviewer_id TEXT,
      reviewer_name TEXT,
      linked_pr_id TEXT,
      preview_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      risk_level TEXT NOT NULL DEFAULT 'low',
      source_branch TEXT NOT NULL,
      target_branch TEXT NOT NULL DEFAULT 'main',
      preview_url TEXT,
      screenshot_url TEXT,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      approver_name TEXT,
      approved_at INTEGER,
      merged_at INTEGER,
      rolled_back_at INTEGER,
      rolled_back_by TEXT,
      created_by_agent_id TEXT,
      files_changed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY,
      pr_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      technical_diff TEXT,
      plain_english_summary TEXT NOT NULL,
      risk_explanation TEXT,
      agent_id TEXT,
      FOREIGN KEY (pr_id) REFERENCES pull_requests(id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      input_prompt TEXT NOT NULL,
      output_summary TEXT,
      model_used TEXT,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS runtime_checks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      task_id TEXT,
      check_type TEXT NOT NULL,
      status TEXT NOT NULL,
      command TEXT,
      exit_code INTEGER,
      stdout TEXT,
      stderr TEXT,
      summary TEXT NOT NULL,
      artifact_path TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
    );

    CREATE TABLE IF NOT EXISTS rocketride_workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      mode TEXT NOT NULL DEFAULT 'local',
      external_run_id TEXT,
      task_id TEXT,
      pr_id TEXT,
      deployment_id TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      workspace_id TEXT,
      user_id TEXT,
      route TEXT NOT NULL,
      method TEXT NOT NULL,
      permission TEXT,
      outcome TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      error TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS workspace_usage_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS recovery_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_run_id TEXT,
      failure_type TEXT NOT NULL,
      failure_message TEXT NOT NULL,
      recovery_action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recovered',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      linked_task_id TEXT,
      linked_pr_id TEXT,
      linked_deployment_id TEXT,
      tool TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      linked_task_id TEXT,
      linked_pr_id TEXT,
      confidence TEXT NOT NULL DEFAULT 'stored',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pr_id TEXT,
      environment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      cloudflare_url TEXT,
      railway_url TEXT,
      build_logs TEXT,
      rollback_target_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pr_id TEXT,
      reason TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approver_name TEXT,
      decided_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS preview_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pr_id TEXT,
      selector TEXT,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      read_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_branch TEXT NOT NULL DEFAULT 'main',
      head_pr_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_agent_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      merged_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS commits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      branch_id TEXT,
      pr_id TEXT,
      sha TEXT NOT NULL,
      message TEXT NOT NULL,
      author TEXT NOT NULL,
      files_changed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      branch_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_agent_id TEXT,
      preview_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      account_label TEXT,
      icon TEXT,
      source TEXT NOT NULL DEFAULT 'composio',
      toolkit_slug TEXT,
      auth_config_id TEXT,
      external_account_id TEXT,
      connect_url TEXT,
      sync_status TEXT,
      sync_detail TEXT,
      connected_at INTEGER,
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS discoveries (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      connection_id TEXT,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      detail TEXT,
      count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'composio',
      external_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS suggested_apps (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      uses_connections TEXT NOT NULL DEFAULT '[]',
      sample_features TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'composio',
      evidence TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_auth_login_codes_email ON auth_login_codes(email, workspace_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, workspace_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_prs_project ON pull_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_project ON recovery_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_ws ON notifications(workspace_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_branches_project ON branches(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_commits_branch ON commits(branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_runtime_checks_run ON runtime_checks(agent_run_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_rocketride_project ON rocketride_workflow_runs(project_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_workspace ON workspace_usage_events(workspace_id, kind, created_at);
  `);

  // Additive migrations for columns added after the initial schema. Run these
  // after CREATE TABLE so a brand-new SQLite file can boot cleanly.
  const addColumn = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (!(e as Error).message.includes("duplicate column")) throw e;
    }
  };
  addColumn("pull_requests", "merged_at", "INTEGER");
  addColumn("pull_requests", "rolled_back_at", "INTEGER");
  addColumn("pull_requests", "rolled_back_by", "TEXT");
  addColumn("pull_requests", "screenshot_url", "TEXT");
  addColumn("workspaces", "billing_status", "TEXT NOT NULL DEFAULT 'active'");
  addColumn("connections", "source", "TEXT NOT NULL DEFAULT 'composio'");
  addColumn("connections", "toolkit_slug", "TEXT");
  addColumn("connections", "auth_config_id", "TEXT");
  addColumn("connections", "external_account_id", "TEXT");
  addColumn("connections", "connect_url", "TEXT");
  addColumn("connections", "sync_status", "TEXT");
  addColumn("connections", "sync_detail", "TEXT");
  addColumn("connections", "last_synced_at", "INTEGER");
  addColumn("discoveries", "source", "TEXT NOT NULL DEFAULT 'composio'");
  addColumn("discoveries", "external_id", "TEXT");
  addColumn("suggested_apps", "source", "TEXT NOT NULL DEFAULT 'composio'");
  addColumn("suggested_apps", "evidence", "TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    UPDATE pull_requests
       SET merged_at = COALESCE(merged_at, approved_at)
     WHERE status = 'approved' AND approved_at IS NOT NULL
  `);
}

export type User = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  created_at: number;
};

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  billing_status: string;
  created_at: number;
};

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: string;
  repo_url: string | null;
  cloudflare_project_id: string | null;
  insforge_project_id: string | null;
  created_at: number;
};

export type TeamMember = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  display_name: string;
  role: string;
  permissions: string;
  is_ai: number;
};

export type AuthLoginCode = {
  id: string;
  email: string;
  workspace_id: string;
  code_hash: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
  requested_ip: string | null;
};

export type AuthSession = {
  id: string;
  user_id: string;
  workspace_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  user_agent: string | null;
  ip_address: string | null;
};

export type Agent = {
  id: string;
  project_id: string;
  name: string;
  type: string;
  role: string;
  permissions: string;
  current_task_id: string | null;
  status: string;
  model_primary: string;
  model_fallback: string;
  last_action: string | null;
  last_action_at: number | null;
  retry_count: number;
  created_at: number;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  risk_level: string;
  requester_id: string | null;
  requester_name: string | null;
  assigned_agent_id: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  linked_pr_id: string | null;
  preview_url: string | null;
  created_at: number;
};

export type PullRequest = {
  id: string;
  project_id: string;
  task_id: string | null;
  number: number;
  title: string;
  summary: string;
  status: string;
  risk_level: string;
  source_branch: string;
  target_branch: string;
  preview_url: string | null;
  screenshot_url: string | null;
  requires_approval: number;
  approver_name: string | null;
  approved_at: number | null;
  merged_at: number | null;
  rolled_back_at: number | null;
  rolled_back_by: string | null;
  created_by_agent_id: string | null;
  files_changed: number;
  created_at: number;
};

export type Change = {
  id: string;
  pr_id: string;
  file_path: string;
  technical_diff: string | null;
  plain_english_summary: string;
  risk_explanation: string | null;
  agent_id: string | null;
};

export type AgentRun = {
  id: string;
  project_id: string;
  agent_id: string;
  task_id: string | null;
  status: string;
  input_prompt: string;
  output_summary: string | null;
  model_used: string | null;
  fallback_used: number;
  started_at: number;
  completed_at: number | null;
};

export type RuntimeCheck = {
  id: string;
  project_id: string;
  agent_run_id: string;
  task_id: string | null;
  check_type: string;
  status: string;
  command: string | null;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  summary: string;
  artifact_path: string | null;
  started_at: number;
  completed_at: number | null;
};

export type RocketRideWorkflowRun = {
  id: string;
  project_id: string;
  workflow_type: string;
  status: string;
  mode: string;
  external_run_id: string | null;
  task_id: string | null;
  pr_id: string | null;
  deployment_id: string | null;
  input_json: string | null;
  output_json: string | null;
  error: string | null;
  started_at: number;
  completed_at: number | null;
};

export type AuditEvent = {
  id: string;
  request_id: string;
  workspace_id: string | null;
  user_id: string | null;
  route: string;
  method: string;
  permission: string | null;
  outcome: string;
  status_code: number;
  error: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
};

export type WorkspaceUsageEvent = {
  id: string;
  workspace_id: string;
  kind: string;
  quantity: number;
  metadata: string | null;
  created_at: number;
};

export type RecoveryEvent = {
  id: string;
  project_id: string;
  agent_run_id: string | null;
  failure_type: string;
  failure_message: string;
  recovery_action: string;
  status: string;
  created_at: number;
};

export type Deployment = {
  id: string;
  project_id: string;
  pr_id: string | null;
  environment: string;
  status: string;
  cloudflare_url: string | null;
  railway_url: string | null;
  build_logs: string | null;
  rollback_target_id: string | null;
  created_at: number;
};

export type Approval = {
  id: string;
  project_id: string;
  pr_id: string | null;
  reason: string;
  risk_level: string;
  details: string;
  status: string;
  approver_name: string | null;
  decided_at: number | null;
  created_at: number;
};

export type ChatMessage = {
  id: string;
  project_id: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: number;
};

export type PreviewComment = {
  id: string;
  project_id: string;
  pr_id: string | null;
  selector: string | null;
  text: string;
  status: string;
  created_at: number;
};

export type Notification = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: number | null;
  created_at: number;
};

export type Branch = {
  id: string;
  project_id: string;
  name: string;
  base_branch: string;
  head_pr_id: string | null;
  status: string;
  created_by_agent_id: string | null;
  created_at: number;
  merged_at: number | null;
};

export type Commit = {
  id: string;
  project_id: string;
  branch_id: string | null;
  pr_id: string | null;
  sha: string;
  message: string;
  author: string;
  files_changed: number;
  created_at: number;
};

export type Worktree = {
  id: string;
  project_id: string;
  branch_id: string | null;
  name: string;
  status: string;
  assigned_agent_id: string | null;
  preview_url: string | null;
  created_at: number;
};

export type Connection = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  status: string; // 'available' | 'connected' | 'error'
  account_label: string | null;
  icon: string | null;
  source: string;
  toolkit_slug: string | null;
  auth_config_id: string | null;
  external_account_id: string | null;
  connect_url: string | null;
  sync_status: string | null;
  sync_detail: string | null;
  connected_at: number | null;
  last_synced_at: number | null;
  created_at: number;
};

export type Discovery = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  connection_id: string | null;
  provider: string;
  label: string;
  detail: string | null;
  count: number;
  source: string;
  external_id: string | null;
  created_at: number;
};

export type SuggestedApp = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  uses_connections: string; // JSON array of provider strings
  sample_features: string; // JSON array of strings
  source: string;
  evidence: string; // JSON array of strings
  created_at: number;
};
