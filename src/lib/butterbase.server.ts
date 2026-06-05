import { randomUUID } from "node:crypto";

import {
  getDb,
  getDbPath,
  type Agent,
  type AgentRun,
  type Approval,
  type Branch,
  type Change,
  type ChatMessage,
  type Commit,
  type Connection,
  type Deployment,
  type Discovery,
  type Notification,
  type PreviewComment,
  type Project,
  type PullRequest,
  type RecoveryEvent,
  type RocketRideWorkflowRun,
  type RuntimeCheck,
  type SuggestedApp,
  type Task,
  type TeamMember,
  type User,
  type Worktree,
  type Workspace,
} from "./db";

type JsonRecord = Record<string, unknown>;

const BUTTERBASE_TABLES = [
  "users",
  "workspaces",
  "workspace_prefs",
  "projects",
  "team_members",
  "agents",
  "tasks",
  "pull_requests",
  "changes",
  "approvals",
  "agent_runs",
  "runtime_checks",
  "rocketride_workflow_runs",
  "deployments",
  "recovery_events",
  "preview_comments",
  "notifications",
  "connections",
  "discoveries",
  "suggested_apps",
  "branches",
  "commits",
  "worktrees",
  "activity_events",
  "memory_entries",
  "chat_messages",
] as const;

type ButterbaseTable = (typeof BUTTERBASE_TABLES)[number];

export type ButterbaseStatus = {
  mode: "local" | "remote";
  configured: boolean;
  ready: boolean;
  projectUrl: string | null;
  missing: string[];
  sourceOfTruth: string;
  localDbPath: string | null;
  tables: string[];
};

function projectUrl() {
  return process.env.BUTTERBASE_PROJECT_URL?.trim().replace(/\/+$/, "") || null;
}

function apiKey() {
  return process.env.BUTTERBASE_API_KEY?.trim() || null;
}

function remoteBaseUrl() {
  const url = projectUrl();
  return url ? `${url}/api/forgecloud` : null;
}

export function getButterbaseStatus(): ButterbaseStatus {
  const url = projectUrl();
  const key = apiKey();
  const missing = [];
  if (url && !key) missing.push("BUTTERBASE_API_KEY");
  if (key && !url) missing.push("BUTTERBASE_PROJECT_URL");
  const configured = Boolean(url && key);
  return {
    mode: configured ? "remote" : "local",
    configured,
    ready: missing.length === 0,
    projectUrl: url,
    missing,
    sourceOfTruth: configured
      ? "Butterbase remote project"
      : "Local SQLite Butterbase-compatible demo backend",
    localDbPath: configured ? null : getDbPath(),
    tables: [...BUTTERBASE_TABLES],
  };
}

export async function validateButterbaseReadiness() {
  const status = getButterbaseStatus();
  if (status.mode === "local") {
    try {
      getDb().prepare("SELECT 1").get();
      return { passed: true, detail: status.sourceOfTruth };
    } catch (error) {
      return { passed: false, detail: (error as Error).message };
    }
  }

  try {
    await remoteRequest("GET", "health");
    return { passed: true, detail: "Butterbase remote health check passed" };
  } catch (error) {
    return { passed: false, detail: (error as Error).message };
  }
}

export type ActivityEventInput = {
  projectId: string;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  taskId?: string | null;
  prId?: string | null;
  deploymentId?: string | null;
  tool?: string | null;
};

export type MemoryEntryInput = {
  projectId: string;
  source: string;
  title: string;
  body: string;
  taskId?: string | null;
  prId?: string | null;
  confidence?: string;
};

export type CreateProjectInput = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  status?: string;
};

export type CreatePreviewCommentInput = {
  id: string;
  projectId: string;
  prId?: string | null;
  selector?: string | null;
  text: string;
};

export interface ButterbaseRepository {
  readonly mode: "local" | "remote";
  getUser(id: string): Promise<User | undefined>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(workspaceId: string): Promise<Project[]>;
  createProject(input: CreateProjectInput): Promise<Project>;
  syncProject(project: Project): Promise<void>;
  getActiveProjectId(workspaceId: string): Promise<string | null>;
  setActiveProjectId(workspaceId: string, projectId: string): Promise<void>;
  syncUser(user: User): Promise<void>;
  listTeamMembers(workspaceId: string): Promise<JsonRecord[]>;
  syncTeamMember(member: TeamMember): Promise<void>;
  removeTeamMember(workspaceId: string, memberId: string): Promise<number>;
  listConnections(workspaceId: string): Promise<Connection[]>;
  syncConnection(connection: Connection): Promise<void>;
  listDiscoveries(workspaceId: string, projectId: string): Promise<Discovery[]>;
  syncDiscovery(discovery: Discovery): Promise<void>;
  listSuggestedApps(workspaceId: string, projectId: string): Promise<SuggestedApp[]>;
  syncSuggestedApp(app: SuggestedApp): Promise<void>;
  listNotifications(workspaceId: string, limit?: number): Promise<Notification[]>;
  unreadNotifications(workspaceId: string): Promise<number>;
  syncNotification(notification: Notification): Promise<void>;
  markNotificationRead(workspaceId: string, notificationId: string): Promise<boolean>;
  markAllNotificationsRead(workspaceId: string): Promise<void>;
  listBranches(projectId: string): Promise<Branch[]>;
  syncBranch(branch: Branch): Promise<void>;
  getBranch(branchId: string): Promise<Branch | undefined>;
  listCommits(projectId: string, branchId?: string): Promise<Commit[]>;
  syncCommit(commit: Commit): Promise<void>;
  listWorktrees(projectId: string): Promise<Worktree[]>;
  syncWorktree(worktree: Worktree): Promise<void>;
  listAgents(projectId: string): Promise<Agent[]>;
  syncAgent(agent: Agent): Promise<void>;
  listTasks(projectId: string): Promise<Task[]>;
  syncTask(task: Task): Promise<void>;
  listPullRequests(projectId: string): Promise<PullRequest[]>;
  syncPullRequest(pr: PullRequest): Promise<void>;
  listChanges(projectId: string): Promise<Change[]>;
  syncChange(change: Change): Promise<void>;
  listRecoveryEvents(projectId: string): Promise<RecoveryEvent[]>;
  syncRecoveryEvent(event: RecoveryEvent): Promise<void>;
  listAgentRuns(projectId: string, agentId?: string): Promise<AgentRun[]>;
  syncAgentRun(run: AgentRun): Promise<void>;
  listRuntimeChecks(projectId: string, agentRunId?: string): Promise<RuntimeCheck[]>;
  syncRuntimeCheck(check: RuntimeCheck): Promise<void>;
  listRocketRideWorkflowRuns(projectId: string, limit?: number): Promise<RocketRideWorkflowRun[]>;
  syncRocketRideWorkflowRun(run: RocketRideWorkflowRun): Promise<void>;
  listApprovals(projectId: string): Promise<Approval[]>;
  syncApproval(approval: Approval): Promise<void>;
  listDeployments(projectId: string): Promise<Deployment[]>;
  syncDeployment(deployment: Deployment): Promise<void>;
  listChatMessages(projectId: string): Promise<ChatMessage[]>;
  addChatMessage(input: {
    id: string;
    projectId: string;
    role: string;
    content: string;
    metadata?: string | null;
  }): Promise<void>;
  listPreviewComments(projectId: string): Promise<PreviewComment[]>;
  createPreviewComment(input: CreatePreviewCommentInput): Promise<PreviewComment>;
  clearPreviewComments(projectId: string): Promise<number>;
  listActivityEvents(projectId: string): Promise<JsonRecord[]>;
  recordActivity(input: ActivityEventInput): Promise<void>;
  listMemoryEntries(projectId: string): Promise<JsonRecord[]>;
  recordMemory(input: MemoryEntryInput): Promise<void>;
}

class LocalButterbaseRepository implements ButterbaseRepository {
  readonly mode = "local" as const;

  async getUser(id: string) {
    return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  }

  async getWorkspace(id: string) {
    return getDb().prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as
      | Workspace
      | undefined;
  }

  async getProject(id: string) {
    return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  }

  async listProjects(workspaceId: string) {
    return getDb()
      .prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as Project[];
  }

  async createProject(input: CreateProjectInput) {
    getDb()
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, description, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workspaceId,
        input.name,
        input.description ?? null,
        input.status ?? "intake",
      );
    return (await this.getProject(input.id))!;
  }

  async syncProject(project: Project) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO projects
           (id, workspace_id, name, description, status, repo_url, cloudflare_project_id, insforge_project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.workspace_id,
        project.name,
        project.description ?? null,
        project.status,
        project.repo_url ?? null,
        project.cloudflare_project_id ?? null,
        project.insforge_project_id ?? null,
        project.created_at,
      );
  }

  async getActiveProjectId(workspaceId: string) {
    const row = getDb()
      .prepare(
        "SELECT value FROM workspace_prefs WHERE workspace_id = ? AND key = 'activeProjectId'",
      )
      .get(workspaceId) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setActiveProjectId(workspaceId: string, projectId: string) {
    getDb()
      .prepare(
        `INSERT INTO workspace_prefs (workspace_id, key, value, updated_at)
         VALUES (?, 'activeProjectId', ?, ?)
         ON CONFLICT(workspace_id, key) DO UPDATE
           SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(workspaceId, projectId, Date.now());
  }

  async syncUser(user: User) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO users (id, name, email, avatar_url, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.name, user.email, user.avatar_url ?? null, user.role, user.created_at);
  }

  async listTeamMembers(workspaceId: string) {
    return getDb()
      .prepare("SELECT * FROM team_members WHERE workspace_id = ?")
      .all(workspaceId) as JsonRecord[];
  }

  async syncTeamMember(member: TeamMember) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO team_members
           (id, workspace_id, user_id, display_name, role, permissions, is_ai)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        member.id,
        member.workspace_id,
        member.user_id ?? null,
        member.display_name,
        member.role,
        member.permissions,
        member.is_ai,
      );
  }

  async removeTeamMember(workspaceId: string, memberId: string) {
    return getDb()
      .prepare("DELETE FROM team_members WHERE id = ? AND workspace_id = ?")
      .run(memberId, workspaceId).changes;
  }

  async listConnections(workspaceId: string) {
    return getDb()
      .prepare(
        "SELECT * FROM connections WHERE workspace_id = ? ORDER BY status DESC, created_at ASC",
      )
      .all(workspaceId) as Connection[];
  }

  async syncConnection(connection: Connection) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO connections
           (id, workspace_id, provider, label, status, account_label, icon, source, toolkit_slug,
            auth_config_id, external_account_id, connect_url, sync_status, sync_detail, connected_at,
            last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connection.id,
        connection.workspace_id,
        connection.provider,
        connection.label,
        connection.status,
        connection.account_label ?? null,
        connection.icon ?? null,
        connection.source,
        connection.toolkit_slug ?? null,
        connection.auth_config_id ?? null,
        connection.external_account_id ?? null,
        connection.connect_url ?? null,
        connection.sync_status ?? null,
        connection.sync_detail ?? null,
        connection.connected_at ?? null,
        connection.last_synced_at ?? null,
        connection.created_at,
      );
  }

  async listDiscoveries(workspaceId: string, projectId: string) {
    return getDb()
      .prepare(
        `SELECT * FROM discoveries
          WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
          ORDER BY created_at ASC`,
      )
      .all(workspaceId, projectId) as Discovery[];
  }

  async syncDiscovery(discovery: Discovery) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO discoveries
           (id, workspace_id, project_id, connection_id, provider, label, detail, count, source, external_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        discovery.id,
        discovery.workspace_id,
        discovery.project_id ?? null,
        discovery.connection_id ?? null,
        discovery.provider,
        discovery.label,
        discovery.detail ?? null,
        discovery.count,
        discovery.source,
        discovery.external_id ?? null,
        discovery.created_at,
      );
  }

  async listSuggestedApps(workspaceId: string, projectId: string) {
    return getDb()
      .prepare(
        `SELECT * FROM suggested_apps
          WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
          ORDER BY created_at ASC`,
      )
      .all(workspaceId, projectId) as SuggestedApp[];
  }

  async syncSuggestedApp(app: SuggestedApp) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO suggested_apps
           (id, workspace_id, project_id, slug, title, description, icon, uses_connections,
            sample_features, source, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        app.id,
        app.workspace_id,
        app.project_id ?? null,
        app.slug,
        app.title,
        app.description,
        app.icon ?? null,
        app.uses_connections,
        app.sample_features,
        app.source,
        app.evidence,
        app.created_at,
      );
  }

  async listNotifications(workspaceId: string, limit = 50) {
    return getDb()
      .prepare(
        "SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as Notification[];
  }

  async unreadNotifications(workspaceId: string) {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE workspace_id = ? AND read_at IS NULL")
      .get(workspaceId) as { n: number };
    return row.n;
  }

  async syncNotification(notification: Notification) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO notifications
           (id, workspace_id, project_id, user_id, kind, title, body, link, read_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        notification.id,
        notification.workspace_id,
        notification.project_id ?? null,
        notification.user_id ?? null,
        notification.kind,
        notification.title,
        notification.body ?? null,
        notification.link ?? null,
        notification.read_at ?? null,
        notification.created_at,
      );
  }

  async markNotificationRead(workspaceId: string, notificationId: string) {
    const result = getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND workspace_id = ?")
      .run(Date.now(), notificationId, workspaceId);
    return result.changes > 0;
  }

  async markAllNotificationsRead(workspaceId: string) {
    getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL")
      .run(Date.now(), workspaceId);
  }

  async listBranches(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM branches WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Branch[];
  }

  async syncBranch(branch: Branch) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO branches
           (id, project_id, name, base_branch, head_pr_id, status, created_by_agent_id, created_at, merged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        branch.id,
        branch.project_id,
        branch.name,
        branch.base_branch,
        branch.head_pr_id ?? null,
        branch.status,
        branch.created_by_agent_id ?? null,
        branch.created_at,
        branch.merged_at ?? null,
      );
  }

  async getBranch(branchId: string) {
    return getDb().prepare("SELECT * FROM branches WHERE id = ?").get(branchId) as
      | Branch
      | undefined;
  }

  async listCommits(projectId: string, branchId?: string) {
    if (branchId) {
      return getDb()
        .prepare(
          "SELECT * FROM commits WHERE project_id = ? AND branch_id = ? ORDER BY created_at DESC",
        )
        .all(projectId, branchId) as Commit[];
    }
    return getDb()
      .prepare("SELECT * FROM commits WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Commit[];
  }

  async syncCommit(commit: Commit) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO commits
           (id, project_id, branch_id, pr_id, sha, message, author, files_changed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commit.id,
        commit.project_id,
        commit.branch_id ?? null,
        commit.pr_id ?? null,
        commit.sha,
        commit.message,
        commit.author,
        commit.files_changed,
        commit.created_at,
      );
  }

  async listWorktrees(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Worktree[];
  }

  async syncWorktree(worktree: Worktree) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO worktrees
           (id, project_id, branch_id, name, status, assigned_agent_id, preview_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        worktree.id,
        worktree.project_id,
        worktree.branch_id ?? null,
        worktree.name,
        worktree.status,
        worktree.assigned_agent_id ?? null,
        worktree.preview_url ?? null,
        worktree.created_at,
      );
  }

  async listAgents(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Agent[];
  }

  async syncAgent(agent: Agent) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO agents
           (id, project_id, name, type, role, permissions, current_task_id, status,
            model_primary, model_fallback, last_action, last_action_at, retry_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.project_id,
        agent.name,
        agent.type,
        agent.role,
        agent.permissions,
        agent.current_task_id ?? null,
        agent.status,
        agent.model_primary,
        agent.model_fallback,
        agent.last_action ?? null,
        agent.last_action_at ?? null,
        agent.retry_count,
        agent.created_at,
      );
  }

  async listTasks(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Task[];
  }

  async syncTask(task: Task) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO tasks
           (id, project_id, title, description, status, priority, risk_level, requester_id, requester_name,
            assigned_agent_id, reviewer_id, reviewer_name, linked_pr_id, preview_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.project_id,
        task.title,
        task.description ?? null,
        task.status,
        task.priority,
        task.risk_level,
        task.requester_id ?? null,
        task.requester_name ?? null,
        task.assigned_agent_id ?? null,
        task.reviewer_id ?? null,
        task.reviewer_name ?? null,
        task.linked_pr_id ?? null,
        task.preview_url ?? null,
        task.created_at,
      );
  }

  async listPullRequests(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM pull_requests WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as PullRequest[];
  }

  async syncPullRequest(pr: PullRequest) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO pull_requests
           (id, project_id, task_id, number, title, summary, status, risk_level, source_branch,
            target_branch, preview_url, screenshot_url, requires_approval, approver_name, approved_at,
            merged_at, rolled_back_at, rolled_back_by, created_by_agent_id, files_changed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pr.id,
        pr.project_id,
        pr.task_id ?? null,
        pr.number,
        pr.title,
        pr.summary,
        pr.status,
        pr.risk_level,
        pr.source_branch,
        pr.target_branch,
        pr.preview_url ?? null,
        pr.screenshot_url ?? null,
        pr.requires_approval,
        pr.approver_name ?? null,
        pr.approved_at ?? null,
        pr.merged_at ?? null,
        pr.rolled_back_at ?? null,
        pr.rolled_back_by ?? null,
        pr.created_by_agent_id ?? null,
        pr.files_changed,
        pr.created_at,
      );
  }

  async listChanges(projectId: string) {
    return getDb()
      .prepare(
        `SELECT c.*
           FROM changes c
           JOIN pull_requests pr ON pr.id = c.pr_id
          WHERE pr.project_id = ?
          ORDER BY c.id ASC`,
      )
      .all(projectId) as Change[];
  }

  async syncChange(change: Change) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO changes
           (id, pr_id, file_path, technical_diff, plain_english_summary, risk_explanation, agent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        change.id,
        change.pr_id,
        change.file_path,
        change.technical_diff ?? null,
        change.plain_english_summary,
        change.risk_explanation ?? null,
        change.agent_id ?? null,
      );
  }

  async listRecoveryEvents(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM recovery_events WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as RecoveryEvent[];
  }

  async syncRecoveryEvent(event: RecoveryEvent) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO recovery_events
           (id, project_id, agent_run_id, failure_type, failure_message, recovery_action, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.project_id,
        event.agent_run_id ?? null,
        event.failure_type,
        event.failure_message,
        event.recovery_action,
        event.status,
        event.created_at,
      );
  }

  async listAgentRuns(projectId: string, agentId?: string) {
    if (agentId) {
      return getDb()
        .prepare(
          "SELECT * FROM agent_runs WHERE project_id = ? AND agent_id = ? ORDER BY started_at DESC",
        )
        .all(projectId, agentId) as AgentRun[];
    }
    return getDb()
      .prepare("SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC")
      .all(projectId) as AgentRun[];
  }

  async syncAgentRun(run: AgentRun) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO agent_runs
           (id, project_id, agent_id, task_id, status, input_prompt, output_summary,
            model_used, fallback_used, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.project_id,
        run.agent_id,
        run.task_id ?? null,
        run.status,
        run.input_prompt,
        run.output_summary ?? null,
        run.model_used ?? null,
        run.fallback_used,
        run.started_at,
        run.completed_at ?? null,
      );
  }

  async listRuntimeChecks(projectId: string, agentRunId?: string) {
    if (agentRunId) {
      return getDb()
        .prepare(
          "SELECT * FROM runtime_checks WHERE project_id = ? AND agent_run_id = ? ORDER BY started_at ASC",
        )
        .all(projectId, agentRunId) as RuntimeCheck[];
    }
    return getDb()
      .prepare("SELECT * FROM runtime_checks WHERE project_id = ? ORDER BY started_at ASC")
      .all(projectId) as RuntimeCheck[];
  }

  async syncRuntimeCheck(check: RuntimeCheck) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO runtime_checks
           (id, project_id, agent_run_id, task_id, check_type, status, command, exit_code,
            stdout, stderr, summary, artifact_path, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        check.id,
        check.project_id,
        check.agent_run_id,
        check.task_id ?? null,
        check.check_type,
        check.status,
        check.command ?? null,
        check.exit_code ?? null,
        check.stdout ?? null,
        check.stderr ?? null,
        check.summary,
        check.artifact_path ?? null,
        check.started_at,
        check.completed_at ?? null,
      );
  }

  async listRocketRideWorkflowRuns(projectId: string, limit = 25) {
    return getDb()
      .prepare(
        "SELECT * FROM rocketride_workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?",
      )
      .all(projectId, limit) as RocketRideWorkflowRun[];
  }

  async syncRocketRideWorkflowRun(run: RocketRideWorkflowRun) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO rocketride_workflow_runs
           (id, project_id, workflow_type, status, mode, external_run_id, task_id, pr_id,
            deployment_id, input_json, output_json, error, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.project_id,
        run.workflow_type,
        run.status,
        run.mode,
        run.external_run_id ?? null,
        run.task_id ?? null,
        run.pr_id ?? null,
        run.deployment_id ?? null,
        run.input_json ?? null,
        run.output_json ?? null,
        run.error ?? null,
        run.started_at,
        run.completed_at ?? null,
      );
  }

  async listApprovals(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Approval[];
  }

  async syncApproval(approval: Approval) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO approvals
           (id, project_id, pr_id, reason, risk_level, details, status, approver_name, decided_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        approval.id,
        approval.project_id,
        approval.pr_id ?? null,
        approval.reason,
        approval.risk_level,
        approval.details,
        approval.status,
        approval.approver_name ?? null,
        approval.decided_at ?? null,
        approval.created_at,
      );
  }

  async listDeployments(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Deployment[];
  }

  async syncDeployment(deployment: Deployment) {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO deployments
           (id, project_id, pr_id, environment, status, cloudflare_url, railway_url, build_logs, rollback_target_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deployment.id,
        deployment.project_id,
        deployment.pr_id ?? null,
        deployment.environment,
        deployment.status,
        deployment.cloudflare_url ?? null,
        deployment.railway_url ?? null,
        deployment.build_logs ?? null,
        deployment.rollback_target_id ?? null,
        deployment.created_at,
      );
  }

  async listChatMessages(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as ChatMessage[];
  }

  async addChatMessage(input: {
    id: string;
    projectId: string;
    role: string;
    content: string;
    metadata?: string | null;
  }) {
    getDb()
      .prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, metadata)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.projectId, input.role, input.content, input.metadata ?? null);
  }

  async listPreviewComments(projectId: string) {
    return getDb()
      .prepare("SELECT * FROM preview_comments WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as PreviewComment[];
  }

  async createPreviewComment(input: CreatePreviewCommentInput) {
    const createdAt = Date.now();
    getDb()
      .prepare(
        `INSERT INTO preview_comments (id, project_id, pr_id, selector, text, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.prId ?? null,
        input.selector ?? null,
        input.text,
        createdAt,
      );
    return getDb()
      .prepare("SELECT * FROM preview_comments WHERE id = ?")
      .get(input.id) as PreviewComment;
  }

  async clearPreviewComments(projectId: string) {
    return getDb().prepare("DELETE FROM preview_comments WHERE project_id = ?").run(projectId)
      .changes;
  }

  async listActivityEvents(projectId: string) {
    return getDb()
      .prepare(
        `SELECT ae.*,
                t.title AS task_title,
                pr.number AS pr_number,
                pr.title AS pr_title,
                dep.environment AS deployment_environment,
                dep.status AS deployment_status
           FROM activity_events ae
           LEFT JOIN tasks t ON t.id = ae.linked_task_id
           LEFT JOIN pull_requests pr ON pr.id = ae.linked_pr_id
           LEFT JOIN deployments dep ON dep.id = ae.linked_deployment_id
          WHERE ae.project_id = ?
          ORDER BY ae.created_at DESC`,
      )
      .all(projectId) as JsonRecord[];
  }

  async recordActivity(input: ActivityEventInput) {
    getDb()
      .prepare(
        `INSERT INTO activity_events
           (id, project_id, actor_type, actor_id, event_type, title, description, linked_task_id, linked_pr_id, linked_deployment_id, tool, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `act-${randomUUID()}`,
        input.projectId,
        input.actorType,
        input.actorId ?? null,
        input.eventType,
        input.title,
        input.description ?? null,
        input.taskId ?? null,
        input.prId ?? null,
        input.deploymentId ?? null,
        input.tool ?? null,
        Date.now(),
      );
  }

  async listMemoryEntries(projectId: string) {
    return getDb()
      .prepare(
        `SELECT me.*,
                t.title AS task_title,
                pr.number AS pr_number,
                pr.title AS pr_title
           FROM memory_entries me
           LEFT JOIN tasks t ON t.id = me.linked_task_id
           LEFT JOIN pull_requests pr ON pr.id = me.linked_pr_id
          WHERE me.project_id = ?
          ORDER BY me.created_at DESC`,
      )
      .all(projectId) as JsonRecord[];
  }

  async recordMemory(input: MemoryEntryInput) {
    getDb()
      .prepare(
        `INSERT INTO memory_entries
           (id, project_id, source, title, body, linked_task_id, linked_pr_id, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `mem-${randomUUID()}`,
        input.projectId,
        input.source,
        input.title,
        input.body,
        input.taskId ?? null,
        input.prId ?? null,
        input.confidence ?? "stored",
        Date.now(),
      );
  }
}

class RemoteButterbaseRepository implements ButterbaseRepository {
  readonly mode = "remote" as const;

  async getUser(id: string) {
    return remoteRequest<User>("GET", `tables/users/${encodeURIComponent(id)}`);
  }

  async getWorkspace(id: string) {
    return remoteRequest<Workspace>("GET", `tables/workspaces/${encodeURIComponent(id)}`);
  }

  async getProject(id: string) {
    return remoteRequest<Project>("GET", `tables/projects/${encodeURIComponent(id)}`);
  }

  async listProjects(workspaceId: string) {
    return remoteList<Project>("projects", { workspace_id: workspaceId, order: "created_at.desc" });
  }

  async createProject(input: CreateProjectInput) {
    return remoteRequest<Project>("POST", "tables/projects", {
      id: input.id,
      workspace_id: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? "intake",
    });
  }

  async syncProject(project: Project) {
    await remoteRequest("POST", "tables/projects", {
      id: project.id,
      workspace_id: project.workspace_id,
      name: project.name,
      description: project.description ?? null,
      status: project.status,
      repo_url: project.repo_url ?? null,
      cloudflare_project_id: project.cloudflare_project_id ?? null,
      insforge_project_id: project.insforge_project_id ?? null,
      created_at: project.created_at,
    });
  }

  async getActiveProjectId(workspaceId: string) {
    const row = await remoteRequest<{ value: string | null }>(
      "GET",
      `workspace-prefs/${encodeURIComponent(workspaceId)}/activeProjectId`,
    );
    return row.value ?? null;
  }

  async setActiveProjectId(workspaceId: string, projectId: string) {
    await remoteRequest(
      "PUT",
      `workspace-prefs/${encodeURIComponent(workspaceId)}/activeProjectId`,
      {
        value: projectId,
      },
    );
  }

  async syncUser(user: User) {
    await remoteRequest("POST", "tables/users", {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url ?? null,
      role: user.role,
      created_at: user.created_at,
    });
  }

  async listTeamMembers(workspaceId: string) {
    return remoteList<JsonRecord>("team_members", { workspace_id: workspaceId });
  }

  async syncTeamMember(member: TeamMember) {
    await remoteRequest("POST", "tables/team_members", {
      id: member.id,
      workspace_id: member.workspace_id,
      user_id: member.user_id ?? null,
      display_name: member.display_name,
      role: member.role,
      permissions: member.permissions,
      is_ai: member.is_ai,
    });
  }

  async removeTeamMember(workspaceId: string, memberId: string) {
    const result = await remoteRequest<{ removed: number }>("DELETE", "tables/team_members", {
      workspace_id: workspaceId,
      id: memberId,
    });
    return result.removed ?? 0;
  }

  async listConnections(workspaceId: string) {
    const rows = await remoteList<Connection>("connections", {
      workspace_id: workspaceId,
      order: "status.desc,created_at.asc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare(
        "SELECT * FROM connections WHERE workspace_id = ? ORDER BY status DESC, created_at ASC",
      )
      .all(workspaceId) as Connection[];
    for (const row of localRows) await this.syncConnection(row);
    return localRows;
  }

  async syncConnection(connection: Connection) {
    await remoteRequest("POST", "tables/connections", {
      id: connection.id,
      workspace_id: connection.workspace_id,
      provider: connection.provider,
      label: connection.label,
      status: connection.status,
      account_label: connection.account_label ?? null,
      icon: connection.icon ?? null,
      source: connection.source,
      toolkit_slug: connection.toolkit_slug ?? null,
      auth_config_id: connection.auth_config_id ?? null,
      external_account_id: connection.external_account_id ?? null,
      connect_url: connection.connect_url ?? null,
      sync_status: connection.sync_status ?? null,
      sync_detail: connection.sync_detail ?? null,
      connected_at: connection.connected_at ?? null,
      last_synced_at: connection.last_synced_at ?? null,
      created_at: connection.created_at,
    });
  }

  async listDiscoveries(workspaceId: string, projectId: string) {
    const rows = (
      await remoteList<Discovery>("discoveries", {
        workspace_id: workspaceId,
        order: "created_at.asc",
      })
    ).filter((row) => row.project_id === null || row.project_id === projectId);
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare(
        `SELECT * FROM discoveries
          WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
          ORDER BY created_at ASC`,
      )
      .all(workspaceId, projectId) as Discovery[];
    for (const row of localRows) await this.syncDiscovery(row);
    return localRows;
  }

  async syncDiscovery(discovery: Discovery) {
    await remoteRequest("POST", "tables/discoveries", {
      id: discovery.id,
      workspace_id: discovery.workspace_id,
      project_id: discovery.project_id ?? null,
      connection_id: discovery.connection_id ?? null,
      provider: discovery.provider,
      label: discovery.label,
      detail: discovery.detail ?? null,
      count: discovery.count,
      source: discovery.source,
      external_id: discovery.external_id ?? null,
      created_at: discovery.created_at,
    });
  }

  async listSuggestedApps(workspaceId: string, projectId: string) {
    const rows = (
      await remoteList<SuggestedApp>("suggested_apps", {
        workspace_id: workspaceId,
        order: "created_at.asc",
      })
    ).filter((row) => row.project_id === null || row.project_id === projectId);
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare(
        `SELECT * FROM suggested_apps
          WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
          ORDER BY created_at ASC`,
      )
      .all(workspaceId, projectId) as SuggestedApp[];
    for (const row of localRows) await this.syncSuggestedApp(row);
    return localRows;
  }

  async syncSuggestedApp(app: SuggestedApp) {
    await remoteRequest("POST", "tables/suggested_apps", {
      id: app.id,
      workspace_id: app.workspace_id,
      project_id: app.project_id ?? null,
      slug: app.slug,
      title: app.title,
      description: app.description,
      icon: app.icon ?? null,
      uses_connections: app.uses_connections,
      sample_features: app.sample_features,
      source: app.source,
      evidence: app.evidence,
      created_at: app.created_at,
    });
  }

  async listNotifications(workspaceId: string, limit = 50) {
    await this.syncLocalNotifications(workspaceId);
    return (
      await remoteList<Notification>("notifications", {
        workspace_id: workspaceId,
        order: "created_at.desc",
      })
    ).slice(0, limit);
  }

  async unreadNotifications(workspaceId: string) {
    const rows = await this.listNotifications(workspaceId, 500);
    return rows.filter((row) => row.read_at === null).length;
  }

  async syncNotification(notification: Notification) {
    await remoteRequest("POST", "tables/notifications", {
      id: notification.id,
      workspace_id: notification.workspace_id,
      project_id: notification.project_id ?? null,
      user_id: notification.user_id ?? null,
      kind: notification.kind,
      title: notification.title,
      body: notification.body ?? null,
      link: notification.link ?? null,
      read_at: notification.read_at ?? null,
      created_at: notification.created_at,
    });
  }

  async markNotificationRead(workspaceId: string, notificationId: string) {
    const readAt = Date.now();
    const result = getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND workspace_id = ?")
      .run(readAt, notificationId, workspaceId);
    const row = getDb().prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId) as
      | Notification
      | undefined;
    if (row) await this.syncNotification(row);
    return result.changes > 0 || Boolean(row);
  }

  async markAllNotificationsRead(workspaceId: string) {
    const readAt = Date.now();
    getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL")
      .run(readAt, workspaceId);
    await this.syncLocalNotifications(workspaceId);
  }

  private async syncLocalNotifications(workspaceId: string) {
    const rows = getDb()
      .prepare("SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as Notification[];
    for (const row of rows) await this.syncNotification(row);
  }

  async listBranches(projectId: string) {
    const rows = await remoteList<Branch>("branches", {
      project_id: projectId,
      order: "created_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare("SELECT * FROM branches WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Branch[];
    for (const row of localRows) await this.syncBranch(row);
    return localRows;
  }

  async syncBranch(branch: Branch) {
    await remoteRequest("POST", "tables/branches", {
      id: branch.id,
      project_id: branch.project_id,
      name: branch.name,
      base_branch: branch.base_branch,
      head_pr_id: branch.head_pr_id ?? null,
      status: branch.status,
      created_by_agent_id: branch.created_by_agent_id ?? null,
      created_at: branch.created_at,
      merged_at: branch.merged_at ?? null,
    });
  }

  async getBranch(branchId: string) {
    try {
      return await remoteRequest<Branch>("GET", `tables/branches/${encodeURIComponent(branchId)}`);
    } catch {
      const row = getDb().prepare("SELECT * FROM branches WHERE id = ?").get(branchId) as
        | Branch
        | undefined;
      if (row) await this.syncBranch(row);
      return row;
    }
  }

  async listCommits(projectId: string, branchId?: string) {
    const rows = await remoteList<Commit>("commits", {
      project_id: projectId,
      ...(branchId ? { branch_id: branchId } : {}),
      order: "created_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = branchId
      ? (getDb()
          .prepare(
            "SELECT * FROM commits WHERE project_id = ? AND branch_id = ? ORDER BY created_at DESC",
          )
          .all(projectId, branchId) as Commit[])
      : (getDb()
          .prepare("SELECT * FROM commits WHERE project_id = ? ORDER BY created_at DESC")
          .all(projectId) as Commit[]);
    for (const row of localRows) await this.syncCommit(row);
    return localRows;
  }

  async syncCommit(commit: Commit) {
    await remoteRequest("POST", "tables/commits", {
      id: commit.id,
      project_id: commit.project_id,
      branch_id: commit.branch_id ?? null,
      pr_id: commit.pr_id ?? null,
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      files_changed: commit.files_changed,
      created_at: commit.created_at,
    });
  }

  async listWorktrees(projectId: string) {
    const rows = await remoteList<Worktree>("worktrees", {
      project_id: projectId,
      order: "created_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare("SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Worktree[];
    for (const row of localRows) await this.syncWorktree(row);
    return localRows;
  }

  async syncWorktree(worktree: Worktree) {
    await remoteRequest("POST", "tables/worktrees", {
      id: worktree.id,
      project_id: worktree.project_id,
      branch_id: worktree.branch_id ?? null,
      name: worktree.name,
      status: worktree.status,
      assigned_agent_id: worktree.assigned_agent_id ?? null,
      preview_url: worktree.preview_url ?? null,
      created_at: worktree.created_at,
    });
  }

  async listAgents(projectId: string) {
    const rows = await remoteList<Agent>("agents", {
      project_id: projectId,
      order: "created_at.asc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Agent[];
    for (const row of localRows) await this.syncAgent(row);
    return localRows;
  }

  async syncAgent(agent: Agent) {
    await remoteRequest("POST", "tables/agents", {
      id: agent.id,
      project_id: agent.project_id,
      name: agent.name,
      type: agent.type,
      role: agent.role,
      permissions: agent.permissions,
      current_task_id: agent.current_task_id ?? null,
      status: agent.status,
      model_primary: agent.model_primary,
      model_fallback: agent.model_fallback,
      last_action: agent.last_action ?? null,
      last_action_at: agent.last_action_at ?? null,
      retry_count: agent.retry_count,
      created_at: agent.created_at,
    });
  }

  async listTasks(projectId: string) {
    return remoteList<Task>("tasks", { project_id: projectId, order: "created_at.asc" });
  }

  async syncTask(task: Task) {
    await remoteRequest("POST", "tables/tasks", {
      id: task.id,
      project_id: task.project_id,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      risk_level: task.risk_level,
      requester_id: task.requester_id ?? null,
      requester_name: task.requester_name ?? null,
      assigned_agent_id: task.assigned_agent_id ?? null,
      reviewer_id: task.reviewer_id ?? null,
      reviewer_name: task.reviewer_name ?? null,
      linked_pr_id: task.linked_pr_id ?? null,
      preview_url: task.preview_url ?? null,
      created_at: task.created_at,
    });
  }

  async listPullRequests(projectId: string) {
    const rows = await remoteList<PullRequest>("pull_requests", {
      project_id: projectId,
      order: "created_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare("SELECT * FROM pull_requests WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as PullRequest[];
    for (const row of localRows) await this.syncPullRequest(row);
    return localRows;
  }

  async syncPullRequest(pr: PullRequest) {
    await remoteRequest("POST", "tables/pull_requests", {
      id: pr.id,
      project_id: pr.project_id,
      task_id: pr.task_id ?? null,
      number: pr.number,
      title: pr.title,
      summary: pr.summary,
      status: pr.status,
      risk_level: pr.risk_level,
      source_branch: pr.source_branch,
      target_branch: pr.target_branch,
      preview_url: pr.preview_url ?? null,
      screenshot_url: pr.screenshot_url ?? null,
      requires_approval: pr.requires_approval,
      approver_name: pr.approver_name ?? null,
      approved_at: pr.approved_at ?? null,
      merged_at: pr.merged_at ?? null,
      rolled_back_at: pr.rolled_back_at ?? null,
      rolled_back_by: pr.rolled_back_by ?? null,
      created_by_agent_id: pr.created_by_agent_id ?? null,
      files_changed: pr.files_changed,
      created_at: pr.created_at,
    });
  }

  async listChanges(projectId: string) {
    const prIds = new Set((await this.listPullRequests(projectId)).map((pr) => pr.id));
    const rows = (
      await remoteList<Change>("changes", { project_id: projectId, order: "id.asc" })
    ).filter((change) => prIds.has(change.pr_id));
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare(
        `SELECT c.*
           FROM changes c
           JOIN pull_requests pr ON pr.id = c.pr_id
          WHERE pr.project_id = ?
          ORDER BY c.id ASC`,
      )
      .all(projectId) as Change[];
    for (const row of localRows) await this.syncChange(row);
    return localRows;
  }

  async syncChange(change: Change) {
    await remoteRequest("POST", "tables/changes", {
      id: change.id,
      pr_id: change.pr_id,
      file_path: change.file_path,
      technical_diff: change.technical_diff ?? null,
      plain_english_summary: change.plain_english_summary,
      risk_explanation: change.risk_explanation ?? null,
      agent_id: change.agent_id ?? null,
    });
  }

  async listRecoveryEvents(projectId: string) {
    const rows = await remoteList<RecoveryEvent>("recovery_events", {
      project_id: projectId,
      order: "created_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = getDb()
      .prepare("SELECT * FROM recovery_events WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as RecoveryEvent[];
    for (const row of localRows) await this.syncRecoveryEvent(row);
    return localRows;
  }

  async syncRecoveryEvent(event: RecoveryEvent) {
    await remoteRequest("POST", "tables/recovery_events", {
      id: event.id,
      project_id: event.project_id,
      agent_run_id: event.agent_run_id ?? null,
      failure_type: event.failure_type,
      failure_message: event.failure_message,
      recovery_action: event.recovery_action,
      status: event.status,
      created_at: event.created_at,
    });
  }

  async listAgentRuns(projectId: string, agentId?: string) {
    const rows = await remoteList<AgentRun>("agent_runs", {
      project_id: projectId,
      ...(agentId ? { agent_id: agentId } : {}),
      order: "started_at.desc",
    });
    if (rows.length > 0) return rows;

    const localRows = agentId
      ? (getDb()
          .prepare(
            "SELECT * FROM agent_runs WHERE project_id = ? AND agent_id = ? ORDER BY started_at DESC",
          )
          .all(projectId, agentId) as AgentRun[])
      : (getDb()
          .prepare("SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC")
          .all(projectId) as AgentRun[]);
    for (const row of localRows) await this.syncAgentRun(row);
    return localRows;
  }

  async syncAgentRun(run: AgentRun) {
    await remoteRequest("POST", "tables/agent_runs", {
      id: run.id,
      project_id: run.project_id,
      agent_id: run.agent_id,
      task_id: run.task_id ?? null,
      status: run.status,
      input_prompt: run.input_prompt,
      output_summary: run.output_summary ?? null,
      model_used: run.model_used ?? null,
      fallback_used: run.fallback_used,
      started_at: run.started_at,
      completed_at: run.completed_at ?? null,
    });
  }

  async listRuntimeChecks(projectId: string, agentRunId?: string) {
    const rows = await remoteList<RuntimeCheck>("runtime_checks", {
      project_id: projectId,
      ...(agentRunId ? { agent_run_id: agentRunId } : {}),
      order: "started_at.asc",
    });
    if (rows.length > 0) return rows;

    const localRows = agentRunId
      ? (getDb()
          .prepare(
            "SELECT * FROM runtime_checks WHERE project_id = ? AND agent_run_id = ? ORDER BY started_at ASC",
          )
          .all(projectId, agentRunId) as RuntimeCheck[])
      : (getDb()
          .prepare("SELECT * FROM runtime_checks WHERE project_id = ? ORDER BY started_at ASC")
          .all(projectId) as RuntimeCheck[]);
    for (const row of localRows) await this.syncRuntimeCheck(row);
    return localRows;
  }

  async syncRuntimeCheck(check: RuntimeCheck) {
    await remoteRequest("POST", "tables/runtime_checks", {
      id: check.id,
      project_id: check.project_id,
      agent_run_id: check.agent_run_id,
      task_id: check.task_id ?? null,
      check_type: check.check_type,
      status: check.status,
      command: check.command ?? null,
      exit_code: check.exit_code ?? null,
      stdout: check.stdout ?? null,
      stderr: check.stderr ?? null,
      summary: check.summary,
      artifact_path: check.artifact_path ?? null,
      started_at: check.started_at,
      completed_at: check.completed_at ?? null,
    });
  }

  async listRocketRideWorkflowRuns(projectId: string, limit = 25) {
    const rows = await remoteList<RocketRideWorkflowRun>("rocketride_workflow_runs", {
      project_id: projectId,
      order: "started_at.desc",
    });
    if (rows.length > 0) return rows.slice(0, limit);

    const localRows = getDb()
      .prepare(
        "SELECT * FROM rocketride_workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?",
      )
      .all(projectId, limit) as RocketRideWorkflowRun[];
    for (const row of localRows) await this.syncRocketRideWorkflowRun(row);
    return localRows;
  }

  async syncRocketRideWorkflowRun(run: RocketRideWorkflowRun) {
    await remoteRequest("POST", "tables/rocketride_workflow_runs", {
      id: run.id,
      project_id: run.project_id,
      workflow_type: run.workflow_type,
      status: run.status,
      mode: run.mode,
      external_run_id: run.external_run_id ?? null,
      task_id: run.task_id ?? null,
      pr_id: run.pr_id ?? null,
      deployment_id: run.deployment_id ?? null,
      input_json: run.input_json ?? null,
      output_json: run.output_json ?? null,
      error: run.error ?? null,
      started_at: run.started_at,
      completed_at: run.completed_at ?? null,
    });
  }

  async listApprovals(projectId: string) {
    return remoteList<Approval>("approvals", { project_id: projectId, order: "created_at.desc" });
  }

  async syncApproval(approval: Approval) {
    await remoteRequest("POST", "tables/approvals", {
      id: approval.id,
      project_id: approval.project_id,
      pr_id: approval.pr_id ?? null,
      reason: approval.reason,
      risk_level: approval.risk_level,
      details: approval.details,
      status: approval.status,
      approver_name: approval.approver_name ?? null,
      decided_at: approval.decided_at ?? null,
      created_at: approval.created_at,
    });
  }

  async listDeployments(projectId: string) {
    return remoteList<Deployment>("deployments", {
      project_id: projectId,
      order: "created_at.desc",
    });
  }

  async syncDeployment(deployment: Deployment) {
    await remoteRequest("POST", "tables/deployments", {
      id: deployment.id,
      project_id: deployment.project_id,
      pr_id: deployment.pr_id ?? null,
      environment: deployment.environment,
      status: deployment.status,
      cloudflare_url: deployment.cloudflare_url ?? null,
      railway_url: deployment.railway_url ?? null,
      build_logs: deployment.build_logs ?? null,
      rollback_target_id: deployment.rollback_target_id ?? null,
      created_at: deployment.created_at,
    });
  }

  async listChatMessages(projectId: string) {
    return remoteList<ChatMessage>("chat_messages", {
      project_id: projectId,
      order: "created_at.asc",
    });
  }

  async addChatMessage(input: {
    id: string;
    projectId: string;
    role: string;
    content: string;
    metadata?: string | null;
  }) {
    await remoteRequest("POST", "tables/chat_messages", {
      id: input.id,
      project_id: input.projectId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
    });
  }

  async listPreviewComments(projectId: string) {
    return remoteList<PreviewComment>("preview_comments", {
      project_id: projectId,
      order: "created_at.desc",
    });
  }

  async createPreviewComment(input: CreatePreviewCommentInput) {
    return remoteRequest<PreviewComment>("POST", "tables/preview_comments", {
      id: input.id,
      project_id: input.projectId,
      pr_id: input.prId ?? null,
      selector: input.selector ?? null,
      text: input.text,
      status: "open",
    });
  }

  async clearPreviewComments(projectId: string) {
    const result = await remoteRequest<{ removed: number }>("DELETE", "tables/preview_comments", {
      project_id: projectId,
    });
    return result.removed ?? 0;
  }

  async listActivityEvents(projectId: string) {
    return remoteList<JsonRecord>("activity_events", {
      project_id: projectId,
      order: "created_at.desc",
      include: "tasks,pull_requests,deployments",
    });
  }

  async recordActivity(input: ActivityEventInput) {
    await remoteRequest("POST", "tables/activity_events", {
      id: `act-${randomUUID()}`,
      project_id: input.projectId,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      event_type: input.eventType,
      title: input.title,
      description: input.description ?? null,
      linked_task_id: input.taskId ?? null,
      linked_pr_id: input.prId ?? null,
      linked_deployment_id: input.deploymentId ?? null,
      tool: input.tool ?? null,
    });
  }

  async listMemoryEntries(projectId: string) {
    return remoteList<JsonRecord>("memory_entries", {
      project_id: projectId,
      order: "created_at.desc",
      include: "tasks,pull_requests",
    });
  }

  async recordMemory(input: MemoryEntryInput) {
    await remoteRequest("POST", "tables/memory_entries", {
      id: `mem-${randomUUID()}`,
      project_id: input.projectId,
      source: input.source,
      title: input.title,
      body: input.body,
      linked_task_id: input.taskId ?? null,
      linked_pr_id: input.prId ?? null,
      confidence: input.confidence ?? "stored",
    });
  }
}

async function remoteList<T>(table: ButterbaseTable, query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return remoteRequest<T[]>("GET", `tables/${table}?${params.toString()}`);
}

async function remoteRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = remoteBaseUrl();
  const key = apiKey();
  if (!baseUrl || !key) {
    throw new Error(
      "Butterbase remote mode requires BUTTERBASE_PROJECT_URL and BUTTERBASE_API_KEY",
    );
  }
  const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, "")}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "x-forgecloud-source": "forgecloud",
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Butterbase ${method} ${path} failed with ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getButterbaseRepository(): ButterbaseRepository {
  return getButterbaseStatus().mode === "remote"
    ? new RemoteButterbaseRepository()
    : new LocalButterbaseRepository();
}
