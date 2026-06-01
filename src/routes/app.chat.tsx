import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ArrowUp, Sparkles, Check } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/app/chat")({
  component: ChatScreen,
});

const plan = [
  { feature: "Lead dashboard", desc: "View all leads", agent: "Product Agent" },
  { feature: "Add lead form", desc: "Add new lead info", agent: "Frontend Agent" },
  { feature: "Notes section", desc: "Track conversations", agent: "Backend Agent" },
  { feature: "Follow-up reminders", desc: "Remind sales team", agent: "Ops Agent" },
  { feature: "Login page", desc: "Team access", agent: "Auth Agent" },
];

function ChatScreen() {
  const [input, setInput] = useState("");
  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Chat" subtitle="Describe what to build. Your AI team takes it from here." />
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Message who="You">Build the first version of the CRM for my sales team.</Message>
          <Message who="ForgeCloud" agent>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-brand" />
              I created a plan. Review before I start building.
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Feature</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((p) => (
                    <tr key={p.feature} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{p.feature}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.desc}</td>
                      <td className="px-4 py-3">{p.agent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground">
                <Check className="size-4" /> Approve plan
              </button>
              <button className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                Edit plan
              </button>
              <button className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                Add feature
              </button>
            </div>
          </Message>
        </div>
      </div>
      <div className="border-t border-border bg-card px-8 py-5">
        <form
          onSubmit={(e) => { e.preventDefault(); setInput(""); }}
          className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-border bg-background px-2 py-1.5"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe a feature or change…"
            className="flex-1 bg-transparent px-4 py-2 text-sm outline-none"
          />
          <button className="grid size-9 place-items-center rounded-full bg-foreground text-background">
            <ArrowUp className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function Message({
  who,
  agent,
  children,
}: {
  who: string;
  agent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={`squircle mt-0.5 grid size-9 shrink-0 place-items-center text-xs font-semibold ${
          agent ? "text-white" : "bg-muted text-foreground"
        }`}
        style={agent ? { background: "var(--violet)" } : undefined}
      >
        {agent ? "FC" : who[0]}
      </div>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{who}</div>
        <div className="mt-1 rounded-2xl bg-card border border-border p-4">{children}</div>
      </div>
    </div>
  );
}
