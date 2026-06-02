import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  MessageCircle,
  Plus,
  Loader2,
  Send,
  ExternalLink,
  MousePointerClick,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useForgeState, useAddComment, useDeploy } from "@/lib/client";

export const Route = createFileRoute("/app/preview")({
  component: PreviewScreen,
});

const DEMO_PREVIEW_PATH = "/demo-preview";

type PreviewClickMessage = {
  kind: "preview-click";
  text: string;
  selector: string;
  x: number;
  y: number;
};

function isPreviewClickMessage(value: unknown): value is PreviewClickMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.kind === "preview-click" && typeof v.text === "string" && typeof v.selector === "string";
}

function PreviewScreen() {
  const { data, isLoading } = useForgeState();
  const addComment = useAddComment();
  const deploy = useDeploy();
  const [text, setText] = useState("");
  const [selector, setSelector] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Push comment-mode state into the iframe whenever it (or the iframe) changes.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    function send() {
      iframe?.contentWindow?.postMessage({ kind: "set-comment-mode", enabled: commentMode }, "*");
    }
    // Send immediately and again on load (the iframe may not be ready yet).
    send();
    iframe.addEventListener("load", send);
    return () => iframe.removeEventListener("load", send);
  }, [commentMode]);

  // Listen for clicks bubbling out of the iframe.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isPreviewClickMessage(event.data)) return;
      const { text: clickedText, selector: clickedSelector } = event.data;
      setSelector(clickedSelector);
      setText((prev) => {
        // Prefill with clicked text if the user hasn't typed anything custom.
        if (!prev.trim()) return clickedText;
        return prev;
      });
      // Focus the textarea so the user can keep typing.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const comments =
    (data as { previewComments?: { id: string; text: string; created_at: number }[] })
      .previewComments ?? [];
  const liveDeployment = data.deployments.find(
    (d: { environment: string; status: string }) =>
      d.environment === "preview" && d.status === "live",
  );

  async function submitComment() {
    if (!text.trim() || addComment.isPending) return;
    setBusy(true);
    try {
      const result = await addComment.mutateAsync({
        text,
        selector: selector ?? undefined,
      });
      setText("");
      setSelector(null);
      const task = result?.task as { title?: string; assigned_agent_name?: string } | undefined;
      if (task?.title) {
        const agent = task.assigned_agent_name || "Frontend Agent";
        toast.success(`Created task: "${task.title}"`, {
          description: `Assigned to ${agent}`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function deployPreview() {
    setBusy(true);
    try {
      await deploy.mutateAsync({ environment: "preview" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <ScreenHeader
        title="Live preview"
        subtitle="Click around the app. Comment on anything. ForgeCloud turns comments into tasks."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCommentMode((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition " +
                (commentMode
                  ? "bg-coral text-white shadow-sm hover:brightness-105"
                  : "border border-border bg-card hover:bg-muted")
              }
            >
              <MousePointerClick className="size-3" />
              {commentMode ? "Comment mode: on" : "Comment mode"}
            </button>
            <a
              href={DEMO_PREVIEW_PATH}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
            >
              <ExternalLink className="size-3" /> Open
            </a>
            <button
              onClick={deployPreview}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs text-brand-foreground hover:brightness-105 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              {liveDeployment ? "Redeploy preview" : "Deploy preview"}
            </button>
          </div>
        }
      />

      <div className="grid gap-4 p-8 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-3xl border border-border bg-card overflow-hidden card-hover">
          <div className="flex items-center justify-between border-b border-border bg-muted/60 px-5 py-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="size-2.5 rounded-full bg-coral" />
                <div className="size-2.5 rounded-full bg-amber" />
                <div className="size-2.5 rounded-full bg-mint" />
              </div>
              <div className="flex-1 max-w-xs rounded-lg bg-background/80 px-3 py-1 font-mono text-[11px] text-center">
                {liveDeployment?.railway_url ||
                  liveDeployment?.cloudflare_url ||
                  "preview.forgecloud.dev"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {commentMode && (
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-coral">
                  <MousePointerClick className="size-3" />
                  Comment mode
                </div>
              )}
              {liveDeployment && (
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-mint">
                  <div className="size-1.5 rounded-full bg-mint animate-pulse" />
                  Live
                </div>
              )}
            </div>
          </div>

          <div className="relative bg-background min-h-[560px]">
            <iframe
              ref={iframeRef}
              src={DEMO_PREVIEW_PATH}
              title="Live app preview"
              sandbox="allow-scripts allow-forms allow-same-origin"
              className="block h-[640px] w-full border-0 bg-background"
            />
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-brand" />
              <h3 className="font-semibold">Comments</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Each comment becomes a task for the AI team.
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto p-4 space-y-2">
            {comments.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No comments yet
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-3 text-sm">
                {c.text}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(c.created_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-4">
            {selector && (
              <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-[11px] text-foreground">
                <MousePointerClick className="size-3 shrink-0 text-brand" />
                <span className="truncate">Clicked: {selector}</span>
                <button
                  type="button"
                  onClick={() => setSelector(null)}
                  className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-brand/20"
                  aria-label="Clear clicked selector"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Make this button bigger. Add a search bar here..."
                className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
              />
              <button
                onClick={submitComment}
                disabled={!text.trim() || busy}
                className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background hover:opacity-90 disabled:opacity-30"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {[
                "Add a search bar",
                "Add a phone number field",
                "Make the dashboard sortable",
                "Show follow-up date column",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setText(s)}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
