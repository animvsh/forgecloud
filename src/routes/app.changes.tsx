import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Check, Undo2, Eye, X, AlertTriangle, Loader2 } from "lucide-react";
import { useForgeState, useApprovePr, useDecideApproval } from "@/lib/client";
import { useState } from "react";

export const Route = createFileRoute("/app/changes")({
  component: ChangesScreen,
});

function ChangesScreen() {
  const { data, isLoading } = useForgeState();
  const approvePr = useApprovePr();
  const decideApproval = useDecideApproval();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const prs = data.prs;
  const approvals = data.approvals;

  async function approve(prId: string) {
    setBusy(prId);
    try {
      await approvePr.mutateAsync(prId);
    } finally {
      setBusy(null);
    }
  }

  async function decide(approvalId: string, decision: "approve" | "reject") {
    setBusy(approvalId);
    try {
      await decideApproval.mutateAsync({ approvalId, decision });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Changes"
        subtitle="Plain-English history. Approve, request edits, or roll back."
      />

      <div className="space-y-6 p-8">
        {approvals.length > 0 && (
          <div className="rounded-3xl border-2 border-amber bg-amber/5 p-6">
            <div className="flex items-center gap-2 text-amber">
              <AlertTriangle className="size-4" />
              <h3 className="font-semibold">Approval queue</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Risky changes need your review before they ship.
            </p>
            <div className="mt-4 space-y-3">
              {approvals.map((a) => (
                <div key={a.id} className="rounded-2xl border border-amber/40 bg-background p-4">
                  <div className="flex items-center gap-2 text-xs text-amber">
                    <span className="rounded-full bg-amber/20 px-2 py-0.5 font-semibold uppercase">{a.risk_level}</span>
                    <span>•</span>
                    <span>Waiting for human approval</span>
                  </div>
                  <div className="mt-2 font-semibold">{a.reason}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.details}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => decide(a.id, "approve")}
                      disabled={busy === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-mint px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                    >
                      {busy === a.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      Approve
                    </button>
                    <button
                      onClick={() => decide(a.id, "reject")}
                      disabled={busy === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-coral bg-coral/10 px-4 py-1.5 text-xs font-semibold text-coral hover:bg-coral/20 disabled:opacity-40"
                    >
                      <X className="size-3" /> Reject
                    </button>
                    <button
                      onClick={() => alert("Safety Agent: this change modifies the database schema. The agent will add a new column and update the affected forms.")}
                      className="rounded-full border border-border px-4 py-1.5 text-xs hover:bg-muted"
                    >
                      Ask AI to explain
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-lg font-semibold">All changes</h3>
          {prs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No changes yet. Agents create PRs as they build features.
            </div>
          ) : (
            prs.map((p) => (
              <div key={p.id} className="rounded-3xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-foreground px-2.5 py-1 text-xs font-mono text-background">
                    PR #{p.number}
                  </span>
                  <div className="font-semibold">{p.title}</div>
                  <span className="text-xs text-muted-foreground">{p.source_branch} → {p.target_branch}</span>
                  <RiskPill level={p.risk_level} />
                  <StatusPill status={p.status} />
                  {p.preview_url && (
                    <Link to="/app/preview" className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">
                      <Eye className="size-3" /> Preview
                    </Link>
                  )}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{p.summary}</p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {p.files_changed} file{p.files_changed !== 1 ? "s" : ""} changed
                  {p.approved_at && ` · Approved by ${p.approver_name} ${new Date(p.approved_at).toLocaleTimeString()}`}
                </div>
                {p.status === "open" && p.requires_approval === 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => approve(p.id)}
                      disabled={busy === p.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                    >
                      {busy === p.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      Approve
                    </button>
                    <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      <Undo2 className="size-3" /> Rollback
                    </button>
                    <button className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      View diff
                    </button>
                  </div>
                )}
                {p.status === "blocked" && (
                  <div className="mt-3 rounded-xl border border-coral bg-coral/10 p-3 text-xs text-coral">
                    <AlertTriangle className="mr-1 inline size-3" /> Blocked by Safety Agent — secret detected
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function RiskPill({ level }: { level: string }) {
  const colors: Record<string, string> = {
    low: "bg-mint/20 text-mint",
    med: "bg-amber/20 text-amber",
    high: "bg-coral/20 text-coral",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[level] ?? "bg-muted"}`}>
      {level} risk
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-sky/20 text-sky",
    approved: "bg-mint/20 text-mint",
    rejected: "bg-coral/20 text-coral",
    blocked: "bg-coral/20 text-coral",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}
