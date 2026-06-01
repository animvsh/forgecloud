import { Check, Sparkles, GitBranch, Shield, Eye, MessageSquare, Bot } from "lucide-react";

function Node({
  className,
  children,
  style,
}: {
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`absolute squircle flex items-center justify-center ${className ?? ""}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function HeroDiagram() {
  return (
    <div className="relative mx-auto h-[280px] w-full max-w-5xl sm:h-[360px]">
      {/* connector lines */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 360"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <g stroke="currentColor" strokeWidth="1" className="text-border" fill="none">
          <path d="M120 180 L260 110" />
          <path d="M120 180 L260 250" />
          <path d="M260 110 L500 180" />
          <path d="M260 250 L500 180" />
          <path d="M500 180 L740 110" />
          <path d="M500 180 L740 250" />
          <path d="M740 110 L880 180" />
          <path d="M740 250 L880 180" />
        </g>
        <g className="fill-violet" style={{ color: "var(--violet)" }}>
          <circle cx="260" cy="110" r="3" />
          <circle cx="260" cy="250" r="3" />
          <circle cx="740" cy="110" r="3" />
          <circle cx="740" cy="250" r="3" />
        </g>
      </svg>

      {/* nodes — positioned in % to scale with viewport */}
      <Node className="size-14 bg-card sm:size-20" style={{ left: "4%", top: "32%" }}>
        <MessageSquare className="size-6 text-foreground/80 sm:size-9" />
      </Node>

      <Node className="size-12 sm:size-16" style={{ left: "19%", top: "14%", background: "var(--amber)" }}>
        <Sparkles className="size-5 text-foreground sm:size-7" />
      </Node>

      <Node className="size-12 sm:size-16" style={{ left: "19%", top: "54%", background: "var(--sky)" }}>
        <GitBranch className="size-5 text-foreground sm:size-7" />
      </Node>

      <Node
        className="size-20 sm:size-28"
        style={{ left: "42%", top: "27%", background: "var(--violet)" }}
      >
        <Check className="size-9 text-white sm:size-14" strokeWidth={2.5} />
      </Node>

      <Node className="size-12 sm:size-16" style={{ left: "68%", top: "14%", background: "var(--coral)" }}>
        <Shield className="size-5 text-white sm:size-7" />
      </Node>

      <Node className="size-12 bg-card sm:size-16" style={{ left: "68%", top: "54%" }}>
        <Bot className="size-5 text-foreground/80 sm:size-7" />
      </Node>

      <Node className="size-14 bg-card sm:size-20" style={{ left: "83%", top: "32%" }}>
        <Eye className="size-6 text-foreground/80 sm:size-9" />
      </Node>
    </div>
  );
}
