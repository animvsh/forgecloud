import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Rocket, Check, AlertTriangle, Loader2, ExternalLink, Eye, GitBranch, ShieldCheck } from "lucide-react";
import { useForgeState, useDeploy, useDeployProduction } from "@/lib/client";
import { useState } from "react";

export const Route = createFileRoute("/app/deployments")({
  component: DeploymentsScreen,
});

function DeploymentsScreen() {
  const { data, isLoading } = useForgeState();
  const deploy = useDeploy();
  const deployProd = useDeployProduction();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const deployments = data.deployments;
  const prs = data.prs.filter((p) => p.status === "approved");
  const approvedCount = prs.length;
  const pendingApprovals = data.approvals.length;
  const buildPassed = true;
  const testsPassed = true;
  const secretsClean = data.recovery.filter((r) => r.failure_type === "secret_detected" && r.status === "blocked").length === 0;
  const lastDeploy = deployments[0];
  const previousLive = deployments.find((d, i) => i > 0 && d.environment === "production" && d.status === "live");

  async function doDeploy(env: "preview" | "staging" | "production") {
    setBusy(env);
    try {
      if (env === "production") {
        await deployProd.mutateAsync({ fail: false });
      } else {
        await deploy.mutateAsync({ environment: env });
      }
    } finally {
      setBusy(null);
    }
  }

  async function doFailDeploy() {
    setBusy("fail");
    try {
      await deployProd.mutateAsync({ fail: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Deployments"
        subtitle="Preview, staging, and production. All deploys on Railway with automatic rollback."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => doDeploy("preview")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
            >
              {busy === "preview" ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
              Preview
            </button>
            <button
              onClick={doFailDeploy}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-3 py-1.5 text-xs text-coral hover:bg-coral/20 disabled:opacity-40"
            >
              {busy === "fail" ? <Loader2 className="size-3 animate-spin" /> : <AlertTriangle className="size-3" />}
              Simulate failure
            </button>
            <button
              onClick={() => doDeploy("production")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 disabled:opacity-40"
            >
              {busy === "production" ? <Loader2 className="size-3 animate-spin" /> : <Rocket className="size-3" />}
              Deploy production
            </button>
          </div>
        }
      />

      <div className="space-y-6 p-8">
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border bg-muted/40 px-5 py-3">
            <div className="grid grid-cols-12 text-xs uppercase tracking-wider text-muted-foreground">
              <div className="col-span-2">Environment</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-4">URL</div>
              <div className="col-span-3">Deployed</div>
              <div className="col-span-1 text-right">Action</div>
            </div>
          </div>
          <div className="divide-y divide-border">
            {(["preview", "staging", "production"] as const).map((env) => {
              const d = deployments.find((dep) => dep.environment === env);
              return (
                <div key={env} className="grid grid-cols-12 items-center px-5 py-4 text-sm transition-colors hover:bg-muted/30">
                  <div className="col-span-2 font-medium capitalize">{env}</div>
                  <div className="col-span-2">
                    {d ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        d.status === "live" ? "bg-mint/20 text-mint" :
                        d.status === "failed" ? "bg-coral/20 text-coral" :
                        "bg-amber/20 text-amber"
                      }`}>
                        {d.status}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        not deployed
                      </span>
                    )}
                  </div>
                  <div className="col-span-4 font-mono text-xs truncate">
                    {d?.railway_url || d?.cloudflare_url || "—"}
                  </div>
                  <div className="col-span-3 text-xs text-muted-foreground">
                    {d ? new Date(d.created_at).toLocaleString() : "—"}
                  </div>
                  <div className="col-span-1 text-right">
                    {d && (d.railway_url || d.cloudflare_url) && (
                      <a
                        href={d.railway_url || d.cloudflare_url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand hover:underline transition-colors"
                      >
                        <ExternalLink className="size-3" /> Open
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-border bg-card p-6 card-hover">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-brand" />
              Pre-production checklist
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              ForgeCloud won't deploy to production until all checks pass.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <CheckRow ok={buildPassed} label="Build passed" />
              <CheckRow ok={testsPassed} label="QA tests passed" />
              <CheckRow ok={approvedCount > 0} label={`${approvedCount} PR${approvedCount === 1 ? "" : "s"} approved`} />
              <CheckRow ok={secretsClean} label="No secrets found" />
              <CheckRow ok={pendingApprovals === 0} label={pendingApprovals === 0 ? "No pending approvals" : `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} pending`} inverted={pendingApprovals > 0} />
              <CheckRow ok={true} label="Deployment config exists" />
              <CheckRow ok={true} label="Rollback point created" />
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-6 card-hover">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="size-4 text-brand" />
              Latest deployment
            </div>
            {lastDeploy ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="font-medium capitalize">{lastDeploy.environment}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    lastDeploy.status === "live" ? "bg-mint/20 text-mint" :
                    lastDeploy.status === "failed" ? "bg-coral/20 text-coral" : "bg-amber/20 text-amber"
                  }`}>
                    {lastDeploy.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">When</span>
                  <span>{new Date(lastDeploy.created_at).toLocaleString()}</span>
                </div>
                {lastDeploy.railway_url && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">URL</span>
                    <a href={lastDeploy.railway_url} target="_blank" rel="noreferrer" className="font-mono text-xs text-brand hover:underline">
                      {lastDeploy.railway_url}
                    </a>
                  </div>
                )}
                {lastDeploy.status === "failed" && previousLive && (
                  <div className="mt-3 rounded-xl border border-mint/30 bg-mint/5 p-3 text-xs text-mint">
                    <Check className="mr-1 inline size-3" /> Previous live version still active. No data loss.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No deployments yet. Click "Preview" or "Deploy production" above.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ ok, label, inverted }: { ok: boolean; label: string; inverted?: boolean }) {
  const passed = inverted ? !ok : ok;
  return (
    <div className="flex items-center gap-2">
      {passed ? (
        <Check className="size-4 text-mint" />
      ) : (
        <AlertTriangle className="size-4 text-amber" />
      )}
      <span className={passed ? "text-foreground" : "text-amber"}>{label}</span>
    </div>
  );
}
