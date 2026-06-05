/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const POLL_INTERVAL = 2500;

// Plain HTTP API client. The TanStack Start `createServerFn` system is broken in
// this version (Seroval serialization bug), so all server calls go through
// fetch() against `/api/*` endpoints handled by `src/server/api-handler.ts`.

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE?.trim().replace(/\/+$/, "");
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { method: "GET", credentials: "include" });
  if (!res.ok) throw new Error(await formatApiError(res, `GET ${path}`));
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(await formatApiError(res, `POST ${path}`));
  }
  return (await res.json()) as T;
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    throw new Error(await formatApiError(res, `DELETE ${path}`));
  }
  return (await res.json()) as T;
}

async function formatApiError(res: Response, label: string) {
  const text = await res.text().catch(() => "");
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const code = payload?.code ?? payload?.error ?? payload?.reason;
  if (code === "plan_limit_exceeded") {
    return "This workspace hit its plan limit. Open Settings to review usage or upgrade the plan.";
  }
  if (code === "billing_inactive") {
    return "Billing is inactive for this workspace. Restore billing in Settings before continuing.";
  }
  if (res.status === 401) return "Your session expired. Sign in again to keep working.";
  if (res.status === 403) return "Your role does not have permission to do that in this workspace.";
  if (res.status === 409 && payload?.message) return payload.message;
  return payload?.message ?? `${label} failed with status ${res.status}`;
}

function shouldRetryApiError(_failureCount: number, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/session expired|sign in|permission/i.test(message)) return false;
  return true;
}

export function useAuthSession() {
  return useQuery({
    queryKey: ["auth-session"],
    queryFn: () => apiGet<any>("/api/auth/session"),
    refetchOnWindowFocus: true,
  });
}

export function useRequestLogin() {
  return useMutation({
    mutationFn: (vars: { email: string; workspaceId?: string }) =>
      apiPost<{
        ok: true;
        delivered: boolean;
        workspace: { id: string; name: string };
        code?: string;
      }>("/api/auth/request-login", vars),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; workspaceId: string; code: string }) =>
      apiPost<any>("/api/auth/login", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth-session"] });
      qc.invalidateQueries({ queryKey: ["forge-state"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ ok: true }>("/api/auth/logout", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth-session"] });
      qc.invalidateQueries({ queryKey: ["forge-state"] });
    },
  });
}

export function useForgeState() {
  return useQuery({
    queryKey: ["forge-state"],
    queryFn: () => apiGet<any>("/api/state"),
    retry: shouldRetryApiError,
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

export function useApprovePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskIds: string[] }) => apiPost<any>("/api/approve-plan", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunMyTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { reviewerName?: string; includeReviewQueue?: boolean } = {}) =>
      apiPost<{ ok: boolean; reviewerName: string; count: number; results: any[] }>(
        "/api/run-my-tasks",
        vars,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useAddTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { displayName: string; role?: string; email?: string }) =>
      apiPost<{ ok: boolean; member: any }>("/api/team", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { memberId: string }) =>
      apiDelete<{ ok: boolean; removed: any }>(`/api/team/${encodeURIComponent(vars.memberId)}`),
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

export function useClearPreviewComments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete<{ ok: true; removed: number }>("/api/preview-comments"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useBlame() {
  return useMutation({
    mutationFn: (vars: { selector?: string; label: string }) =>
      apiPost<{
        explanation: string;
        provider: string;
        prNumber?: number;
        xtraceMode?: "local" | "webhook" | "hybrid";
        provenance?: Array<{ label: string; detail: string; kind: string }>;
      }>("/api/blame", vars),
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

export function useBuildFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { appId: string }) =>
      apiPost<{ ok: true; project: any; tasks: any[] }>("/api/build-app", vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}
