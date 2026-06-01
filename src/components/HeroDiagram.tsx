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
    <div className="relative mx-auto h-[360px] w-full max-w-5xl">
      {/* connector lines */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 360"
        preserveAspectRatio="none"
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

      {/* nodes */}
      <Node className="size-20 bg-card" style={{ left: 70, top: 140 }}>
        <MessageSquare className="size-9 text-foreground/80" />
      </Node>

      <Node className="size-16" style={{ left: 230, top: 70, background: "var(--amber)" }}>
        <Sparkles className="size-7 text-foreground" />
      </Node>

      <Node className="size-16" style={{ left: 230, top: 220, background: "var(--sky)" }}>
        <GitBranch className="size-7 text-foreground" />
      </Node>

      <Node
        className="size-28"
        style={{ left: 446, top: 122, background: "var(--violet)" }}
      >
        <Check className="size-14 text-white" strokeWidth={2.5} />
      </Node>

      <Node className="size-16" style={{ left: 710, top: 70, background: "var(--coral)" }}>
        <Shield className="size-7 text-white" />
      </Node>

      <Node className="size-16 bg-card" style={{ left: 710, top: 220 }}>
        <Bot className="size-7 text-foreground/80" />
      </Node>

      <Node className="size-20 bg-card" style={{ left: 855, top: 140 }}>
        <Eye className="size-9 text-foreground/80" />
      </Node>
    </div>
  );
}
