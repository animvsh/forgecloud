import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  GitPullRequest,
  Check,
  Undo2,
  AlertTriangle,
  ShieldAlert,
  Rocket,
  AlertOctagon,
  ListChecks,
  MessageCircle,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { useMarkNotificationRead, useMarkAllNotificationsRead } from "@/lib/client";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
};

const KIND_ICONS: Record<string, typeof Bell> = {
  pr_opened: GitPullRequest,
  pr_approved: Check,
  pr_rolled_back: Undo2,
  approval_needed: AlertTriangle,
  secret_blocked: ShieldAlert,
  deploy_live: Rocket,
  deploy_failed: AlertOctagon,
  task_created: ListChecks,
  comment: MessageCircle,
  system: Sparkles,
  recovery: ShieldCheck,
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function NotificationBell({
  notifications = [],
  unread = 0,
}: {
  notifications?: Notification[];
  unread?: number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = (n: Notification) => {
    if (!n.read_at) {
      markRead.mutate({ notificationId: n.id });
    }
    if (n.link) {
      navigate({ to: n.link });
    }
    setOpen(false);
  };

  const handleMarkAll = () => {
    if (unread === 0) return;
    markAll.mutate();
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        className="relative flex items-center justify-center rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] h-4 items-center justify-center rounded-full bg-coral px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-2xl border border-border bg-card shadow-xl max-h-96 overflow-y-auto z-50">
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={unread === 0}
              className="text-xs font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const Icon = KIND_ICONS[n.kind] ?? Sparkles;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(n)}
                      className="relative flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      {isUnread && (
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-brand" />
                      )}
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground truncate">
                          {n.title}
                        </div>
                        {n.body && (
                          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                            {n.body}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {formatRelativeTime(n.created_at)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
