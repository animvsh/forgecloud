import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AlertTriangle, ShieldCheck, RefreshCcw, Undo2, KeyRound, Database, Wifi } from "lucide-react";

export const Route = createFileRoute("/app/failures")({
  component: FailuresScreen,
});

const events = [
  { icon: RefreshCcw, color: "var(--amber)", failure: "Main AI model failed", what: "Frontend Agent timed out", recovery: "Switched to backup model", status: "Recovered" },
  { icon: Undo2, color: "var(--coral)", failure: "Build failed", what: "Button component broke the app", recovery: "Rolled back to last working version", status: "Recovered" },
  { icon: KeyRound, color: "var(--coral)", failure: "Secret detected", what: "API key found in code", recovery: "Blocked change before commit", status: "Blocked" },
  { icon: Database, color: "var(--amber)", failure: "Unsafe DB migration", what: "Agent tried to drop a column", recovery: "Required human approval", status: "Awaiting" },
  { icon: Wifi, color: "var(--amber)", failure: "Deploy timeout", what: "Hosting provider slow", recovery: "Saved preview, retried, succeeded", status: "Recovered" },
  { icon: AlertTriangle, color: "var(--amber)", failure: "Bad output", what: "Agent returned broken JSON", recovery: "Regenerated only the failed step", status: "Recovered" },
];

function FailuresScreen() {
  return (
    <div>
      <ScreenHeader
        title="Failure recovery"
        subtitle="What broke, and how ForgeCloud kept your project safe."
        action={
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <ShieldCheck className="size-4 text-brand" /> All systems healthy
          </div>
        }
      />
      <div className="grid gap-4 p-8 md:grid-cols-2">
        {events.map((e, i) => (
          <div key={i} className="rounded-3xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="squircle grid size-12 shrink-0 place-items-center text-white" style={{ background: e.color }}>
                <e.icon className="size-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{e.failure}</div>
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{ background: e.status === "Blocked" ? "var(--coral)" : e.status === "Awaiting" ? "var(--amber)" : "var(--mint)" }}
                  >
                    {e.status}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-sm">
                  <div><span className="text-muted-foreground">What happened:</span> {e.what}</div>
                  <div><span className="text-muted-foreground">Recovery:</span> {e.recovery}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
