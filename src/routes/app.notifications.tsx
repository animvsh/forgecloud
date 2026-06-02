import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bell, ArrowLeft, Loader2 } from "lucide-react";
import { useNotifications, useMarkAllNotificationsRead, useMarkNotificationRead } from "@/lib/client";
import { ScreenHeader } from "@/components/ScreenHeader";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — ForgeCloud" }] }),
  component: NotificationsScreen,
});

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Math.max(0, Date.now() - then);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const KIND_LABELS: Record<string, string> = {
  pr_opened: "PR opened",
  pr_approved: "PR approved",
  pr_rejected: "PR rejected",
  pr_rolled_back: "PR rolled back",
  approval_needed: "Approval needed",
  secret_blocked: "Secret blocked",
  deploy_live: "Deploy live",
  deploy_failed: "Deploy failed",
  task_created: "Task created",
  comment: "Comment",
  system: "System",
  recovery: "Recovery",
};

function NotificationsScreen() {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();

  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate({ to: "/app" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
            >
              <ArrowLeft className="size-3" /> Back to workspace
            </button>
            <button
              onClick={() => markAll.mutate()}
              disabled={unread === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Mark all read
            </button>
          </div>
        }
      />
      <div className="p-4 sm:p-8">
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <Bell className="size-8 text-muted-foreground" />
              <div className="text-sm font-medium">No notifications yet</div>
              <div className="text-xs text-muted-foreground">
                Build activity will show up here as agents ship work.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const isUnread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className="relative flex items-start gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
                  >
                    {isUnread && (
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-brand" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {KIND_LABELS[n.kind] ?? n.kind}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(n.created_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm font-medium">{n.title}</div>
                      {n.body && (
                        <div className="mt-1 text-xs text-muted-foreground">{n.body}</div>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        {n.link && (
                          <button
                            onClick={() => {
                              if (isUnread) markRead.mutate({ notificationId: n.id });
                              navigate({ to: n.link as never });
                            }}
                            className="text-xs font-medium text-brand hover:underline"
                          >
                            Open
                          </button>
                        )}
                        {isUnread && (
                          <button
                            onClick={() => markRead.mutate({ notificationId: n.id })}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
