import { createFileRoute, Link } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ArrowUp, Sparkles, AlertTriangle, Loader2, Bot } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useForgeState, useSendChat } from "@/lib/client";

export const Route = createFileRoute("/app/chat")({
  component: ChatScreen,
});

const DEMO_PROMPTS = [
  "Build a simple CRM for my sales team",
  "Build a waitlist app for my new product",
  "Build an internal tool for tracking job applications",
];

function ChatScreen() {
  const { data, isLoading } = useForgeState();
  const send = useSendChat();
  const [input, setInput] = useState("");
  const [addingFeatureFor, setAddingFeatureFor] = useState<string | null>(null);
  const [extraFeature, setExtraFeature] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.chatMessages?.length]);

  const hasProject = (data?.tasks?.length ?? 0) > 0;

  async function handleSend(text: string) {
    if (!text.trim() || send.isPending) return;
    setInput("");
    await send.mutateAsync({ message: text });
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="rounded-3xl border border-border gradient-header px-6 py-4 mb-4">
        <ScreenHeader
          title="Chat"
          subtitle="Describe what to build. Your AI team takes it from here."
          action={
            data && !data.aiAvailable ? (
              <span className="rounded-full border border-amber bg-amber/10 px-3 py-1 text-xs text-amber">
                <AlertTriangle className="mr-1 inline size-3" />
                Fallback AI mode
              </span>
            ) : null
          }
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 pb-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {data && data.chatMessages.length === 0 && !hasProject && (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card p-8 text-center card-hover animate-in fade-in">
              <div className="mx-auto flex size-12 items-center justify-center squircle" style={{ background: "var(--violet)" }}>
                <Sparkles className="size-6 text-white" />
              </div>
              <h2 className="mt-4 text-xl font-semibold">What do you want to build?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Type any product idea. The Product Agent will turn it into a build plan.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-3">
                {DEMO_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSend(p)}
                    className="rounded-2xl border border-border bg-background p-4 text-left text-sm hover:border-brand hover:shadow-md transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data && hasProject && data.chatMessages.length === 0 && (
            <div className="rounded-3xl border-2 border-dashed border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">
                The project has started. Ask for a new feature or check progress.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => handleSend("Add a phone number field to the lead form")}
                  className="rounded-xl border border-border bg-background p-3 text-left text-xs hover:border-brand transition-all"
                >
                  Add a phone number field to the lead form
                </button>
                <button
                  onClick={() => handleSend("Add a search bar to the dashboard")}
                  className="rounded-xl border border-border bg-background p-3 text-left text-xs hover:border-brand transition-all"
                >
                  Add a search bar to the dashboard
                </button>
              </div>
            </div>
          )}

          {data?.chatMessages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end animate-in fade-in slide-in-from-right-2">
                  <div className="max-w-xl rounded-3xl bg-gradient-to-br from-foreground to-foreground/90 px-5 py-3 text-background shadow-md">
                    {m.content}
                  </div>
                </div>
              );
            }
            const meta = m.metadata ? (() => {
              try { return JSON.parse(m.metadata); } catch { return null; }
            })() : null;
            if (meta?.kind === "plan" && meta.plan) {
              const plan = meta.plan;
              return (
                <div key={m.id} className="space-y-3 animate-in fade-in slide-in-from-left-2">
                  <Message from="ForgeCloud">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="size-4 text-brand" />
                      I created a plan. Review before I start building.
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">{plan.summary}</div>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3">Feature</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3">Agent</th>
                            <th className="px-4 py-3">Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.features.map((f: { title: string; description: string; ownerAgent: string; riskLevel: string }, i: number) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-4 py-3 font-medium">{f.title}</td>
                              <td className="px-4 py-3 text-muted-foreground">{f.description}</td>
                              <td className="px-4 py-3">{f.ownerAgent}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${riskColor(f.riskLevel)}`}>
                                  {f.riskLevel}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        to="/app/tasks"
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-medium text-brand-foreground hover:brightness-105 transition-all"
                      >
                        Approve &amp; start building
                      </Link>
                      <button
                        type="button"
                        onClick={() => setAddingFeatureFor(m.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        Add feature
                      </button>
                      <Link
                        to="/app/intake"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        Edit plan
                      </Link>
                      <Link
                        to="/app/agents"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        See the team
                      </Link>
                    </div>
                    {addingFeatureFor === m.id && (
                      <form
                        className="mt-3 flex items-start gap-2 rounded-2xl border border-border bg-background p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!extraFeature.trim()) return;
                          const msg = `Add a feature: ${extraFeature.trim()}`;
                          setExtraFeature("");
                          setAddingFeatureFor(null);
                          void handleSend(msg);
                        }}
                      >
                        <input
                          value={extraFeature}
                          onChange={(e) => setExtraFeature(e.target.value)}
                          placeholder="e.g. add a referral link to the thank-you page"
                          className="flex-1 rounded-xl border-0 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={!extraFeature.trim()}
                          className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-30"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingFeatureFor(null); setExtraFeature(""); }}
                          className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                  </Message>
                </div>
              );
            }
            if (meta?.kind === "secret_block") {
              return (
                <Message key={m.id} from="Safety Agent">
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 text-coral" />
                    <div>
                      <div className="font-medium text-coral">Blocked</div>
                      <div className="mt-1 text-muted-foreground">{m.content}</div>
                    </div>
                  </div>
                </Message>
              );
            }
            return <Message key={m.id} from="ForgeCloud">{m.content}</Message>;
          })}

          {send.isPending && (
            <Message from="ForgeCloud">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Thinking...
              </div>
            </Message>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-2 mt-2">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder="Describe what to build next. The AI team handles the rest."
            className="flex-1 resize-none rounded-xl border-0 bg-transparent px-4 py-3 outline-none placeholder:text-muted-foreground"
            rows={2}
          />
          <button
            type="submit"
            disabled={!input.trim() || send.isPending}
            className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-violet text-white shadow-md hover:shadow-lg hover:scale-105 transition-all disabled:opacity-30 disabled:hover:scale-100"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  );
}

function Message({ from, children }: { from: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 animate-in fade-in slide-in-from-left-2">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet/15 text-violet">
        <Bot className="size-4" />
      </div>
      <div className="flex-1 rounded-3xl border border-border bg-card p-5 text-sm card-hover">
        <div className="text-xs font-medium text-muted-foreground">{from}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

function riskColor(level: string) {
  if (level === "high") return "bg-coral/20 text-coral";
  if (level === "med") return "bg-amber/20 text-amber";
  return "bg-mint/20 text-mint";
}
