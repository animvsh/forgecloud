import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Check, Loader2, Folder } from "lucide-react";
import { useForgeState, useNewProject } from "@/lib/client";
import { toast } from "sonner";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: number;
};

export function ProjectSwitcher() {
  const { data } = useForgeState();
  const newProject = useNewProject();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const projects = (data?.projects ?? []) as ProjectRow[];
  const current = data?.project as ProjectRow | undefined;

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await newProject.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      toast.success(`Project created: ${name.trim()}`);
      setName("");
      setDescription("");
      setCreating(false);
      setOpen(false);
    } catch (e) {
      toast.error("Could not create project");
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors max-w-[180px]"
        title={current?.name ?? "Switch project"}
      >
        <Folder className="size-3 text-brand shrink-0" />
        <span className="truncate">{current?.name ?? "No project"}</span>
        <ChevronDown className="size-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Projects ({projects.length})
          </div>
          <div className="max-h-64 overflow-y-auto">
            {projects.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">No projects yet.</div>
            )}
            {projects.map((p) => {
              const active = current?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (active) {
                      toast.info(`"${p.name}" is the active project.`);
                    } else {
                      toast.info(`This demo runs on a single project. "${p.name}" is read-only — call /api/reset to clear extras.`);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${active ? "bg-muted/60" : ""}`}
                >
                  <span className="flex-1 truncate">
                    <span className="font-medium">{p.name}</span>
                    {p.description && (
                      <span className="ml-1 text-xs text-muted-foreground">— {p.description.slice(0, 40)}</span>
                    )}
                  </span>
                  {active && <Check className="size-3 text-brand shrink-0" />}
                </button>
              );
            })}
          </div>

          {creating ? (
            <div className="border-t border-border p-3 space-y-2 bg-background">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                autoFocus
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-brand"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is it for? (optional)"
                className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  onClick={() => { setCreating(false); setName(""); setDescription(""); }}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!name.trim() || newProject.isPending}
                  className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground hover:brightness-105 disabled:opacity-40"
                >
                  {newProject.isPending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  Create
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full border-t border-border px-3 py-2 text-left text-xs text-brand hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <Plus className="size-3" /> New project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
