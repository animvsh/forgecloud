import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  Check,
  Undo2,
  Eye,
  X,
  AlertTriangle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Clock,
  Minus,
  FileCode2,
  MessageSquarePlus,
  Send,
} from "lucide-react";
import {
  useForgeState,
  useApprovePr,
  useDecideApproval,
  useExplain,
  useRollbackPr,
  useRequestEdits,
} from "@/lib/client";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/changes")({
  component: ChangesScreen,
});

type ChangeRow = {
  id: string;
  pr_id: string;
  file_path: string;
  technical_diff: string;
  plain_english_summary: string;
  risk_explanation?: string | null;
  agent_id?: string | null;
};

type RiskStatus = "pass" | "fail" | "pending" | "n/a";
type RiskChecks = {
  build: RiskStatus;
  qa: RiskStatus;
  secretScan: RiskStatus;
  migration: RiskStatus;
};

type PR = {
  id: string;
  number: number;
  title: string;
  summary: string;
  source_branch: string;
  target_branch: string;
  risk_level: string;
  status: string;
  files_changed: number;
  preview_url?: string | null;
  screenshot_url?: string | null;
  approved_at?: string | null;
  approver_name?: string | null;
  merged_at?: number | null;
  requires_approval: number;
  changes?: ChangeRow[];
  riskChecks?: RiskChecks;
};

type Approval = {
  id: string;
  risk_level: string;
  reason: string;
  details: string;
};

function ChangesScreen() {
  const { data, isLoading } = useForgeState();
  const approvePr = useApprovePr();
  const decideApproval = useDecideApproval();
  const explain = useExplain();
  const rollback = useRollbackPr();
  const requestEdits = useRequestEdits();

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRollbackId, setConfirmRollbackId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [expandedChanges, setExpandedChanges] = useState<Record<string, boolean>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [editsDraft, setEditsDraft] = useState<Record<string, string>>({});
  const [editsBusyId, setEditsBusyId] = useState<string | null>(null);

  const [explainOpen, setExplainOpen] = useState(false);
  const [explainTitle, setExplainTitle] = useState<string>("");
  const [explainText, setExplainText] = useState<string>("");
  const [explainProvider, setExplainProvider] = useState<string>("");
  const [explainLoadingFor, setExplainLoadingFor] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const prs: PR[] = data.prs ?? [];
  const approvals: Approval[] = data.approvals ?? [];

  async function approve(prId: string) {
    setBusy(prId);
    try {
      await approvePr.mutateAsync({ prId });
      toast.success("PR approved");
    } catch (err) {
      toast.error("Approve failed", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function decide(approvalId: string, decision: "approve" | "reject") {
    setBusy(approvalId);
    try {
      await decideApproval.mutateAsync({ approvalId, decision });
      toast.success(decision === "approve" ? "Approved" : "Rejected");
    } catch (err) {
      toast.error("Decision failed", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function openExplainForApproval(a: Approval) {
    setExplainLoadingFor(a.id);
    setExplainTitle(a.reason);
    setExplainText("");
    setExplainProvider("");
    setExplainOpen(true);
    try {
      const res = await explain.mutateAsync({ approvalId: a.id });
      setExplainText(res.explanation);
      setExplainProvider(res.provider);
    } catch (err) {
      setExplainText(`Couldn't load explanation: ${(err as Error).message}`);
    } finally {
      setExplainLoadingFor(null);
    }
  }

  async function openExplainForPr(pr: PR) {
    setExplainLoadingFor(pr.id);
    setExplainTitle(pr.title);
    setExplainText("");
    setExplainProvider("");
    setExplainOpen(true);
    try {
      const res = await explain.mutateAsync({ prId: pr.id });
      setExplainText(res.explanation);
      setExplainProvider(res.provider);
    } catch (err) {
      setExplainText(`Couldn't load explanation: ${(err as Error).message}`);
    } finally {
      setExplainLoadingFor(null);
    }
  }

  async function confirmRollback(prId: string) {
    setRollingBackId(prId);
    try {
      await rollback.mutateAsync({ prId });
      toast.success("Rollback complete", {
        description: "The PR was reverted and a recovery event was logged.",
      });
      setConfirmRollbackId(null);
    } catch (err) {
      toast.error("Rollback failed", { description: (err as Error).message });
    } finally {
      setRollingBackId(null);
    }
  }

  async function submitEdits(prId: string) {
    const message = (editsDraft[prId] ?? "").trim();
    if (!message) {
      toast.error("Write a short note for the agent first.");
      return;
    }
    setEditsBusyId(prId);
    try {
      await requestEdits.mutateAsync({ prId, message });
      toast.success("Edits requested", {
        description: "A follow-up task was created for the agent.",
      });
      setEditsDraft((d) => ({ ...d, [prId]: "" }));
    } catch (err) {
      toast.error("Request failed", { description: (err as Error).message });
    } finally {
      setEditsBusyId(null);
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
              <h2 className="font-semibold">Approval queue</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Risky changes need your review before they ship.
            </p>
            <div className="mt-4 space-y-3">
              {approvals.map((a) => (
                <div key={a.id} className="rounded-2xl border border-amber/40 bg-background p-4">
                  <div className="flex items-center gap-2 text-xs text-amber">
                    <span className="rounded-full bg-amber/20 px-2 py-0.5 font-semibold uppercase">
                      {a.risk_level}
                    </span>
                    <span>•</span>
                    <span>Waiting for human approval</span>
                  </div>
                  <div className="mt-2 font-semibold">{a.reason}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.details}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => decide(a.id, "approve")}
                      disabled={busy === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-mint px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                    >
                      {busy === a.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
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
                      onClick={() => openExplainForApproval(a)}
                      disabled={explainLoadingFor === a.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                    >
                      {explainLoadingFor === a.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3 text-violet" />
                      )}
                      Ask AI to explain
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {prs.length > 0 && (
          <div className="rounded-3xl border border-border bg-card p-5 card-hover">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-muted-foreground">Version log</div>
              <div className="text-xs text-muted-foreground">
                {prs.filter((p) => p.status === "approved").length} shipped · {prs.length} total
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {[...prs]
                .sort((a, b) => a.number - b.number)
                .map((p, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const shipped = p.status === "approved";
                  return (
                    <div key={p.id} className="flex items-center gap-1.5">
                      <div
                        className={`rounded-xl border px-2.5 py-1.5 text-[11px] ${
                          shipped
                            ? "border-mint/30 bg-mint/10 text-foreground"
                            : p.status === "rolled_back"
                              ? "border-coral/30 bg-coral/10 text-coral"
                              : "border-border bg-background text-muted-foreground"
                        }`}
                        title={p.title}
                      >
                        <span className="font-mono font-semibold">v0.{p.number}</span>
                        <span className="ml-1.5 hidden sm:inline">
                          {p.title.length > 22 ? p.title.slice(0, 22) + "…" : p.title}
                        </span>
                      </div>
                      {!isLast && <span className="text-muted-foreground">›</span>}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">All changes</h2>
          {prs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              No changes yet. Agents create PRs as they build features.
            </div>
          ) : (
            prs.map((p) => {
              const changes = p.changes ?? [];
              const expanded = !!expandedChanges[p.id];
              const isRollbackTarget = confirmRollbackId === p.id;
              return (
                <div key={p.id} className="rounded-3xl border border-border bg-card p-6 card-hover">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-foreground px-2.5 py-1 text-xs font-mono text-background">
                      PR #{p.number}
                    </span>
                    <div className="font-semibold">{p.title}</div>
                    <span className="text-xs text-muted-foreground">
                      {p.source_branch} → {p.target_branch}
                    </span>
                    <RiskPill level={p.risk_level} />
                    <StatusPill status={p.status} />
                    {p.preview_url && (
                      <Link
                        to="/app/preview"
                        className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline transition-colors"
                      >
                        <Eye className="size-3" /> Preview
                      </Link>
                    )}
                  </div>

                  <p className="mt-3 text-sm text-muted-foreground">{p.summary}</p>

                  {p.riskChecks && <RiskMatrix checks={p.riskChecks} />}

                  <div className="mt-3 rounded-xl border border-border bg-background p-3 text-xs font-mono text-muted-foreground">
                    {p.files_changed} file{p.files_changed !== 1 ? "s" : ""} changed
                    {p.approved_at &&
                      ` · Approved by ${p.approver_name} ${new Date(p.approved_at).toLocaleTimeString()}`}
                  </div>

                  {p.screenshot_url && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Screenshot
                      </div>
                      <img
                        src={p.screenshot_url}
                        alt={p.title}
                        className="aspect-video w-full rounded-xl border border-border bg-muted object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}

                  {changes.length > 0 && (
                    <div className="mt-3">
                      <button
                        onClick={() => setExpandedChanges((s) => ({ ...s, [p.id]: !s[p.id] }))}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        {expanded ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                        {expanded ? "Hide" : "Show"} {changes.length} change
                        {changes.length !== 1 ? "s" : ""}
                      </button>
                      {expanded && (
                        <ul className="mt-3 space-y-2">
                          {changes.map((c) => (
                            <li
                              key={c.id}
                              className="rounded-xl border border-border bg-background p-3"
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <FileCode2 className="size-3 text-muted-foreground" />
                                <span className="font-mono text-foreground">{c.file_path}</span>
                              </div>
                              <p className="mt-1.5 text-sm text-foreground/90">
                                {c.plain_english_summary}
                              </p>
                              {c.risk_explanation && (
                                <p className="mt-1.5 text-xs text-coral">
                                  <AlertTriangle className="mr-1 inline size-3" />
                                  {c.risk_explanation}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {changes.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedDiffs((s) => ({ ...s, [p.id]: !s[p.id] }))}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-brand hover:text-foreground transition-colors"
                        aria-expanded={!!expandedDiffs[p.id]}
                      >
                        <ChevronRight
                          className={`size-3 transition-transform ${expandedDiffs[p.id] ? "rotate-90" : ""}`}
                        />
                        Advanced (technical diff)
                      </button>
                      {expandedDiffs[p.id] && (
                        <div className="mt-3 space-y-3">
                          {changes.map((c) => (
                            <div key={`diff-${c.id}`} className="space-y-1.5">
                              <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-mono text-muted-foreground">
                                <FileCode2 className="size-3" />
                                <span className="text-foreground">{c.file_path}</span>
                              </div>
                              <pre className="text-xs font-mono whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 overflow-auto max-h-80">
                                {c.technical_diff || "(no diff captured)"}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {p.status === "open" && p.requires_approval === 0 && (
                    <>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => approve(p.id)}
                          disabled={busy === p.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 hover:scale-105 transition-all disabled:opacity-40"
                        >
                          {busy === p.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Check className="size-3" />
                          )}
                          Approve
                        </button>
                        {p.merged_at ? (
                          <button
                            onClick={() => setConfirmRollbackId(p.id)}
                            disabled={rollingBackId === p.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40"
                          >
                            <Undo2 className="size-3" /> Rollback
                          </button>
                        ) : null}
                        <button
                          onClick={() => openExplainForPr(p)}
                          disabled={explainLoadingFor === p.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors disabled:opacity-40"
                        >
                          {explainLoadingFor === p.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Sparkles className="size-3 text-violet" />
                          )}
                          Ask AI to explain
                        </button>
                      </div>

                      {isRollbackTarget && (
                        <div className="mt-3 rounded-xl border border-coral/40 bg-coral/5 p-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 size-4 text-coral" />
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-foreground">
                                Roll back PR #{p.number}?
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                The Recovery Agent will revert this change and log a recovery event.
                                This cannot be undone from the UI.
                              </p>
                              <div className="mt-3 flex items-center gap-2">
                                <button
                                  onClick={() => confirmRollback(p.id)}
                                  disabled={rollingBackId === p.id}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
                                >
                                  {rollingBackId === p.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <Undo2 className="size-3" />
                                  )}
                                  Confirm rollback
                                </button>
                                <button
                                  onClick={() => setConfirmRollbackId(null)}
                                  disabled={rollingBackId === p.id}
                                  className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 rounded-xl border border-border bg-background p-3">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <MessageSquarePlus className="size-3" /> Request edits
                        </label>
                        <textarea
                          value={editsDraft[p.id] ?? ""}
                          onChange={(e) => setEditsDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                          rows={2}
                          placeholder="e.g. Make the CTA button purple and add a confirmation toast."
                          className="mt-2 w-full resize-none rounded-lg border border-border bg-card p-2 text-sm focus:border-brand focus:outline-none"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => submitEdits(p.id)}
                            disabled={editsBusyId === p.id || !(editsDraft[p.id] ?? "").trim()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:brightness-105 disabled:opacity-40"
                          >
                            {editsBusyId === p.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Send className="size-3" />
                            )}
                            Send to agent
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {p.status === "blocked" && (
                    <div className="mt-3 rounded-xl border border-coral bg-coral/10 p-3 text-xs text-coral">
                      <AlertTriangle className="mr-1 inline size-3" /> Blocked by Safety Agent —
                      secret detected
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {explainOpen && (
        <Modal onClose={() => setExplainOpen(false)}>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet" />
            <h3 className="text-lg font-semibold">AI explanation</h3>
          </div>
          {explainTitle && <p className="mt-1 text-xs text-muted-foreground">{explainTitle}</p>}
          <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-2xl border border-border bg-background p-4 text-sm leading-relaxed text-foreground/90">
            {explainLoadingFor ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Thinking through this change…
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{explainText}</div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {explainProvider ? `via ${explainProvider}` : ""}
            </div>
            <button
              onClick={() => setExplainOpen(false)}
              className="rounded-full border border-border px-4 py-1.5 text-xs hover:bg-muted"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-6 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
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
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[level] ?? "bg-muted"}`}
    >
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
    reverted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colors[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}

function RiskMatrix({ checks }: { checks: RiskChecks }) {
  const items: Array<{ key: keyof RiskChecks; label: string }> = [
    { key: "build", label: "Build" },
    { key: "qa", label: "QA" },
    { key: "secretScan", label: "Secrets" },
    { key: "migration", label: "Migration" },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <RiskCell key={it.key} label={it.label} status={checks[it.key]} />
      ))}
    </div>
  );
}

function RiskCell({ label, status }: { label: string; status: RiskStatus }) {
  const styles: Record<RiskStatus, { cls: string; Icon: typeof Check }> = {
    pass: {
      cls: "border-mint/30 bg-mint/10 text-mint",
      Icon: Check,
    },
    fail: {
      cls: "border-coral/40 bg-coral/10 text-coral",
      Icon: X,
    },
    pending: {
      cls: "border-amber/40 bg-amber/10 text-amber",
      Icon: Clock,
    },
    "n/a": {
      cls: "border-border bg-muted/40 text-muted-foreground",
      Icon: Minus,
    },
  };
  const { cls, Icon } = styles[status] ?? styles["n/a"];
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}
    >
      <Icon className="size-3" />
      <span className="uppercase tracking-wide">{label}</span>
      <span className="ml-auto text-[10px] opacity-80">{status}</span>
    </div>
  );
}
