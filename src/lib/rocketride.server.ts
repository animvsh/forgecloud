import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { getStackConfig } from "./config.server";
import { getDb, type RocketRideWorkflowRun } from "./db";
import { getButterbaseRepository } from "./butterbase.server";
import { log } from "./logger";
import { emitStackEvent } from "./stack.server";
import { storeXTraceMemory } from "./xtrace.server";

export type RocketRideWorkflowType =
  | "chat_intake"
  | "chat_task"
  | "intake_plan"
  | "plan_approved"
  | "run_task"
  | "run_all"
  | "deploy";

type WorkflowInput = {
  projectId: string;
  workflowType: RocketRideWorkflowType;
  title: string;
  description?: string | null;
  taskId?: string | null;
  prId?: string | null;
  deploymentId?: string | null;
  payload?: Record<string, unknown>;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

const CallbackStepSchema = z
  .object({
    id: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().min(1).max(160).optional(),
    status: z.string().trim().min(1).max(80).optional(),
    output: z.unknown().optional(),
    error: z.string().trim().max(2000).nullable().optional(),
  })
  .passthrough();

export const RocketRideCallbackSchema = z
  .object({
    workflowRunId: z.string().trim().min(1).max(160).optional(),
    externalRunId: z.string().trim().min(1).max(200).nullable().optional(),
    projectId: z.string().trim().min(1).max(160).optional(),
    workflowType: z.string().trim().min(1).max(80).optional(),
    status: z
      .enum(["queued", "running", "completed", "failed", "cancelled"])
      .or(z.string().trim().min(1).max(80)),
    taskId: z.string().trim().min(1).max(160).nullable().optional(),
    prId: z.string().trim().min(1).max(160).nullable().optional(),
    deploymentId: z.string().trim().min(1).max(160).nullable().optional(),
    output: z.unknown().optional(),
    step: CallbackStepSchema.optional(),
    stepOutput: z.unknown().optional(),
    error: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((value) => value.workflowRunId || value.externalRunId, {
    message: "workflowRunId or externalRunId is required",
  });

export type RocketRideCallbackPayload = z.infer<typeof RocketRideCallbackSchema>;

export function getRocketRideStatus() {
  const service = getStackConfig().find((entry) => entry.key === "rocketride");
  return {
    mode: service?.mode ?? "local",
    ready: service?.ready ?? true,
    configured: service?.mode === "webhook" && service.ready,
    detail: service?.detail ?? "RocketRide backed by local ForgeCloud runtime",
  };
}

export function verifyRocketRideCallbackAuth(req: IncomingMessage): {
  ok: boolean;
  configured: boolean;
  missingRequiredSecret: boolean;
} {
  const expected = process.env.ROCKETRIDE_CALLBACK_SECRET ?? process.env.ROCKETRIDE_API_KEY ?? null;
  if (!expected) {
    const missingRequiredSecret =
      process.env.NODE_ENV === "production" || Boolean(process.env.ROCKETRIDE_WORKFLOW_URL);
    return { ok: !missingRequiredSecret, configured: false, missingRequiredSecret };
  }

  const header = getHeader(req, "authorization") ?? getHeader(req, "x-rocketride-secret") ?? "";
  const actual = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header;
  return {
    ok: safeEqual(actual, expected),
    configured: true,
    missingRequiredSecret: false,
  };
}

export function listRocketRideRuns(projectId: string, limit = 25): RocketRideWorkflowRun[] {
  return getDb()
    .prepare(
      `SELECT *
         FROM rocketride_workflow_runs
        WHERE project_id = ?
        ORDER BY started_at DESC
        LIMIT ?`,
    )
    .all(projectId, limit) as RocketRideWorkflowRun[];
}

export async function runRocketRideWorkflow<T>(
  input: WorkflowInput,
  localWorkflow: (workflowRunId: string) => Promise<T>,
) {
  const run = startWorkflow(input);
  await callRocketRideWebhook(input, run.id);
  try {
    const output = await localWorkflow(run.id);
    const refs = refsFromOutput(output);
    const completed = updateWorkflow(run.id, {
      status: "completed",
      output,
      ...refs,
    });
    emitWorkflowEvent(input, "workflow_completed", completed, refs);
    return { workflowRun: completed, output };
  } catch (error) {
    const failed = updateWorkflow(run.id, {
      status: "failed",
      error: (error as Error).message,
    });
    emitWorkflowEvent(input, "workflow_failed", failed, {});
    throw error;
  }
}

function startWorkflow(input: WorkflowInput): RocketRideWorkflowRun {
  const id = `rr-${randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO rocketride_workflow_runs
         (id, project_id, workflow_type, status, mode, task_id, pr_id, deployment_id, input_json, started_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.workflowType,
      getRocketRideStatus().configured ? "webhook" : "local",
      input.taskId ?? null,
      input.prId ?? null,
      input.deploymentId ?? null,
      JSON.stringify({
        title: input.title,
        description: input.description ?? null,
        payload: input.payload ?? {},
      }),
      Date.now(),
    );
  const run = getWorkflow(id);
  emitWorkflowEvent(input, "workflow_started", run, {});
  return run;
}

function updateWorkflow(
  id: string,
  update: {
    status: string;
    output?: unknown;
    error?: string | null;
    taskId?: string | null;
    prId?: string | null;
    deploymentId?: string | null;
  },
): RocketRideWorkflowRun {
  getDb()
    .prepare(
      `UPDATE rocketride_workflow_runs
          SET status = ?,
              output_json = COALESCE(?, output_json),
              error = ?,
              task_id = COALESCE(?, task_id),
              pr_id = COALESCE(?, pr_id),
              deployment_id = COALESCE(?, deployment_id),
              completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END
        WHERE id = ?`,
    )
    .run(
      update.status,
      update.output === undefined ? null : JSON.stringify(update.output),
      update.error ?? null,
      update.taskId ?? null,
      update.prId ?? null,
      update.deploymentId ?? null,
      update.status,
      Date.now(),
      id,
    );
  return getWorkflow(id);
}

export async function applyRocketRideCallback(
  payload: RocketRideCallbackPayload,
): Promise<RocketRideWorkflowRun> {
  const existing = findWorkflowForCallback(payload);
  if (!existing) {
    throw Object.assign(new Error("RocketRide workflow run not found"), { statusCode: 404 });
  }

  if (payload.projectId && payload.projectId !== existing.project_id) {
    throw Object.assign(new Error("RocketRide callback project mismatch"), { statusCode: 409 });
  }

  const now = Date.now();
  const output = mergeCallbackOutput(existing.output_json, payload);
  const taskId = payload.taskId === undefined ? existing.task_id : payload.taskId;
  const prId = payload.prId === undefined ? existing.pr_id : payload.prId;
  const deploymentId =
    payload.deploymentId === undefined ? existing.deployment_id : payload.deploymentId;
  const completedAt = terminalStatuses.has(payload.status)
    ? (existing.completed_at ?? now)
    : existing.completed_at;
  const error =
    payload.error !== undefined
      ? payload.error
      : payload.status === "completed"
        ? null
        : existing.error;

  getDb()
    .prepare(
      `UPDATE rocketride_workflow_runs
          SET status = ?,
              external_run_id = COALESCE(?, external_run_id),
              task_id = ?,
              pr_id = ?,
              deployment_id = ?,
              output_json = ?,
              error = ?,
              completed_at = ?
        WHERE id = ?`,
    )
    .run(
      payload.status,
      payload.externalRunId ?? null,
      taskId ?? null,
      prId ?? null,
      deploymentId ?? null,
      output === undefined ? existing.output_json : JSON.stringify(output),
      error ?? null,
      completedAt,
      existing.id,
    );

  const updated = getWorkflow(existing.id);
  await reflectRocketRideCallback(updated, payload);
  await syncRocketRideWorkflowRun(updated);
  return updated;
}

function getWorkflow(id: string): RocketRideWorkflowRun {
  const run = getDb().prepare("SELECT * FROM rocketride_workflow_runs WHERE id = ?").get(id) as
    | RocketRideWorkflowRun
    | undefined;
  if (!run) throw new Error(`RocketRide workflow ${id} was not recorded`);
  return run;
}

function findWorkflowForCallback(payload: RocketRideCallbackPayload): RocketRideWorkflowRun | null {
  const d = getDb();
  if (payload.workflowRunId) {
    const byId = d
      .prepare("SELECT * FROM rocketride_workflow_runs WHERE id = ?")
      .get(payload.workflowRunId) as RocketRideWorkflowRun | undefined;
    if (byId) return byId;
  }
  if (payload.externalRunId) {
    const byExternal = d
      .prepare("SELECT * FROM rocketride_workflow_runs WHERE external_run_id = ?")
      .get(payload.externalRunId) as RocketRideWorkflowRun | undefined;
    if (byExternal) return byExternal;
  }
  return null;
}

function mergeCallbackOutput(
  currentJson: string | null,
  payload: RocketRideCallbackPayload,
): Record<string, unknown> | undefined {
  const current = parseObject(currentJson);
  const next: Record<string, unknown> = { ...current };
  if (payload.output !== undefined) {
    next.output = payload.output;
  }
  if (payload.step || payload.stepOutput !== undefined) {
    const steps = Array.isArray(current.steps) ? [...current.steps] : [];
    steps.push({
      ...(payload.step ?? {}),
      ...(payload.stepOutput !== undefined ? { output: payload.stepOutput } : {}),
      receivedAt: new Date().toISOString(),
    });
    next.steps = steps;
  }
  if (payload.externalRunId) next.externalRunId = payload.externalRunId;
  next.lastCallbackStatus = payload.status;
  next.lastCallbackAt = new Date().toISOString();
  if (payload.output === undefined && !payload.step && payload.stepOutput === undefined) {
    return Object.keys(current).length > 0 ? next : undefined;
  }
  return next;
}

async function reflectRocketRideCallback(
  run: RocketRideWorkflowRun,
  payload: RocketRideCallbackPayload,
) {
  const title = workflowTitle(run);
  const refs = {
    taskId: run.task_id ?? null,
    prId: run.pr_id ?? null,
    deploymentId: run.deployment_id ?? null,
  };
  const description = callbackDescription(run, payload);
  const butterbase = getButterbaseRepository();
  await butterbase.recordActivity({
    projectId: run.project_id,
    actorType: "agent",
    actorId: null,
    eventType: `rocketride_${payload.status}`,
    title: `${title} ${payload.status}`,
    description,
    taskId: refs.taskId,
    prId: refs.prId,
    deploymentId: refs.deploymentId,
    tool: "RocketRide",
  });
  if (terminalStatuses.has(payload.status) || payload.step || payload.stepOutput !== undefined) {
    await butterbase.recordMemory({
      projectId: run.project_id,
      source: "RocketRide",
      title: `${title} callback`,
      body: description,
      taskId: refs.taskId,
      prId: refs.prId,
      confidence: payload.status === "failed" ? "needs_review" : "stored",
    });
    if (butterbase.mode !== "local") {
      storeXTraceMemory(getDb(), {
        projectId: run.project_id,
        source: "RocketRide",
        title: `${title} callback`,
        body: description,
        taskId: refs.taskId,
        prId: refs.prId,
        confidence: payload.status === "failed" ? "needs_review" : "stored",
      });
    }
  }
  updateLinkedAgentActivity(run);
  emitStackEvent("rocketride", {
    eventType: `workflow_${payload.status}`,
    projectId: run.project_id,
    title: `${title} ${payload.status}`,
    description,
    linkedTaskId: refs.taskId,
    linkedPrId: refs.prId,
    linkedDeploymentId: refs.deploymentId,
    metadata: {
      workflowRunId: run.id,
      externalRunId: run.external_run_id,
      workflowType: run.workflow_type,
      status: run.status,
    },
  });
}

function updateLinkedAgentActivity(run: RocketRideWorkflowRun) {
  if (!run.task_id) return;
  const task = getDb()
    .prepare("SELECT assigned_agent_id FROM tasks WHERE id = ? AND project_id = ?")
    .get(run.task_id, run.project_id) as { assigned_agent_id: string | null } | undefined;
  if (!task?.assigned_agent_id) return;
  const terminal = terminalStatuses.has(run.status);
  getDb()
    .prepare(
      `UPDATE agents
          SET status = ?,
              current_task_id = CASE WHEN ? THEN NULL ELSE COALESCE(current_task_id, ?) END,
              last_action = ?,
              last_action_at = ?
        WHERE id = ? AND project_id = ?`,
    )
    .run(
      terminal ? "idle" : "working",
      terminal ? 1 : 0,
      run.task_id,
      `RocketRide ${run.workflow_type.replace(/_/g, " ")} ${run.status}`,
      Date.now(),
      task.assigned_agent_id,
      run.project_id,
    );
}

async function syncRocketRideWorkflowRun(run: RocketRideWorkflowRun) {
  try {
    await getButterbaseRepository().syncRocketRideWorkflowRun(run);
  } catch (error) {
    log.warn("rocketride_callback_sync_failed", {
      workflowRunId: run.id,
      error: (error as Error).message,
    });
  }
}

function workflowTitle(run: RocketRideWorkflowRun): string {
  const input = parseObject(run.input_json);
  return typeof input.title === "string" && input.title.trim()
    ? input.title
    : run.workflow_type.replace(/_/g, " ");
}

function callbackDescription(run: RocketRideWorkflowRun, payload: RocketRideCallbackPayload) {
  const stepName = payload.step?.name ?? payload.step?.id ?? null;
  const parts = [
    `RocketRide reported ${payload.status} for ${run.workflow_type.replace(/_/g, " ")}.`,
    run.external_run_id ? `External run: ${run.external_run_id}.` : null,
    stepName ? `Step: ${stepName}.` : null,
    payload.error ? `Error: ${payload.error}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function callRocketRideWebhook(input: WorkflowInput, workflowRunId: string) {
  const service = getStackConfig().find((entry) => entry.key === "rocketride");
  if (!service || service.mode !== "webhook" || !service.ready || !service.endpoint) return;
  try {
    const response = await fetch(service.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(service.token ? { authorization: `Bearer ${service.token}` } : {}),
      },
      body: JSON.stringify({
        source: "forgecloud",
        workflowRunId,
        workflowType: input.workflowType,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        prId: input.prId ?? null,
        deploymentId: input.deploymentId ?? null,
        title: input.title,
        description: input.description ?? null,
        payload: input.payload ?? {},
      }),
    });
    if (!response.ok) {
      log.warn("rocketride_dispatch_failed", {
        status: response.status,
        workflowType: input.workflowType,
      });
    }
  } catch (error) {
    log.warn("rocketride_dispatch_error", {
      workflowType: input.workflowType,
      error: (error as Error).message,
    });
  }
}

function emitWorkflowEvent(
  input: WorkflowInput,
  eventType: string,
  run: RocketRideWorkflowRun,
  refs: { taskId?: string | null; prId?: string | null; deploymentId?: string | null },
) {
  emitStackEvent("rocketride", {
    eventType,
    projectId: input.projectId,
    title: eventType === "workflow_started" ? input.title : `${input.title} ${run.status}`,
    description: input.description ?? null,
    linkedTaskId: refs.taskId ?? input.taskId ?? null,
    linkedPrId: refs.prId ?? input.prId ?? null,
    linkedDeploymentId: refs.deploymentId ?? input.deploymentId ?? null,
    metadata: {
      workflowRunId: run.id,
      workflowType: input.workflowType,
      mode: run.mode,
      status: run.status,
    },
  });
}

function refsFromOutput(output: unknown) {
  if (!output || typeof output !== "object") return {};
  const value = output as {
    task?: { id?: string; linked_pr_id?: string | null } | null;
    pr?: { id?: string } | null;
    deploymentId?: string | null;
    results?: unknown[];
  };
  const firstResult = Array.isArray(value.results) ? refsFromOutput(value.results[0]) : {};
  return {
    taskId: value.task?.id ?? firstResult.taskId ?? null,
    prId: value.pr?.id ?? value.task?.linked_pr_id ?? firstResult.prId ?? null,
    deploymentId: value.deploymentId ?? firstResult.deploymentId ?? null,
  };
}
