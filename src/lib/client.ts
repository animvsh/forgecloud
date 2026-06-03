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

export function useAgentRuns(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agent-runs", agentId],
    queryFn: () => apiGet<any[]>(`/api/agent-runs?agentId=${encodeURIComponent(agentId ?? "")}`),
    enabled: !!agentId,
    refetchInterval: 4000,
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
    mutationFn: (
      vars: { prId?: string; environment?: "preview" | "staging" | "production" } = {},
    ) => apiPost<any>("/api/deploy", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDeployProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fail?: boolean } = {}) => apiPost<any>("/api/deploy-production", vars),
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

export function useNewProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; description?: string }) =>
      apiPost<any>("/api/projects", vars),
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

export function useSeedDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<any>("/api/seed-demo", {}),
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
export function useSwitchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { projectId: string }) =>
      apiPost<{ ok: true; projectId: string; projectName: string }>("/api/projects/switch", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; selector?: string }) => apiPost<any>("/api/comment", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useBlame() {
  return useMutation({
    mutationFn: (vars: { selector?: string; label: string }) =>
      apiPost<{ explanation: string; provider: string; prNumber?: number }>("/api/blame", vars),
  });
}

export function useAddTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      title: string;
      description?: string;
      ownerAgent?: string;
      riskLevel?: "low" | "med" | "high";
    }) => apiPost<{ ok: boolean; task: any }>("/api/add-task", vars),
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

type ForgeNotification = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
};

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications-page"],
    queryFn: () =>
      apiGet<{ notifications: ForgeNotification[]; unread: number }>("/api/notifications"),
    refetchInterval: 5000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { notificationId: string }) =>
      apiPost<{ ok: true; unread: number }>("/api/notifications/read", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ ok: true; unread: 0 }>("/api/notifications/read-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useMergeBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { branchId: string }) =>
      apiPost<{ ok: true; branch: any }>("/api/branches/merge", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useArchiveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { branchId: string }) =>
      apiPost<{ ok: true; branch: any }>("/api/branches/archive", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useSpawnWorktree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { branchId?: string; name: string }) =>
      apiPost<{ ok: true; worktree: any }>("/api/worktrees", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useConnectTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: string; account?: string }) =>
      apiPost<{ ok: true; connection: any }>("/api/connect", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDisconnectTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: string }) => apiPost<{ ok: true }>("/api/disconnect", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ discoveries: any[] }>("/api/scan", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useBuildSuggestedApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { appId: string }) =>
      apiPost<{ ok: true; project: any; tasks: any[] }>("/api/build-app", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}
