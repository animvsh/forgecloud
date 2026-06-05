import { Link } from "@tanstack/react-router";
import { Check, Bot, Sparkles, GitBranch, ShieldCheck, Rocket } from "lucide-react";

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

interface MiniDiagramProps {
  projectName: string;
  agentCount: number;
  taskCount: number;
  doneCount: number;
  prCount: number;
  recoveryCount: number;
}

export function MiniDiagram({
  projectName,
  agentCount,
  taskCount,
  doneCount,
  prCount,
  recoveryCount,
}: MiniDiagramProps) {
  const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

  return (
    <div className="relative mx-auto h-[200px] w-full max-w-lg">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 500 200"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <g stroke="currentColor" strokeWidth="0.8" className="text-border" fill="none">
          <path d="M60 100 L140 60" />
          <path d="M60 100 L140 140" />
          <path d="M140 60 L250 100" />
          <path d="M140 140 L250 100" />
          <path d="M250 100 L360 60" />
          <path d="M250 100 L360 140" />
          <path d="M360 60 L440 100" />
          <path d="M360 140 L440 100" />
        </g>
        <g className="fill-violet" style={{ color: "var(--violet)" }}>
          <circle cx="140" cy="60" r="2" />
          <circle cx="140" cy="140" r="2" />
          <circle cx="360" cy="60" r="2" />
          <circle cx="360" cy="140" r="2" />
        </g>
      </svg>

      {/* Left: Chat input */}
      <Node className="size-10 bg-card" style={{ left: "2%", top: "38%" }}>
        <Sparkles className="size-4 text-foreground/70" />
      </Node>

      {/* Plan/Agents (top-left) */}
      <Node className="size-9" style={{ left: "22%", top: "12%", background: "var(--amber)" }}>
        <Bot className="size-4 text-foreground" />
      </Node>

      {/* Build (bottom-left) */}
      <Node className="size-9" style={{ left: "22%", top: "55%", background: "var(--sky)" }}>
        <GitBranch className="size-4 text-foreground" />
      </Node>

      {/* Center: Big completion check */}
      <Node className="size-16" style={{ left: "42%", top: "25%", background: "var(--violet)" }}>
        <Check className="size-7 text-white" strokeWidth={2.5} />
      </Node>

      {/* Review (top-right) */}
      <Node className="size-9" style={{ left: "65%", top: "12%", background: "var(--coral)" }}>
        <ShieldCheck className="size-4 text-white" />
      </Node>

      {/* Deploy (bottom-right) */}
      <Node className="size-9" style={{ left: "65%", top: "55%", background: "var(--mint)" }}>
        <Rocket className="size-4 text-foreground" />
      </Node>

      {/* Right: Live app */}
      <Node className="size-10 bg-card" style={{ left: "82%", top: "38%" }}>
        <Bot className="size-4 text-foreground/70" />
      </Node>
    </div>
  );
}
