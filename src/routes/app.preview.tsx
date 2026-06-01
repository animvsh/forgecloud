import { createFileRoute } from "@tanstack/react-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MessageCircle, Plus } from "lucide-react";

export const Route = createFileRoute("/app/preview")({
  component: PreviewScreen,
});

const comments = [
  { who: "Sarah", text: "Make this button bigger.", task: "Increase primary CTA size on dashboard" },
  { who: "David", text: "Add a search bar here.", task: "Add search bar to leads table" },
  { who: "Animesh", text: "Add phone number field.", task: "Add phone number to lead form and database" },
];

function PreviewScreen() {
  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Preview" subtitle="Click anywhere in the app. Comments become tasks automatically." />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_360px] overflow-hidden">
        {/* mock app */}
        <div className="overflow-y-auto bg-muted/40 p-8">
          <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-lg font-semibold">Leads</div>
              <button className="rounded-full bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground">
                <Plus className="mr-1 inline size-4" /> New lead
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Status</th></tr>
                </thead>
                <tbody>
                  {[["Ava Chen","Northwind","Qualified"],["Marco Diaz","Acme","New"],["Priya Patel","Globex","Contacted"]].map(([n,c,s]) => (
                    <tr key={n} className="border-t border-border"><td className="px-4 py-3 font-medium">{n}</td><td className="px-4 py-3">{c}</td><td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{s}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {/* comments */}
        <aside className="border-l border-border bg-card p-5 overflow-y-auto">
          <div className="mb-3 text-sm font-semibold">Comments → Tasks</div>
          <div className="space-y-3">
            {comments.map((c, i) => (
              <div key={i} className="rounded-2xl border border-border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageCircle className="size-3.5" /> {c.who}
                </div>
                <div className="mt-1.5 text-sm">{c.text}</div>
                <div className="mt-2 rounded-xl bg-muted px-2.5 py-1.5 text-xs">
                  <span className="font-medium">Created task:</span> {c.task}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
