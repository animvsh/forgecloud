import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addPreviewComment,
  decideApprovalFn,
  deployPr,
  deployProduction,
  getAgentsFn,
  getApprovals,
  getChanges,
  getChat,
  getDeployments,
  getFailureFeed,
  getInitialState,
  getPrsFn,
  getTasksFn,
  getTeam,
  injectFailure,
  resetProject,
  runAllTasks,
  runFullDemo,
  runNextTask,
  runTask,
  sendChat,
  skipToDemo,
  startProjectIntake,
  approvePrFn,
} from "./api";

const POLL_INTERVAL = 2500;

export function useForgeState() {
  return useQuery({
    queryKey: ["forge-state"],
    queryFn: () => getInitialState(),
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { message: string }) => sendChat({ data: vars.message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useStartIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof startProjectIntake>[0]["data"]) =>
      startProjectIntake({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskId: string; failureType?: string }) =>
      runTask({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunAllTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { failureAt?: number; failureType?: string } = {}) =>
      runAllTasks({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (failureType?: string) =>
      runNextTask({ data: failureType ? { failureType } : undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useInjectFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: Parameters<typeof injectFailure>[0]["data"]) =>
      injectFailure({ data: type }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { approvalId: string; decision: "approve" | "reject" }) =>
      decideApprovalFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useApprovePr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => approvePrFn({ data: { prId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { environment?: "preview" | "staging" | "production" } = {}) =>
      deployPr({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useDeployProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fail: boolean) => deployProduction({ data: { fail } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useResetProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resetProject(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useRunFullDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runFullDemo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useSkipToDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => skipToDemo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; selector?: string }) =>
      addPreviewComment({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forge-state"] }),
  });
}

void getAgentsFn;
void getApprovals;
void getChanges;
void getChat;
void getDeployments;
void getFailureFeed;
void getPrsFn;
void getTasksFn;
void getTeam;
