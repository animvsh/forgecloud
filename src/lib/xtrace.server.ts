import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { getStackConfig } from "./config.server";
import { log } from "./logger";

export type XTraceMemoryInput = {
  projectId: string;
  source?: string;
  title: string;
  body: string;
  taskId?: string | null;
  prId?: string | null;
  confidence?: string;
  metadata?: Record<string, unknown>;
};

export type XTraceMemoryRecord = {
  id: string;
  project_id: string;
  source: string;
  title: string;
  body: string;
  linked_task_id: string | null;
  linked_pr_id: string | null;
  confidence: string;
  created_at: number;
  task_title?: string | null;
  pr_number?: number | null;
  pr_title?: string | null;
};

export function storeXTraceMemory(
  db: Database.Database,
  input: XTraceMemoryInput,
): XTraceMemoryRecord {
  const record: XTraceMemoryRecord = {
    id: `mem-${randomUUID()}`,
    project_id: input.projectId,
    source: input.source ?? "XTrace",
    title: input.title,
    body: input.body,
    linked_task_id: input.taskId ?? null,
    linked_pr_id: input.prId ?? null,
    confidence: input.confidence ?? "stored",
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO memory_entries
       (id, project_id, source, title, body, linked_task_id, linked_pr_id, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.project_id,
    record.source,
    record.title,
    record.body,
    record.linked_task_id,
    record.linked_pr_id,
    record.confidence,
    record.created_at,
  );
  void dispatchXTrace("memory.store", { memory: { ...record, metadata: input.metadata ?? {} } });
  return record;
}

export async function searchXTraceMemory(
  db: Database.Database,
  input: { projectId: string; query: string; taskId?: string | null; prId?: string | null },
) {
  const rows = db
    .prepare(
      `SELECT me.*,
              t.title AS task_title,
              pr.number AS pr_number,
              pr.title AS pr_title
         FROM memory_entries me
         LEFT JOIN tasks t ON t.id = me.linked_task_id
         LEFT JOIN pull_requests pr ON pr.id = me.linked_pr_id
        WHERE me.project_id = ?
        ORDER BY me.created_at DESC
        LIMIT 80`,
    )
    .all(input.projectId) as XTraceMemoryRecord[];
  const tokens = input.query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 16);
  const scored = rows
    .map((record) => {
      const haystack = [
        record.title,
        record.body,
        record.source,
        record.task_title,
        record.pr_title,
        record.pr_number ? `pr ${record.pr_number}` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return {
        record,
        score:
          (input.taskId && record.linked_task_id === input.taskId ? 6 : 0) +
          (input.prId && record.linked_pr_id === input.prId ? 6 : 0) +
          tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0),
      };
    })
    .filter(({ score }) => score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score || b.record.created_at - a.record.created_at);
  const local = (scored.length > 0 ? scored.map(({ record }) => record) : rows).slice(0, 8);
  const remote = await dispatchXTrace("memory.search", {
    projectId: input.projectId,
    query: input.query,
    taskId: input.taskId ?? null,
    prId: input.prId ?? null,
    limit: 8,
  });
  const remoteRecords = normalizeRemoteRecords(remote, input.projectId);
  return {
    records: dedupeMemoryRecords([...remoteRecords, ...local]).slice(0, 8),
    remote,
    mode: remote ? "hybrid" : "local",
  };
}

function normalizeRemoteRecords(remote: unknown, projectId: string): XTraceMemoryRecord[] {
  if (!remote || typeof remote !== "object") return [];
  const payload = remote as {
    records?: unknown;
    memories?: unknown;
    results?: unknown;
  };
  const candidates = Array.isArray(payload.records)
    ? payload.records
    : Array.isArray(payload.memories)
      ? payload.memories
      : Array.isArray(payload.results)
        ? payload.results
        : [];
  return candidates
    .map((candidate, index): XTraceMemoryRecord | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const row = candidate as Record<string, unknown>;
      const title =
        typeof row.title === "string"
          ? row.title
          : typeof row.label === "string"
            ? row.label
            : "Remote XTrace memory";
      const body =
        typeof row.body === "string"
          ? row.body
          : typeof row.detail === "string"
            ? row.detail
            : typeof row.content === "string"
              ? row.content
              : "";
      if (!title && !body) return null;
      return {
        id: typeof row.id === "string" ? row.id : `remote-xtrace-${index}`,
        project_id: typeof row.project_id === "string" ? row.project_id : projectId,
        source: typeof row.source === "string" ? row.source : "XTrace",
        title,
        body,
        linked_task_id: typeof row.linked_task_id === "string" ? row.linked_task_id : null,
        linked_pr_id: typeof row.linked_pr_id === "string" ? row.linked_pr_id : null,
        confidence: typeof row.confidence === "string" ? row.confidence : "remote",
        created_at: typeof row.created_at === "number" ? row.created_at : Date.now(),
        task_title: typeof row.task_title === "string" ? row.task_title : null,
        pr_number: typeof row.pr_number === "number" ? row.pr_number : null,
        pr_title: typeof row.pr_title === "string" ? row.pr_title : null,
      };
    })
    .filter((record): record is XTraceMemoryRecord => Boolean(record));
}

function dedupeMemoryRecords(records: XTraceMemoryRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.id || `${record.title}:${record.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function dispatchXTrace(operation: "memory.store" | "memory.search", payload: object) {
  const service = getStackConfig().find((entry) => entry.key === "xtrace");
  if (!service || service.mode !== "webhook" || !service.ready || !service.endpoint) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(service.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(service.token ? { authorization: `Bearer ${service.token}` } : {}),
      },
      body: JSON.stringify({
        source: "forgecloud",
        service: "xtrace",
        operation,
        sentAt: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn("xtrace_dispatch_failed", { operation, status: response.status });
      return null;
    }
    return await response.json().catch(() => ({ ok: true }));
  } catch (error) {
    log.warn("xtrace_dispatch_error", { operation, error: (error as Error).message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
