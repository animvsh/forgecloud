import { randomUUID } from "node:crypto";
import { getDb } from "./db";

export type PlanName = "free" | "pro" | "enterprise";
export type UsageKind = "task" | "agent_run";
export type EntitlementAction =
  | "create_project"
  | "add_team_member"
  | "connect_tool"
  | "create_task"
  | "run_agent"
  | "deploy_production";

type LimitValue = number | null;

export type PlanLimits = {
  projects: LimitValue;
  humanMembers: LimitValue;
  connectedTools: LimitValue;
  tasksPerMonth: LimitValue;
  agentRunsPerMonth: LimitValue;
  productionDeploys: boolean;
};

export type EntitlementSnapshot = {
  plan: PlanName;
  billingStatus: string;
  limits: PlanLimits;
  usage: {
    projects: number;
    humanMembers: number;
    connectedTools: number;
    tasksThisMonth: number;
    agentRunsThisMonth: number;
    windowStart: number;
  };
};

export type EntitlementDecision =
  | { allowed: true; snapshot: EntitlementSnapshot }
  | {
      allowed: false;
      snapshot: EntitlementSnapshot;
      error: "plan_limit_exceeded" | "billing_inactive";
      resource: keyof PlanLimits | "billing";
      limit: LimitValue;
      used: number;
      requested: number;
      plan: PlanName;
      billingStatus: string;
      message: string;
    };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    projects: 1,
    humanMembers: 3,
    connectedTools: 2,
    tasksPerMonth: 25,
    agentRunsPerMonth: 20,
    productionDeploys: false,
  },
  pro: {
    projects: 20,
    humanMembers: 50,
    connectedTools: 20,
    tasksPerMonth: 2_000,
    agentRunsPerMonth: 2_000,
    productionDeploys: true,
  },
  enterprise: {
    projects: null,
    humanMembers: null,
    connectedTools: null,
    tasksPerMonth: null,
    agentRunsPerMonth: null,
    productionDeploys: true,
  },
};

export function getEntitlementSnapshot(workspaceId: string): EntitlementSnapshot {
  const db = getDb();
  const workspace = db
    .prepare("SELECT plan, billing_status FROM workspaces WHERE id = ?")
    .get(workspaceId) as { plan?: string; billing_status?: string } | undefined;
  const plan = normalizePlan(workspace?.plan);
  const windowStart = Date.now() - THIRTY_DAYS_MS;

  return {
    plan,
    billingStatus: workspace?.billing_status ?? "active",
    limits: PLAN_LIMITS[plan],
    usage: {
      projects: count(db, "SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ?", [
        workspaceId,
      ]),
      humanMembers: count(
        db,
        "SELECT COUNT(*) AS count FROM team_members WHERE workspace_id = ? AND is_ai = 0",
        [workspaceId],
      ),
      connectedTools: count(
        db,
        "SELECT COUNT(*) AS count FROM connections WHERE workspace_id = ? AND status = 'connected'",
        [workspaceId],
      ),
      tasksThisMonth: usageCount(db, workspaceId, "task", windowStart),
      agentRunsThisMonth: usageCount(db, workspaceId, "agent_run", windowStart),
      windowStart,
    },
  };
}

export function checkEntitlement(
  workspaceId: string,
  action: EntitlementAction,
  quantity = 1,
): EntitlementDecision {
  const snapshot = getEntitlementSnapshot(workspaceId);
  if (snapshot.billingStatus !== "active") {
    return {
      allowed: false,
      snapshot,
      error: "billing_inactive",
      resource: "billing",
      limit: 0,
      used: 0,
      requested: quantity,
      plan: snapshot.plan,
      billingStatus: snapshot.billingStatus,
      message: `Billing is ${snapshot.billingStatus}; workspace actions are paused.`,
    };
  }

  if (action === "deploy_production" && !snapshot.limits.productionDeploys) {
    return denied(snapshot, "productionDeploys", 0, 0, quantity);
  }
  if (action === "create_project") {
    return underLimit(snapshot, "projects", snapshot.usage.projects, quantity);
  }
  if (action === "add_team_member") {
    return underLimit(snapshot, "humanMembers", snapshot.usage.humanMembers, quantity);
  }
  if (action === "connect_tool") {
    return underLimit(snapshot, "connectedTools", snapshot.usage.connectedTools, quantity);
  }
  if (action === "create_task") {
    return underLimit(snapshot, "tasksPerMonth", snapshot.usage.tasksThisMonth, quantity);
  }
  if (action === "run_agent") {
    return underLimit(snapshot, "agentRunsPerMonth", snapshot.usage.agentRunsThisMonth, quantity);
  }
  return { allowed: true, snapshot };
}

export function recordUsageEvent(
  workspaceId: string,
  kind: UsageKind,
  quantity = 1,
  metadata?: unknown,
) {
  getDb()
    .prepare(
      `INSERT INTO workspace_usage_events (id, workspace_id, kind, quantity, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `use-${randomUUID()}`,
      workspaceId,
      kind,
      Math.max(1, Math.floor(quantity)),
      metadata ? JSON.stringify(metadata) : null,
      Date.now(),
    );
}

function underLimit(
  snapshot: EntitlementSnapshot,
  resource: keyof PlanLimits,
  used: number,
  requested: number,
): EntitlementDecision {
  const limit = snapshot.limits[resource];
  if (limit === null || typeof limit === "boolean" || used + requested <= limit) {
    return { allowed: true, snapshot };
  }
  return denied(snapshot, resource, limit, used, requested);
}

function denied(
  snapshot: EntitlementSnapshot,
  resource: keyof PlanLimits,
  limit: LimitValue,
  used: number,
  requested: number,
): EntitlementDecision {
  return {
    allowed: false,
    snapshot,
    error: "plan_limit_exceeded",
    resource,
    limit,
    used,
    requested,
    plan: snapshot.plan,
    billingStatus: snapshot.billingStatus,
    message: `${snapshot.plan} plan limit reached for ${resource}.`,
  };
}

function normalizePlan(plan: string | undefined): PlanName {
  if (plan === "pro" || plan === "enterprise") return plan;
  return "free";
}

function usageCount(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  kind: UsageKind,
  windowStart: number,
): number {
  return count(
    db,
    `SELECT COALESCE(SUM(quantity), 0) AS count
       FROM workspace_usage_events
      WHERE workspace_id = ?
        AND kind = ?
        AND created_at >= ?`,
    [workspaceId, kind, windowStart],
  );
}

function count(db: ReturnType<typeof getDb>, sql: string, params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}
