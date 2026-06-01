import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";

export const Route = createFileRoute("/app/tasks")({
  component: TasksScreen,
});

type Task = { title: string; agent: string; reviewer: string; risk: "Low" | "Med" | "High" };
const columns: { name: string; tone: string; tasks: Task[] }[] = [
  { name: "Backlog", tone: "var(--muted)", tasks: [
    { title: "Email reminders", agent: "Ops Agent", reviewer: "David", risk: "Low" },
    { title: "Import CSV", agent: "Backend Agent", reviewer: "Sarah", risk: "Med" },
    { title: "Brand colors", agent: "Design Agent", reviewer: "Animesh", risk: "Low" },
  ]},
  { name: "Building", tone: "var(--sky)", tasks: [
    { title: "Lead dashboard", agent: "Frontend Agent", reviewer: "Sarah", risk: "Low" },
    { title: "Add lead form", agent: "Frontend Agent", reviewer: "Sarah", risk: "Low" },
    { title: "Database schema", agent: "Backend Agent", reviewer: "Animesh", risk: "Med" },
  ]},
  { name: "Review", tone: "var(--amber)", tasks: [
    { title: "Login page", agent: "Auth Agent", reviewer: "Animesh", risk: "Med" },
  ]},
  { name: "Done", tone: "var(--mint)", tasks: [
    { title: "Project setup", agent: "DevOps Agent", reviewer: "Animesh", risk: "Low" },
  ]},
];

function TasksScreen() {
  return (
    <div>
      <ScreenHeader title="Tasks" subtitle="Everything your agents and team are working on." />
      <div className="grid gap-4 p-8 md:grid-cols-4">
        {columns.map((col) => (
          <div key={col.name} className="rounded-3xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2 px-1">
              <span className="size-2.5 rounded-full" style={{ background: col.tone }} />
              <div className="text-sm font-semibold">{col.name}</div>
              <div className="ml-auto text-xs text-muted-foreground">{col.tasks.length}</div>
            </div>
            <div className="space-y-2">
              {col.tasks.map((t) => (
                <div key={t.title} className="rounded-2xl border border-border bg-background p-3">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">{t.agent}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5">👤 {t.reviewer}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-foreground"
                      style={{ background: t.risk === "High" ? "var(--coral)" : t.risk === "Med" ? "var(--amber)" : "var(--mint)" }}
                    >
                      {t.risk}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
