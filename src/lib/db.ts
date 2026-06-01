import type Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.INSFORGE_DB_PATH
  ? resolve(process.env.INSFORGE_DB_PATH)
  : resolve(process.cwd(), ".data", "forgecloud.sqlite");

let _db: Database.Database | null = null;

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
      model_primary TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      model_fallback TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
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
      requires_approval INTEGER NOT NULL DEFAULT 0,
      approver_name TEXT,
      approved_at INTEGER,
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

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
    CREATE INDEX IF NOT EXISTS idx_prs_project ON pull_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_recovery_project ON recovery_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id);
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
  requires_approval: number;
  approver_name: string | null;
  approved_at: number | null;
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
