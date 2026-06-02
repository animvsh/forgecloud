import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const POLL_INTERVAL = 2500;

// Plain HTTP API client. The TanStack Start `createServerFn` system is broken in
// this version (Seroval serialization bug), so all server calls go through
// fetch() against `/api/*` endpoints handled by `src/server/api-handler.ts`.

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export function useForgeState() {
  return useQuery({
    queryKey: ["forge-state"],
    queryFn: () => apiGet<any>("/api/state"),
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { message: string }) => apiPost<any>("/api/chat", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useStartIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: any) => apiPost<any>("/api/intake", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskId: string; failureType?: string }) =>
      apiPost<any>("/api/run-task", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunAllTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { failureAt?: number; failureType?: string } = {}) =>
      apiPost<any>("/api/run-all", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useInjectFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; message?: string }) =>
      apiPost<any>("/api/inject-failure", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      approvalId: string;
      decision: "approve" | "reject";
      approverName?: string;
    }) => apiPost<any>("/api/approval", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useApprovePr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prId: string; approverName?: string }) =>
      apiPost<any>("/api/approve-pr", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prId?: string; environment?: "preview" | "staging" | "production" } = {}) =>
      apiPost<any>("/api/deploy", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDeployProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fail?: boolean } = {}) =>
      apiPost<any>("/api/deploy-production", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useResetProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>("/api/reset", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunFullDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>("/api/run-full-demo", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useSkipToDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>("/api/skip-to-demo", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; selector?: string }) =>
      apiPost<any>("/api/comment", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useExplain() {
  return useMutation({
    mutationFn: (vars: { approvalId?: string; prId?: string }) =>
      apiPost<{ explanation: string; provider: string }>("/api/explain", vars),
  });
}

export function useRollbackPr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prId: string }) =>
      apiPost<{ ok: true; prId: string }>("/api/rollback-pr", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRequestEdits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prId: string; message: string }) =>
      apiPost<{ ok: true; task: any }>("/api/request-edits", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}
