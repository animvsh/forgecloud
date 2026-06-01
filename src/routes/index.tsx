import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/SiteNav";
import { HeroDiagram } from "@/components/HeroDiagram";
import { ArrowRight, Bot, GitBranch, Layout, Rocket, ShieldCheck, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ForgeCloud — Turn your team into a software team" },
      {
        name: "description",
        content:
          "Describe what you want. AI agents build it. Your team reviews, approves, and ships together.",
      },
      { property: "og:title", content: "ForgeCloud" },
      {
        property: "og:description",
        content: "Build software with AI agents — your team stays in control.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNav />

      <main>
        {/* HERO */}
        <section className="px-4 pt-12 pb-24">
          <HeroDiagram />
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-5xl md:text-7xl font-bold leading-[1.05]">
              Turn your team into<br />a software team.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-muted-foreground text-lg">
              Describe what you want. AI agents build it. Your team reviews,
              approves, and ships together.
            </p>
            <div className="mt-10 flex items-center justify-center gap-3">
              <Link
                to="/app/chat"
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 font-medium text-brand-foreground shadow-lg shadow-brand/30 hover:brightness-105"
              >
                Start building <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/app/preview"
                className="rounded-full border border-border bg-card px-6 py-3.5 font-medium hover:bg-muted"
              >
                View demo project
              </Link>
            </div>
          </div>
        </section>

        {/* FEATURE GRID */}
        <section id="product" className="px-4 pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <p className="text-sm font-medium text-brand">One platform</p>
              <h2 className="mt-2 text-4xl md:text-5xl font-bold">
                Everything your team needs to ship.
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-3xl border border-border bg-card p-7 hover:shadow-lg transition"
                >
                  <div
                    className="squircle mb-5 flex size-12 items-center justify-center"
                    style={{ background: f.color }}
                  >
                    <f.icon className="size-6 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* AGENTS */}
        <section id="agents" className="px-4 pb-24">
          <div className="mx-auto max-w-6xl rounded-[2.5rem] bg-foreground p-10 md:p-16 text-background">
            <div className="grid gap-12 md:grid-cols-2 md:items-center">
              <div>
                <p className="text-sm font-medium opacity-70">Your AI team</p>
                <h2 className="mt-2 text-4xl md:text-5xl font-bold">
                  Seven agents.<br />One mission.
                </h2>
                <p className="mt-5 max-w-md opacity-70">
                  Product, Design, Frontend, Backend, QA, DevOps, and Safety
                  agents collaborate like a real software team — with you in
                  the loop.
                </p>
                <Link
                  to="/app/agents"
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-background px-5 py-3 text-sm font-medium text-foreground"
                >
                  Meet the agents <ArrowRight className="size-4" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {agents.map((a) => (
                  <div key={a.name} className="rounded-2xl bg-white/5 p-4 border border-white/10">
                    <div className="text-xs opacity-60">{a.name}</div>
                    <div className="mt-1 text-sm font-medium">{a.task}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* FLOW */}
        <section id="flow" className="px-4 pb-24">
          <div className="mx-auto max-w-5xl text-center">
            <h2 className="text-4xl md:text-5xl font-bold">How it works</h2>
            <p className="mt-3 text-muted-foreground">From idea to deployed in one flow.</p>
            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {steps.map((s, i) => (
                <div key={s.title} className="rounded-3xl border border-border bg-card p-6 text-left">
                  <div className="text-xs font-medium text-brand">Step {i + 1}</div>
                  <div className="mt-2 font-semibold">{s.title}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="pricing" className="px-4 pb-32">
          <div className="mx-auto max-w-3xl rounded-[2.5rem] border border-border bg-card p-12 text-center">
            <h2 className="text-4xl md:text-5xl font-bold">Build your first app today.</h2>
            <p className="mt-4 text-muted-foreground">
              Free to start. No credit card. Real software in minutes.
            </p>
            <Link
              to="/app/chat"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 font-medium text-brand-foreground"
            >
              Start building <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-10 text-center text-sm text-muted-foreground">
        © 2026 ForgeCloud. All rights reserved.
      </footer>
    </div>
  );
}

const features = [
  { title: "Chat to build", desc: "Describe what you want. Agents turn it into a plan, then a working app.", icon: MessageSquare, color: "var(--violet)" },
  { title: "Tasks & boards", desc: "Linear-style boards keep every agent and human in sync.", icon: Layout, color: "var(--sky)" },
  { title: "Plain-English changes", desc: "GitHub-grade history, written so anyone can read it.", icon: GitBranch, color: "var(--amber)" },
  { title: "Live preview & comments", desc: "Click anywhere in the app to leave feedback. We convert it to tasks.", icon: Bot, color: "var(--coral)" },
  { title: "Safety rails", desc: "Risky changes are blocked until a human approves.", icon: ShieldCheck, color: "var(--mint)" },
  { title: "One-click deploy", desc: "Preview, staging, production. Roll back anytime.", icon: Rocket, color: "var(--violet)" },
];

const agents = [
  { name: "Product Agent", task: "Turns ideas into tasks" },
  { name: "Design Agent", task: "Creates the UI" },
  { name: "Frontend Agent", task: "Builds pages" },
  { name: "Backend Agent", task: "Builds APIs & data" },
  { name: "QA Agent", task: "Tests everything" },
  { name: "DevOps Agent", task: "Deploys safely" },
  { name: "Safety Agent", task: "Blocks risky changes" },
  { name: "Ops Agent", task: "Keeps things shipping" },
];

const steps = [
  { title: "Describe your idea", desc: "Tell ForgeCloud what you want to build, in plain English." },
  { title: "Agents make a plan", desc: "Your AI team proposes features and tasks for you to approve." },
  { title: "Watch them build", desc: "Live progress as agents design, code, and test the app." },
  { title: "Review & ship", desc: "Comment on the preview, approve changes, deploy with one click." },
];
