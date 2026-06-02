import { Link, useLocation } from "@tanstack/react-router";
import {
  MessageSquare,
  Bot,
  ListChecks,
  Eye,
  GitBranch,
  ShieldAlert,
  Rocket,
  Users,
  FileText,
  Home,
  Settings,
  Plug2,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useForgeState } from "@/lib/client";
import { NotificationBell } from "@/components/NotificationBell";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

export function SiteNav() {
  return (
    <header className="sticky top-6 z-50 flex justify-center px-4">
      <nav className="pill-nav flex items-center gap-1 px-2 py-2">
        <Link to="/" className="flex items-center gap-2 px-4 py-2 font-semibold">
          <span className="inline-block size-5 rounded-md bg-foreground" />
          ForgeCloud
        </Link>
        <a
          href="#product"
          className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Product
        </a>
        <a
          href="#agents"
          className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Agents
        </a>
        <a
          href="#flow"
          className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Flow
        </a>
        <a
          href="#pricing"
          className="hidden md:inline px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Pricing
        </a>
        <Link
          to="/app/chat"
          className="ml-1 rounded-full px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Sign in
        </Link>
        <Link
          to="/app/chat"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 transition-opacity"
        >
          Start building
        </Link>
      </nav>
    </header>
  );
}

type NavItem = { to: string; label: string; icon: LucideIcon; key?: string };

// Three sections matching the PRD's "Lovable / GitHub / Linear" mental model.
// Each section gets a subtle accent on hover so the structure is legible.
const sections: { key: "build" | "review" | "track"; tone: string; items: NavItem[] }[] = [
  {
    key: "build",
    tone: "var(--brand)",
    items: [
      { to: "/app", label: "Home", icon: Home },
      { to: "/app/connect", label: "Connect", icon: Plug2 },
      { to: "/app/discoveries", label: "Found", icon: Search },
      { to: "/app/suggested-apps", label: "Apps", icon: Sparkles },
      { to: "/app/chat", label: "Chat", icon: MessageSquare },
      { to: "/app/preview", label: "Preview", icon: Eye },
    ],
  },
  {
    key: "review",
    tone: "var(--violet)",
    items: [
      { to: "/app/changes", label: "PRs", icon: GitBranch },
      { to: "/app/branches", label: "Branches", icon: GitBranch, key: "branches" },
      { to: "/app/failures", label: "Recovery", icon: ShieldAlert },
    ],
  },
  {
    key: "track",
    tone: "var(--mint)",
    items: [
      { to: "/app/tasks", label: "Tasks", icon: ListChecks },
      { to: "/app/agents", label: "Agents", icon: Bot },
      { to: "/app/deployments", label: "Deploys", icon: Rocket },
      { to: "/app/team", label: "Team", icon: Users },
      { to: "/app/report", label: "Report", icon: FileText },
      { to: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppNav({ pendingApprovals = 0 }: { pendingApprovals?: number }) {
  const { pathname } = useLocation();
  const { data } = useForgeState();
  const notifications = data?.notifications ?? [];
  const unread = data?.notificationsUnread ?? 0;

  return (
    <header className="sticky top-4 z-50 flex justify-center px-4">
      <nav className="pill-nav flex items-center gap-0.5 px-2 py-2 max-w-[calc(100vw-2rem)] overflow-x-auto">
        <Link to="/" className="flex items-center gap-2 px-3 py-1.5 font-semibold shrink-0">
          <span className="inline-block size-4 rounded bg-foreground" />
          <span className="hidden sm:inline">ForgeCloud</span>
        </Link>
        <div className="mx-1 h-5 w-px bg-border shrink-0" />
        <ProjectSwitcher />
        <div className="mx-1 h-5 w-px bg-border shrink-0" />
        {sections.map((section, sectionIdx) => (
          <div key={section.key} className="flex items-center gap-0.5 shrink-0">
            {section.items.map((n) => {
              const active = pathname === n.to || (n.key === "branches" && pathname.startsWith("/app/branches"));
              const isRecovery = n.label === "Recovery";
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`group relative flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium shrink-0 transition-all duration-200 ${
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  style={active ? undefined : { borderBottom: "2px solid transparent" }}
                >
                  <n.icon className="size-3.5" />
                  <span className="hidden md:inline">{n.label}</span>
                  {isRecovery && pendingApprovals > 0 && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-coral text-[9px] font-bold text-white">
                      {pendingApprovals}
                    </span>
                  )}
                </Link>
              );
            })}
            {sectionIdx < sections.length - 1 && <div className="mx-1 h-5 w-px bg-border" />}
          </div>
        ))}
        <div className="mx-1 h-5 w-px bg-border shrink-0" />
        <NotificationBell notifications={notifications} unread={unread} />
      </nav>
    </header>
  );
}
