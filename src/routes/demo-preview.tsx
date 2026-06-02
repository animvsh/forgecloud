import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowRight, Crown, Sparkles, Zap, Check, MousePointerClick } from "lucide-react";

export const Route = createFileRoute("/demo-preview")({
  component: DemoPreviewApp,
});

type SetCommentModeMessage = {
  kind: "set-comment-mode";
  enabled: boolean;
};

function isSetCommentModeMessage(value: unknown): value is SetCommentModeMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "set-comment-mode" && typeof v.enabled === "boolean";
}

function describeElement(el: Element): string {
  const prettyName = (el as HTMLElement).dataset?.prettyName;
  if (prettyName) return prettyName;

  // Walk up to find a labeled ancestor.
  const labeled = el.closest("[data-pretty-name]");
  if (labeled) {
    const name = (labeled as HTMLElement).dataset.prettyName;
    if (name) return name;
  }

  const tag = el.tagName.toLowerCase();
  const className =
    typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
  const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  const suffix = classes ? `.${classes}` : "";
  const full = `${tag}${suffix}`;
  return full.length > 80 ? `${full.slice(0, 80)}…` : full;
}

function isMeaningful(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el === document.body || el === document.documentElement) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return false;
  // Prefer commentable ancestors when available.
  return true;
}

function resolveTarget(el: Element | null): HTMLElement | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  const commentable = el.closest("[data-commentable]") as HTMLElement | null;
  if (commentable) return commentable;
  const named = el.closest("[data-pretty-name]") as HTMLElement | null;
  if (named) return named;
  if (!isMeaningful(el)) return null;
  const text = (el.innerText ?? "").trim();
  if (text.length === 0 || text.length > 200) return null;
  return el;
}

function DemoPreviewApp() {
  const [commentMode, setCommentMode] = useState(false);
  const [count, setCount] = useState(42);
  const [signedUp, setSignedUp] = useState(false);
  const [email, setEmail] = useState("");
  const hoveredRef = useRef<HTMLElement | null>(null);

  // Listen for parent postMessage to toggle comment mode.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (isSetCommentModeMessage(event.data)) {
        setCommentMode(event.data.enabled);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Paint outline on hover when comment mode is on.
  useEffect(() => {
    if (!commentMode) {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current = null;
      }
      return;
    }

    function onMove(e: globalThis.MouseEvent) {
      const target = resolveTarget(e.target as Element | null);
      if (hoveredRef.current === target) return;
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
      }
      if (target) {
        target.style.outline = "2px dashed var(--brand)";
        target.style.outlineOffset = "2px";
        target.style.cursor = "crosshair";
      }
      hoveredRef.current = target;
    }

    function onLeave() {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current = null;
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current = null;
      }
    };
  }, [commentMode]);

  // Capture clicks in comment mode (capture phase).
  useEffect(() => {
    if (!commentMode) return;

    function onClick(e: globalThis.MouseEvent) {
      const target = resolveTarget(e.target as Element | null);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();

      const selector = describeElement(target);
      const rawText = (target.innerText ?? "").trim().replace(/\s+/g, " ");
      const text = rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;

      window.parent.postMessage(
        {
          kind: "preview-click",
          text,
          selector,
          x: e.clientX,
          y: e.clientY,
        },
        "*",
      );
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [commentMode]);

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commentMode) return;
    if (!email.trim()) return;
    setSignedUp(true);
    setCount((c) => c + 1);
  }

  function swallow(e: MouseEvent) {
    if (commentMode) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {commentMode && (
        <div
          className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-coral/30 bg-coral/10 px-4 py-2 text-xs font-medium text-foreground"
          data-pretty-name="Comment mode banner"
        >
          <MousePointerClick className="size-3.5 text-coral" />
          <span>Comment mode &mdash; click anything to make a task</span>
        </div>
      )}

      {/* Sticky wordmark header */}
      <header
        className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur"
        data-pretty-name="Top navigation"
        style={commentMode ? { top: "33px" } : undefined}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2" data-pretty-name="Pielot wordmark">
            <div className="size-2.5 rounded-full bg-brand" />
            <span className="text-lg font-bold tracking-tight">Pielot</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            <a href="#features" onClick={swallow} className="hover:text-foreground">
              Features
            </a>
            <a href="#how" onClick={swallow} className="hover:text-foreground">
              How it works
            </a>
            <a
              href="#join"
              onClick={swallow}
              className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              Join the list
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section id="join" className="relative overflow-hidden" data-pretty-name="Hero section">
        <div className="absolute inset-0 -z-10 gradient-header" />
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <div
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1 text-xs text-muted-foreground"
              data-pretty-name="Early access badge"
            >
              <Sparkles className="size-3 text-brand" />
              Early access opening soon
            </div>
            <h1
              className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl"
              data-pretty-name="Hero headline"
            >
              Be first to fly <span className="gradient-text">Pielot</span>.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground" data-pretty-name="Hero subhead">
              Join the early access list &mdash; be in the air before everyone else.
            </p>

            <form
              onSubmit={handleJoin}
              className="mx-auto mt-8 flex max-w-md flex-col items-stretch gap-2 sm:flex-row"
              data-pretty-name="Signup form"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@takeoff.com"
                className="flex-1 rounded-full border border-border bg-card px-5 py-3 text-sm outline-none transition focus:border-brand"
                data-pretty-name="Email input"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-5 py-3 text-sm font-medium text-brand-foreground hover:brightness-105"
                data-pretty-name="Join the list button"
              >
                Join the list
                <ArrowRight className="size-4" />
              </button>
            </form>

            <div
              className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-mint/40 bg-mint/10 px-3 py-1 text-xs text-foreground"
              data-pretty-name="Position badge"
            >
              {signedUp ? (
                <>
                  <Check className="size-3.5 text-mint" />
                  <span>
                    You're in. Position <strong>#{count}</strong> in line.
                  </span>
                </>
              ) : (
                <>
                  <div className="size-1.5 rounded-full bg-mint" />
                  <span>
                    Already signed up? You're <strong>#{count}</strong> in line.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="mx-auto max-w-5xl px-6 pb-12"
        data-pretty-name="Features section"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={<Zap className="size-5 text-violet" />}
            tint="violet"
            title="Skip the line"
            body="Members get instant access the moment we open the gates."
            prettyName="Feature: Skip the line"
          />
          <FeatureCard
            icon={<Sparkles className="size-5 text-brand" />}
            tint="brand"
            title="Early pricing"
            body="Locked-in launch pricing for the first thousand pilots."
            prettyName="Feature: Early pricing"
          />
          <FeatureCard
            icon={<Crown className="size-5 text-amber" />}
            tint="amber"
            title="Founders' circle"
            body="A private channel with the team and a hand in shaping v1."
            prettyName="Feature: Founders' circle"
          />
        </div>
      </section>

      {/* How it works */}
      <section
        id="how"
        className="mx-auto max-w-5xl px-6 pb-20"
        data-pretty-name="How it works section"
      >
        <div className="rounded-3xl border border-border bg-card p-8 sm:p-12">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mt-2 text-sm text-muted-foreground">Three steps from runway to takeoff.</p>

          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            <Step
              n={1}
              title="Drop your email"
              body="We hold your spot on the list within seconds."
              prettyName="Step 1"
            />
            <Step
              n={2}
              title="Get the invite"
              body="When we open access, you're the first to know."
              prettyName="Step 2"
            />
            <Step
              n={3}
              title="Take off"
              body="Onboard in minutes and start flying with Pielot."
              prettyName="Step 3"
            />
          </ol>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/40" data-pretty-name="Footer">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-brand" />
            <span>&copy; Pielot 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" onClick={swallow} className="hover:text-foreground">
              Twitter
            </a>
            <a href="#" onClick={swallow} className="hover:text-foreground">
              Privacy
            </a>
            <a href="#" onClick={swallow} className="hover:text-foreground">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  tint,
  title,
  body,
  prettyName,
}: {
  icon: React.ReactNode;
  tint: "violet" | "brand" | "amber";
  title: string;
  body: string;
  prettyName: string;
}) {
  const tintBg =
    tint === "violet" ? "bg-violet/10" : tint === "brand" ? "bg-brand/10" : "bg-amber/15";
  return (
    <div
      className="rounded-3xl border border-border bg-card p-6 transition hover:-translate-y-0.5 hover:shadow-md"
      data-pretty-name={prettyName}
    >
      <div className={`inline-flex size-10 items-center justify-center rounded-2xl ${tintBg}`}>
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  prettyName,
}: {
  n: number;
  title: string;
  body: string;
  prettyName: string;
}) {
  return (
    <li
      className="rounded-2xl border border-border bg-background p-5"
      data-pretty-name={prettyName}
    >
      <div className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
        {n}
      </div>
      <h4 className="mt-3 text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </li>
  );
}
