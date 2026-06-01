import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { HeroDiagram } from "@/components/HeroDiagram";
import { ArrowRight, Bot, GitBranch, Layout, Rocket, ShieldCheck, Sparkles } from "lucide-react";
import { useForgeState, useResetProject } from "@/lib/client";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ForgeCloud — Turn your team into a software team" },
      {
        name: "description",
        content: "Describe what you want. AI agents build it. Your team reviews, approves, and ships together.",
      },
      { property: "og:title", content: "ForgeCloud" },
      { property: "og:description", content: "Build software with AI agents — your team stays in control." },
    ],
  }),
  component: Landing,
});

const features = [
  { title: "AI software team", color: "var(--violet)", icon: Bot, desc: "Product, Design, Frontend, Backend, QA, DevOps, Auth, Safety, Recovery agents." },
  { title: "Plain-English pull requests", color: "var(--sky)", icon: GitBranch, desc: "Every change explained like a teammate wrote it. No code jargon." },
  { title: "Live preview", color: "var(--mint)", icon: Layout, desc: "Click around the app as agents build it. Comment and request edits inline." },
  { title: "Approval gates", color: "var(--amber)", icon: ShieldCheck, desc: "Risky changes pause for human review. Database edits, deploys, secrets." },
  { title: "Failure recovery", color: "var(--coral)", icon: ShieldCheck, desc: "When agents fail, they fall back, roll back, or escalate. Never silently broken." },
  { title: "One-click deploy", color: "var(--violet)", icon: Rocket, desc: "Preview and production deploys with built-in rollback." },
];

const testimonials = [
  "“Sarah requested the follow-up field. Backend Agent flagged the schema change. I approved it in 4 seconds.”",
  "“Build failed. QA caught it. Fixed. I didn't even know it broke.”",
  "“It detected the API key I pasted in chat before it ever hit code.”",
];

function Landing() {
  const navigate = useNavigate();
  const { data } = useForgeState();
  const reset = useResetProject();
  const [showReset, setShowReset] = useState(false);
  const projectName = data?.project?.name ?? "New Project";
  const hasExistingBuild = (data?.tasks?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-background">
      <SiteNav />

      <main>
        <section className="px-4 pt-12 pb-20">
          <HeroDiagram />
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-brand" />
              Non-technical teams ship software with AI agents
            </div>
            <h1 className="text-5xl md:text-7xl font-bold leading-[1.05]">
              Turn your team into<br />a software team.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-muted-foreground text-lg">
              Describe what you want. AI agents build it. Your team reviews, approves, and ships together.
            </p>
            <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
              <Link
                to="/app/intake"
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 font-medium text-brand-foreground shadow-lg shadow-brand/30 hover:brightness-105"
              >
                Start building <ArrowRight className="size-4" />
              </Link>
              {hasExistingBuild ? (
                <>
                  <Link
                    to="/app/index"
                    className="rounded-full border border-border bg-card px-6 py-3.5 font-medium hover:bg-muted"
                  >
                    Try the demo
                  </Link>
                  <Link
                    to="/app/chat"
                    className="rounded-full border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground hover:bg-muted"
                  >
                    Open chat
                  </Link>
                  <button
                    onClick={() => setShowReset((v) => !v)}
                    className="rounded-full border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground hover:bg-muted"
                  >
                    Reset demo
                  </button>
                  {showReset && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4" onClick={() => setShowReset(false)}>
                      <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-left" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold">Reset demo?</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Wipes all tasks, PRs, agents, deployments, and chat. The demo project will be re-seeded on next visit.
                        </p>
                        <div className="mt-4 flex justify-end gap-2">
                          <button onClick={() => setShowReset(false)} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
                          <button
                            onClick={async () => { await reset.mutateAsync(); setShowReset(false); navigate({ to: "/app/index" }); }}
                            className="rounded-full bg-coral px-4 py-2 text-sm font-medium text-white hover:brightness-110"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Link to="/app/index" className="rounded-full border border-border bg-card px-6 py-3.5 font-medium hover:bg-muted">
                  Try the demo
                </Link>
              )}
            </div>
            {data && !data.aiAvailable && (
              <p className="mt-4 text-xs text-muted-foreground">
                AI in fallback mode. Set <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">ANTHROPIC_API_KEY</code> for live intelligence.
              </p>
            )}
          </div>
        </section>

        <section id="product" className="px-4 pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-brand">One platform</p>
              <h2 className="mt-2 text-4xl md:text-5xl font-bold">Everything your team needs to ship.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-3xl border border-border bg-card p-7 hover:shadow-lg transition">
                  <div className="squircle mb-5 flex size-12 items-center justify-center" style={{ background: f.color }}>
                    <f.icon className="size-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="agents" className="px-4 pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-brand">Your AI team</p>
              <h2 className="mt-2 text-4xl md:text-5xl font-bold">Nine agents, one product.</h2>
              <p className="mt-4 text-muted-foreground">Each one has a job, a permission set, and a fallback model.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { name: "Product Agent", role: "turns ideas into tasks" },
                { name: "Design Agent", role: "creates UI direction" },
                { name: "Frontend Agent", role: "builds pages" },
                { name: "Backend Agent", role: "APIs + database" },
                { name: "Auth Agent", role: "team access" },
                { name: "QA Agent", role: "tests the app" },
                { name: "DevOps Agent", role: "deploys" },
                { name: "Safety Agent", role: "blocks risky changes" },
                { name: "Recovery Agent", role: "handles failures" },
              ].map((a) => (
                <div key={a.name} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-violet/15 text-violet">
                    <Bot className="size-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="flow" className="px-4 pb-24">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-brand">What your team sees</p>
              <h2 className="mt-2 text-4xl md:text-5xl font-bold">Plain English. No code.</h2>
            </div>
            <div className="space-y-3">
              {[
                "“Homepage updated by Design Agent.”",
                "“Auth bug fixed by Backend Agent.”",
                "“Pricing page approved by Sarah.”",
                "“Database migration blocked because it was risky.”",
                "“Deployment failed, fallback build restored.”",
              ].map((line) => (
                <div key={line} className="rounded-2xl border border-border bg-card p-5 text-lg">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-24">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-brand">What teams say</p>
              <h2 className="mt-2 text-4xl md:text-5xl font-bold">Built for non-technical teams.</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {testimonials.map((t) => (
                <div key={t} className="rounded-2xl border border-border bg-card p-6 text-sm">
                  {t}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-4xl md:text-5xl font-bold">Ready to ship?</h2>
            <p className="mt-4 text-muted-foreground">Start with one project. Add your team. Watch the agents work.</p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link to="/app/intake" className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3.5 font-medium text-background hover:opacity-90">
                Start building <ArrowRight className="size-4" />
              </Link>
              <Link to="/app/index" className="rounded-full border border-border bg-card px-6 py-3.5 font-medium hover:bg-muted">
                Try the demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block size-4 rounded bg-foreground" />
            ForgeCloud
          </div>
          <div>GitHub was built for developers. ForgeCloud is built for everyone else.</div>
        </div>
      </footer>
    </div>
  );
}
