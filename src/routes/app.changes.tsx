import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Check, Undo2, Eye, X } from "lucide-react";

export const Route = createFileRoute("/app/changes")({
  component: ChangesScreen,
});

const changes = [
  { v: "v0.5", title: "Added login page", agent: "Auth Agent", risk: "Med", body: "Auth Agent added an email + password login page and protected the dashboard routes.", files: 6 },
  { v: "v0.4", title: "Fixed lead form bug", agent: "QA + Frontend Agent", risk: "Low", body: "QA Agent caught an empty-state crash on submit. Frontend Agent shipped a fix.", files: 2 },
  { v: "v0.3", title: "Added leads database", agent: "Backend Agent", risk: "Med", body: "Created leads, notes, follow_ups tables and wired the API.", files: 4 },
  { v: "v0.2", title: "Built lead dashboard", agent: "Frontend Agent", risk: "Low", body: "Dashboard with sortable columns and filter bar.", files: 9 },
  { v: "v0.1", title: "Project setup", agent: "DevOps Agent", risk: "Low", body: "Initial workspace, repo, and preview environment.", files: 14 },
];

function ChangesScreen() {
  return (
    <div>
      <ScreenHeader title="Changes" subtitle="Plain-English history. Approve, request edits, or roll back." />
      <div className="space-y-3 p-8">
        {changes.map((c) => (
          <div key={c.v} className="rounded-3xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">{c.v}</span>
              <div className="font-semibold">{c.title}</div>
              <span className="text-xs text-muted-foreground">{c.agent}</span>
              <span
                className="ml-auto rounded-full px-2.5 py-1 text-xs"
                style={{ background: c.risk === "Med" ? "var(--amber)" : "var(--mint)" }}
              >
                Risk: {c.risk}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{c.body}</p>
            <div className="mt-2 text-xs text-muted-foreground">{c.files} files changed</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground">
                <Check className="size-3.5" /> Approve
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-muted">
                <X className="size-3.5" /> Request edits
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Eye className="size-3.5" /> View code
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Undo2 className="size-3.5" /> Rollback
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
