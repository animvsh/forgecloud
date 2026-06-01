import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Sparkles, Palette, Code2, Database, Bug, Rocket, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/app/agents")({
  component: AgentsScreen,
});

const agents = [
  { name: "Product Agent", job: "Turns ideas into tasks", working: "CRM v1 backlog", status: "Planning", update: "Drafted 8 tasks from your brief", icon: Sparkles, color: "var(--amber)" },
  { name: "Design Agent", job: "Creates the UI", working: "Lead dashboard layout", status: "Designing", update: "Picked clean Notion-style theme", icon: Palette, color: "var(--sky)" },
  { name: "Frontend Agent", job: "Builds pages", working: "Lead dashboard", status: "Building", update: "Created dashboard table and filter bar", icon: Code2, color: "var(--violet)" },
  { name: "Backend Agent", job: "Builds APIs & data", working: "Leads table", status: "Building", update: "Wrote schema for leads + notes", icon: Database, color: "var(--mint)" },
  { name: "QA Agent", job: "Tests the app", working: "Add lead form", status: "Testing", update: "Found 1 validation bug, opened task", icon: Bug, color: "var(--coral)" },
  { name: "DevOps Agent", job: "Deploys safely", working: "Preview env", status: "Ready", update: "Preview deployed to /preview", icon: Rocket, color: "var(--violet)" },
  { name: "Safety Agent", job: "Blocks risky changes", working: "DB migration check", status: "Watching", update: "Flagged 1 change for approval", icon: ShieldCheck, color: "var(--coral)" },
];

function AgentsScreen() {
  return (
    <div>
      <ScreenHeader title="Agents" subtitle="Your AI team and what each one is doing right now." />
      <div className="grid gap-4 p-8 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div key={a.name} className="rounded-3xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="squircle grid size-12 place-items-center text-white" style={{ background: a.color }}>
                <a.icon className="size-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{a.name}</div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{a.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">{a.job}</div>
              </div>
            </div>
            <div className="mt-5 space-y-2 text-sm">
              <div><span className="text-muted-foreground">Working on:</span> {a.working}</div>
              <div><span className="text-muted-foreground">Last update:</span> {a.update}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
