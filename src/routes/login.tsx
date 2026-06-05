import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLogin, useRequestLogin } from "@/lib/client";

export const Route = createFileRoute("/login")({
  component: LoginScreen,
});

function LoginScreen() {
  const navigate = useNavigate();
  const requestLogin = useRequestLogin();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [code, setCode] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState<{ id: string; name: string } | null>(
    null,
  );

  async function requestCode() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    try {
      const result = await requestLogin.mutateAsync({
        email: cleanEmail,
        workspaceId: workspaceId.trim() || undefined,
      });
      setSelectedWorkspace(result.workspace);
      setWorkspaceId(result.workspace.id);
      if (result.code) setCode(result.code);
      toast.success(result.delivered ? "Login code sent" : "Login code ready");
    } catch (error) {
      toast.error("Couldn't start login", { description: (error as Error).message });
    }
  }

  async function submitCode() {
    if (!email.trim() || !workspaceId.trim() || !code.trim()) return;
    try {
      await login.mutateAsync({
        email: email.trim().toLowerCase(),
        workspaceId: workspaceId.trim(),
        code: code.trim(),
      });
      navigate({ to: "/app" });
    } catch (error) {
      toast.error("Couldn't sign in", { description: (error as Error).message });
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <div className="text-lg font-bold">ForgeCloud</div>
            <div className="text-xs text-muted-foreground">Secure workspace sign-in</div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your workspace email. ForgeCloud will send a short-lived login code.
          </p>

          <div className="mt-6 space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Email</label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="you@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <label className="block text-xs font-medium text-muted-foreground">Workspace ID</label>
            <input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="Optional if you only belong to one workspace"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button
              onClick={requestCode}
              disabled={!email.trim() || requestLogin.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40"
            >
              {requestLogin.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              Send login code
            </button>
          </div>

          {selectedWorkspace && (
            <div className="mt-6 space-y-3 border-t border-border pt-5">
              <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Signing into{" "}
                <span className="font-semibold text-foreground">{selectedWorkspace.name}</span>
              </div>
              <label className="block text-xs font-medium text-muted-foreground">Code</label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tracking-[0.3em] outline-none focus:border-brand"
              />
              <button
                onClick={submitCode}
                disabled={code.trim().length !== 6 || login.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:brightness-105 disabled:opacity-40"
              >
                {login.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                Continue
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
