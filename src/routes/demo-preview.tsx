import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  MousePointerClick,
  HelpCircle,
  TrendingUp,
  Users,
  DollarSign,
  Clock,
  Repeat,
  ListChecks,
  Calendar,
  MessageSquareWarning,
  Send,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/demo-preview")({
  component: PleasurePizzaOpsApp,
});

type SetCommentModeMessage = { kind: "set-comment-mode"; enabled: boolean };
type SetBlameModeMessage = { kind: "set-blame-mode"; enabled: boolean };

function isSetCommentModeMessage(value: unknown): value is SetCommentModeMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "set-comment-mode" && typeof v.enabled === "boolean";
}

function isSetBlameModeMessage(value: unknown): value is SetBlameModeMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "set-blame-mode" && typeof v.enabled === "boolean";
}

function describeElement(el: Element): string {
  const prettyName = (el as HTMLElement).dataset?.prettyName;
  if (prettyName) return prettyName;

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

const TABS = ["Dashboard", "Customers", "Promos", "Staff", "Complaints", "Catering"] as const;

const METRICS = [
  { label: "Today's Sales", value: "$1,284", delta: "+8.2%", icon: DollarSign, tint: "brand" },
  { label: "Orders Today", value: "67", delta: "+4", icon: TrendingUp, tint: "sky" },
  { label: "Average Order", value: "$19.16", delta: "+$0.42", icon: DollarSign, tint: "mint" },
  { label: "Slowest Hour", value: "2 PM–4 PM", delta: "−31%", icon: Clock, tint: "amber" },
  { label: "Repeat Customers", value: "38", delta: "+6", icon: Repeat, tint: "violet" },
  { label: "Open Staff Tasks", value: "7", delta: "2 due today", icon: ListChecks, tint: "coral" },
] as const;

// Realistic-looking sales-by-hour shape (open 11am, lunch peak 12-1, big dip 2-4pm, dinner 5-8pm).
const SALES_BY_HOUR = [
  { hour: "11a", value: 92 },
  { hour: "12p", value: 184 },
  { hour: "1p", value: 168 },
  { hour: "2p", value: 54 },
  { hour: "3p", value: 38 },
  { hour: "4p", value: 61 },
  { hour: "5p", value: 142 },
  { hour: "6p", value: 198 },
  { hour: "7p", value: 176 },
  { hour: "8p", value: 124 },
  { hour: "9p", value: 78 },
  { hour: "10p", value: 49 },
];

type WinbackStatus = "eligible" | "not_eligible" | "opted_out";
const WINBACK: Array<{
  name: string;
  last: string;
  fave: string;
  status: WinbackStatus;
}> = [
  { name: "Maya R.", last: "32 days ago", fave: 'Pepperoni 14"', status: "eligible" },
  { name: "Chris T.", last: "47 days ago", fave: "Margherita + Caesar", status: "eligible" },
  { name: "Jordan K.", last: "12 days ago", fave: "BBQ Chicken", status: "not_eligible" },
  { name: "Priya S.", last: "58 days ago", fave: "Veggie Supreme", status: "eligible" },
  { name: "Alex M.", last: "21 days ago", fave: "Hawaiian", status: "opted_out" },
];

const STAFF_TASKS = [
  { title: "Restock soda fridge", owner: "Diego", status: "Open" },
  { title: "Clean ovens", owner: "Sam", status: "In progress" },
  { title: "Count cash drawer", owner: "Riley", status: "Done" },
  { title: "Prep dough for tomorrow", owner: "Marco", status: "In progress" },
  { title: "Wipe outdoor tables", owner: "Jess", status: "Open" },
] as const;

const COMPLAINTS = [
  { text: "Order #4412 — pizza arrived cold (28 min late).", status: "New" },
  { text: "Customer reports missing garlic dip on #4427.", status: "Resolved" },
  { text: "Phone line went to voicemail twice yesterday.", status: "In review" },
] as const;

const EVENTS = [
  { date: "Jun 5", party: "School fundraiser · 80 people", status: "Confirmed" },
  { date: "Jun 12", party: "Wedding rehearsal · 24 people", status: "Deposit pending" },
  { date: "Jun 18", party: "Office lunch · 40 people", status: "Confirmed" },
] as const;

function PleasurePizzaOpsApp() {
  const [commentMode, setCommentMode] = useState(false);
  const [blameMode, setBlameMode] = useState(false);
  const [activeTab, setActiveTab] = useState<number>(0);
  const hoveredRef = useRef<HTMLElement | null>(null);

  // Listen for parent postMessage to toggle modes.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (isSetCommentModeMessage(event.data)) {
        setCommentMode(event.data.enabled);
        if (event.data.enabled) setBlameMode(false);
      } else if (isSetBlameModeMessage(event.data)) {
        setBlameMode(event.data.enabled);
        if (event.data.enabled) setCommentMode(false);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const activeMode: "comment" | "blame" | null = commentMode
    ? "comment"
    : blameMode
      ? "blame"
      : null;

  // Paint outline on hover when either mode is on.
  useEffect(() => {
    if (!activeMode) {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current.style.cursor = "";
        hoveredRef.current = null;
      }
      return;
    }

    const outlineColor = activeMode === "blame" ? "var(--violet)" : "var(--brand)";

    function onMove(e: globalThis.MouseEvent) {
      const target = resolveTarget(e.target as Element | null);
      if (hoveredRef.current === target) return;
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current.style.cursor = "";
      }
      if (target) {
        target.style.outline = `2px dashed ${outlineColor}`;
        target.style.outlineOffset = "2px";
        target.style.cursor = "crosshair";
      }
      hoveredRef.current = target;
    }

    function onLeave() {
      if (hoveredRef.current) {
        hoveredRef.current.style.outline = "";
        hoveredRef.current.style.outlineOffset = "";
        hoveredRef.current.style.cursor = "";
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
        hoveredRef.current.style.cursor = "";
        hoveredRef.current = null;
      }
    };
  }, [activeMode]);

  // Capture clicks in either mode (capture phase) and postMessage to parent.
  useEffect(() => {
    if (!activeMode) return;

    function onClick(e: globalThis.MouseEvent) {
      const target = resolveTarget(e.target as Element | null);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();

      const selector = describeElement(target);
      const rawText = (target.innerText ?? "").trim().replace(/\s+/g, " ");
      const text = rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;

      const kind = activeMode === "blame" ? "preview-blame" : "preview-click";
      window.parent.postMessage({ kind, text, selector, x: e.clientX, y: e.clientY }, "*");
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [activeMode]);

  function swallow(e: MouseEvent) {
    if (activeMode) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const maxSale = useMemo(() => Math.max(...SALES_BY_HOUR.map((d) => d.value)), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {activeMode && (
        <div
          className={
            "sticky top-0 z-50 flex items-center justify-center gap-2 border-b px-4 py-2 text-xs font-medium text-foreground " +
            (activeMode === "blame"
              ? "border-violet/40 bg-violet/10"
              : "border-coral/30 bg-coral/10")
          }
          data-pretty-name={activeMode === "blame" ? "Blame mode banner" : "Comment mode banner"}
        >
          {activeMode === "blame" ? (
            <>
              <HelpCircle className="size-3.5 text-violet" />
              <span>Blame mode &mdash; click anything to ask "why is this here?"</span>
            </>
          ) : (
            <>
              <MousePointerClick className="size-3.5 text-coral" />
              <span>Comment mode &mdash; click anything to make a task</span>
            </>
          )}
        </div>
      )}

      {/* Sticky header */}
      <header
        className="sticky z-40 border-b border-border/60 bg-background/85 backdrop-blur"
        data-pretty-name="Top navigation"
        style={{ top: activeMode ? "33px" : "0" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2" data-pretty-name="Pleasure Pizza wordmark">
            <div className="size-2.5 rounded-full bg-coral" />
            <span className="text-base font-bold tracking-tight">Pleasure Pizza</span>
            <span className="ml-2 hidden rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              Owner
            </span>
          </div>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            {TABS.map((tab, i) => {
              const active = activeTab === i;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!activeMode) setActiveTab(i);
                  }}
                  data-pretty-name={`Tab: ${tab}`}
                  className={
                    "rounded-full px-3 py-1.5 text-xs transition " +
                    (active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  {tab}
                </button>
              );
            })}
          </nav>
          <div
            className="flex size-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground"
            data-pretty-name="Owner avatar"
          >
            T
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {/* Today hero — Dashboard only */}
        {activeTab === 0 && (
          <section data-pretty-name="Today hero section">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight" data-pretty-name="Today heading">
                  Today &mdash; Monday, June 2
                </h1>
                <p className="text-xs text-muted-foreground">Live numbers from the register</p>
              </div>
              <div
                className="inline-flex items-center gap-1.5 rounded-full border border-mint/40 bg-mint/10 px-2.5 py-1 text-[11px] text-foreground"
                data-pretty-name="Open status pill"
              >
                <div className="size-1.5 rounded-full bg-mint" />
                <span>Open · 11am – 11pm</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {METRICS.map((m) => (
                <MetricCard key={m.label} metric={m} />
              ))}
            </div>
          </section>
        )}

        {/* Sales by hour — Dashboard only */}
        {activeTab === 0 && (
          <section
            className="rounded-3xl border border-border bg-card p-5"
            data-pretty-name="Sales by hour card"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold" data-pretty-name="Sales by hour heading">
                  Sales by hour
                </h2>
                <p className="text-xs text-muted-foreground">
                  Lunch lull between 2 PM and 4 PM &mdash; opportunity for a winback promo.
                </p>
              </div>
              <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
                <span className="inline-block size-2 rounded-full bg-brand" />
                Revenue ($)
              </div>
            </div>

            <div className="relative h-40 w-full" data-pretty-name="Sales chart">
              <svg
                viewBox="0 0 480 160"
                preserveAspectRatio="none"
                className="h-full w-full"
                aria-hidden="true"
              >
                {/* gridlines */}
                {[0, 1, 2, 3].map((g) => (
                  <line
                    key={g}
                    x1="0"
                    x2="480"
                    y1={40 * g + 10}
                    y2={40 * g + 10}
                    stroke="currentColor"
                    className="text-border"
                    strokeDasharray="2 4"
                    strokeWidth="0.5"
                  />
                ))}
                {SALES_BY_HOUR.map((d, i) => {
                  const barWidth = 480 / SALES_BY_HOUR.length;
                  const x = i * barWidth + 4;
                  const h = (d.value / maxSale) * 130;
                  const y = 140 - h;
                  const isDip = d.value < 80;
                  return (
                    <g key={d.hour}>
                      <rect
                        x={x}
                        y={y}
                        width={barWidth - 8}
                        height={h}
                        rx="4"
                        className={isDip ? "fill-amber/70" : "fill-brand/80"}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              {SALES_BY_HOUR.map((d) => (
                <span key={d.hour} className="w-8 text-center">
                  {d.hour}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Customer + Complaints — Dashboard, Customers, Complaints tabs */}
        {(activeTab === 0 || activeTab === 1 || activeTab === 4) && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Customer winback table */}
            {(activeTab === 0 || activeTab === 1) && (
              <section
                className="rounded-3xl border border-border bg-card p-5 lg:col-span-2"
                data-pretty-name="Customer winback card"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2
                      className="text-sm font-semibold"
                      data-pretty-name="Customer winback heading"
                    >
                      Customer winback
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Customers who haven't ordered in 14+ days.
                    </p>
                  </div>
                  <button
                    onClick={swallow}
                    data-pretty-name="View all customers button"
                    className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    View all
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Customer</th>
                        <th className="px-4 py-2 font-medium">Last order</th>
                        <th className="px-4 py-2 font-medium">Favorite item</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {WINBACK.map((c) => (
                        <tr
                          key={c.name}
                          className="bg-background hover:bg-muted/40"
                          data-pretty-name={`Winback row: ${c.name}`}
                        >
                          <td className="px-4 py-2.5 font-medium">{c.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{c.last}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{c.fave}</td>
                          <td className="px-4 py-2.5">
                            <WinbackPill status={c.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Recent complaints */}
            {(activeTab === 0 || activeTab === 4) && (
              <section
                className="rounded-3xl border border-border bg-card p-5"
                data-pretty-name="Recent complaints card"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquareWarning className="size-4 text-coral" />
                    <h2
                      className="text-sm font-semibold"
                      data-pretty-name="Recent complaints heading"
                    >
                      Recent complaints
                    </h2>
                  </div>
                  <span className="text-[11px] text-muted-foreground">Last 24h</span>
                </div>
                <ul className="space-y-2">
                  {COMPLAINTS.map((c, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-border bg-background p-3 text-xs"
                      data-pretty-name={`Complaint: ${c.text.slice(0, 30)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-foreground/90">{c.text}</span>
                        <StatusPill label={c.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Promo builder — Dashboard, Promos tabs */}
        {(activeTab === 0 || activeTab === 2) && (
          <section
            className="rounded-3xl border border-border bg-card p-5"
            data-pretty-name="Promo builder card"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet" />
                <h2 className="text-sm font-semibold" data-pretty-name="Promo builder heading">
                  Promo builder &mdash; Slow Lunch Winback
                </h2>
              </div>
              <span
                className="rounded-full bg-violet/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet"
                data-pretty-name="Promo draft pill"
              >
                Draft
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PromoField
                label="Campaign"
                value="Slow Lunch Winback"
                pretty="Promo field: Campaign"
              />
              <PromoField label="Target" value="38 lapsed customers" pretty="Promo field: Target" />
              <PromoField
                label="Offer"
                value="20% off any large pizza"
                pretty="Promo field: Offer"
              />
              <PromoField
                label="Time window"
                value="Tue–Thu · 2 PM – 4 PM"
                pretty="Promo field: Time window"
              />
              <PromoField
                label="Estimated revenue"
                value="$420 – $680"
                tint="mint"
                pretty="Promo field: Estimated revenue"
              />
              <PromoField
                label="Estimated cost"
                value="$84 in discounts"
                tint="amber"
                pretty="Promo field: Estimated cost"
              />
              <PromoField
                label="Risk"
                value="Low · text channel only"
                tint="mint"
                pretty="Promo field: Risk"
              />
              <PromoField
                label="Approval"
                value="Owner sign-off required"
                tint="coral"
                pretty="Promo field: Approval"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Sends as SMS through the existing texting integration. Customers can opt out with
                STOP.
              </p>
              <button
                onClick={swallow}
                data-pretty-name="Send promo button"
                className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-110"
              >
                <Send className="size-3.5" />
                Send promo (owner approval needed)
              </button>
            </div>
          </section>
        )}

        {/* Staff + Catering — Dashboard, Staff, Catering tabs */}
        {(activeTab === 0 || activeTab === 3 || activeTab === 5) && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Staff tasks */}
            {(activeTab === 0 || activeTab === 3) && (
              <section
                className="rounded-3xl border border-border bg-card p-5"
                data-pretty-name="Staff tasks card"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-sky" />
                    <h2 className="text-sm font-semibold" data-pretty-name="Staff tasks heading">
                      Staff tasks
                    </h2>
                  </div>
                  <button
                    onClick={swallow}
                    data-pretty-name="Add staff task button"
                    className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    + Add task
                  </button>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
                  {STAFF_TASKS.map((t) => (
                    <li
                      key={t.title}
                      className="flex items-center justify-between gap-3 bg-background px-4 py-3 text-sm"
                      data-pretty-name={`Staff task: ${t.title}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="size-6 shrink-0 rounded-full bg-muted text-center text-[10px] font-semibold leading-6 text-muted-foreground">
                          {t.owner.charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium">{t.title}</div>
                          <div className="text-[11px] text-muted-foreground">{t.owner}</div>
                        </div>
                      </div>
                      <StatusPill label={t.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Catering & events */}
            {(activeTab === 0 || activeTab === 5) && (
              <section
                className="rounded-3xl border border-border bg-card p-5"
                data-pretty-name="Catering events card"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-amber" />
                    <h2
                      className="text-sm font-semibold"
                      data-pretty-name="Catering events heading"
                    >
                      Catering &amp; events
                    </h2>
                  </div>
                  <button
                    onClick={swallow}
                    data-pretty-name="Catering view all button"
                    className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    View calendar
                  </button>
                </div>
                <ul className="space-y-2">
                  {EVENTS.map((ev) => (
                    <li
                      key={ev.party}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm"
                      data-pretty-name={`Event: ${ev.party}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg bg-amber/15 text-amber">
                          <span className="text-[9px] font-semibold uppercase">
                            {ev.date.split(" ")[0]}
                          </span>
                          <span className="text-xs font-bold leading-none">
                            {ev.date.split(" ")[1]}
                          </span>
                        </div>
                        <div className="font-medium">{ev.party}</div>
                      </div>
                      <StatusPill label={ev.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-border bg-card/40" data-pretty-name="Footer">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-[11px] text-muted-foreground">
          <span>Pleasure Pizza Ops &middot; v0.5 &middot; live preview</span>
          <span>Last sync just now</span>
        </div>
      </footer>
    </div>
  );
}

function MetricCard({ metric }: { metric: (typeof METRICS)[number] }) {
  const Icon = metric.icon;
  const tintBg: Record<string, string> = {
    brand: "bg-brand/10 text-brand",
    sky: "bg-sky/10 text-sky",
    mint: "bg-mint/10 text-mint",
    amber: "bg-amber/15 text-amber",
    violet: "bg-violet/10 text-violet",
    coral: "bg-coral/10 text-coral",
  };
  return (
    <div
      className="rounded-2xl border border-border bg-card p-3.5 transition hover:-translate-y-0.5 hover:shadow-sm"
      data-pretty-name={`Metric: ${metric.label}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {metric.label}
        </span>
        <div
          className={`flex size-6 items-center justify-center rounded-md ${tintBg[metric.tint]}`}
        >
          <Icon className="size-3" />
        </div>
      </div>
      <div className="mt-1.5 text-lg font-bold tracking-tight">{metric.value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{metric.delta}</div>
    </div>
  );
}

function WinbackPill({ status }: { status: WinbackStatus }) {
  if (status === "eligible") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-mint">
        Eligible
      </span>
    );
  }
  if (status === "opted_out") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-coral">
        Opted out
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
      Not eligible
    </span>
  );
}

function StatusPill({ label }: { label: string }) {
  const map: Record<string, string> = {
    Open: "bg-sky/15 text-sky",
    "In progress": "bg-amber/15 text-amber",
    Done: "bg-mint/15 text-mint",
    New: "bg-coral/15 text-coral",
    Resolved: "bg-mint/15 text-mint",
    "In review": "bg-amber/15 text-amber",
    Confirmed: "bg-mint/15 text-mint",
    "Deposit pending": "bg-amber/15 text-amber",
  };
  const cls = map[label] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}
    >
      {label}
    </span>
  );
}

function PromoField({
  label,
  value,
  tint,
  pretty,
}: {
  label: string;
  value: string;
  tint?: "mint" | "amber" | "coral";
  pretty: string;
}) {
  const valueColor =
    tint === "mint"
      ? "text-mint"
      : tint === "amber"
        ? "text-amber"
        : tint === "coral"
          ? "text-coral"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-background p-3" data-pretty-name={pretty}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}
