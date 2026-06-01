import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MessageCircle, Plus, Loader2, GitBranch, Send, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useForgeState, useAddComment, useDeploy } from "@/lib/client";

export const Route = createFileRoute("/app/preview")({
  component: PreviewScreen,
});

function PreviewScreen() {
  const { data, isLoading } = useForgeState();
  const addComment = useAddComment();
  const deploy = useDeploy();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tasks = data.tasks;
  const doneTasks = tasks.filter((t) => t.status === "done");
  const buildingTasks = tasks.filter((t) => t.status === "building");
  const reviewTasks = tasks.filter((t) => t.status === "review");
  const comments = (data as any).previewComments ?? [];
  const liveDeployment = data.deployments.find((d) => d.environment === "preview" && d.status === "live");

  async function submitComment() {
    if (!text.trim() || addComment.isPending) return;
    setBusy(true);
    try {
      await addComment.mutateAsync({ text });
      setText("");
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
            {liveDeployment && (
              <a
                href={liveDeployment.railway_url || liveDeployment.cloudflare_url || "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
              >
                <ExternalLink className="size-3" /> Open
              </a>
            )}
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
                {liveDeployment?.railway_url || liveDeployment?.cloudflare_url || "preview.forgecloud.dev"}
              </div>
            </div>
            {liveDeployment && (
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-mint">
                <div className="size-1.5 rounded-full bg-mint animate-pulse" />
                Live
              </div>
            )}
          </div>

          <div className="bg-background p-8 min-h-[480px]">
            {data.tasks.length === 0 ? (
              <div className="flex h-full min-h-[400px] items-center justify-center text-center">
                <div>
                  <p className="text-muted-foreground">No app built yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">Start a project and the agents will build it.</p>
                </div>
              </div>
            ) : (
              <FakeApp tasks={tasks} />
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="size-4 text-brand" />
              <h3 className="font-semibold">Comments</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Each comment becomes a task for the AI team.</p>
          </div>
          <div className="max-h-96 overflow-y-auto p-4 space-y-2">
            {comments.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No comments yet
              </div>
            )}
            {comments.map((c: { id: string; text: string; created_at: number }) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-3 text-sm">
                {c.text}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(c.created_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-4">
            <div className="flex items-end gap-2">
              <textarea
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

function FakeApp({ tasks }: { tasks: { title: string; status: string; description: string | null }[] }) {
  const done = tasks.filter((t) => t.status === "done");
  const inProgress = tasks.filter((t) => t.status === "building" || t.status === "review");
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="text-xs text-muted-foreground">Built by your AI team</div>
        <h1 className="mt-1 text-2xl font-bold">Your app is taking shape</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {done.length} of {tasks.length} features built. {inProgress.length} in progress.
        </p>
      </div>

      {done.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Live features</div>
          <div className="space-y-2">
            {done.map((t, i) => (
              <div key={i} className="rounded-xl border border-mint/30 bg-mint/5 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-mint" />
                  <span className="font-medium">{t.title}</span>
                </div>
                {t.description && <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">In progress</div>
          <div className="space-y-2">
            {inProgress.map((t, i) => (
              <div key={i} className="rounded-xl border border-amber/30 bg-amber/5 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-amber animate-pulse" />
                  <span className="font-medium">{t.title}</span>
                  <span className="ml-auto text-[10px] uppercase text-amber">{t.status}</span>
                </div>
                {t.description && <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Live preview is a guided visualization. The real app lives at the deployed URL.
      </div>
    </div>
  );
}
