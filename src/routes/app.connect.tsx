import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2, Plug2, Search, X } from "lucide-react";
import { useForgeState, useConnectTool, useDisconnectTool, useScan } from "@/lib/client";
import { ScreenHeader } from "@/components/ScreenHeader";

export const Route = createFileRoute("/app/connect")({
  head: () => ({ meta: [{ title: "Connect tools — ForgeCloud" }] }),
  component: ConnectScreen,
});

type Connection = {
  id: string;
  provider: string;
  label: string;
  status: "available" | "connected" | "error";
  account_label?: string | null;
  icon: string;
};

const ACCENTS = [
  "var(--brand)",
  "var(--violet)",
  "var(--sky)",
  "var(--amber)",
  "var(--coral)",
  "var(--mint)",
];

function accentFor(provider: string) {
  let hash = 0;
  for (let i = 0; i < provider.length; i++) hash = (hash * 31 + provider.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

function ConnectScreen() {
  const navigate = useNavigate();
  const { data, isLoading } = useForgeState();
  const connectMutation = useConnectTool();
  const disconnectMutation = useDisconnectTool();
  const scanMutation = useScan();
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [accountInput, setAccountInput] = useState<Record<string, string>>({});

  if (isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading connectors...</p>
        </div>
      </div>
    );
  }

  const connections: Connection[] = data.connections ?? [];
  const connectedCount = connections.filter((c) => c.status === "connected").length;

  async function handleConnect(provider: string, label: string) {
    const account = (accountInput[provider] ?? "").trim();
    if (!account) {
      toast.error("Add an account/workspace name first.");
      return;
    }
    try {
      await connectMutation.mutateAsync({ provider, account });
      toast.success(`${label} connected`, { description: account });
      setOpenProvider(null);
      setAccountInput((m) => ({ ...m, [provider]: "" }));
    } catch (err) {
      toast.error("Connect failed", { description: (err as Error).message });
    }
  }

  async function handleDisconnect(provider: string, label: string) {
    try {
      await disconnectMutation.mutateAsync({ provider });
      toast.success(`${label} disconnected`);
    } catch (err) {
      toast.error("Disconnect failed", { description: (err as Error).message });
    }
  }

  async function handleScan() {
    try {
      await scanMutation.mutateAsync();
      toast.success("Scan complete", { description: "Showing what I found." });
      navigate({ to: "/app/discoveries" });
    } catch (err) {
      toast.error("Scan failed", { description: (err as Error).message });
    }
  }

  return (
    <div className="space-y-6 pb-28 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <ScreenHeader
        title="Connect your tools"
        subtitle="ForgeCloud uses your real business data to suggest apps and build dashboards. Pick what to give it access to."
        action={
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Plug2 className="size-3.5" />
            {connectedCount} of {connections.length} connected
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connections.map((conn) => {
          const isOpen = openProvider === conn.provider;
          const isConnected = conn.status === "connected";
          const accent = accentFor(conn.provider);
          return (
            <div
              key={conn.id}
              className={`rounded-3xl border bg-card p-5 card-hover transition-all ${
                isConnected ? "border-mint/40 shadow-sm shadow-mint/10" : "border-border"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex size-12 items-center justify-center squircle text-2xl shrink-0"
                  style={{ background: isConnected ? "var(--mint)" : accent }}
                >
                  <span>{conn.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{conn.label}</h3>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mint">
                        <Check className="size-3" /> Connected
                      </span>
                    )}
                  </div>
                  {isConnected && conn.account_label ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {conn.account_label}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Read-only access to your {conn.label} workspace.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(conn.provider, conn.label)}
                    disabled={disconnectMutation.isPending}
                    className="text-xs text-muted-foreground hover:text-coral transition-colors disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : isOpen ? (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                    <input
                      autoFocus
                      value={accountInput[conn.provider] ?? ""}
                      onChange={(e) =>
                        setAccountInput((m) => ({ ...m, [conn.provider]: e.target.value }))
                      }
                      placeholder="Account/workspace name (e.g. sal@pleasurepizza.com)"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleConnect(conn.provider, conn.label);
                        if (e.key === "Escape") setOpenProvider(null);
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleConnect(conn.provider, conn.label)}
                        disabled={connectMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
                        style={{ background: accent }}
                      >
                        {connectMutation.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        Connect
                      </button>
                      <button
                        onClick={() => setOpenProvider(null)}
                        className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <X className="size-3" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setOpenProvider(conn.provider)}
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:brightness-110"
                    style={{ background: accent }}
                  >
                    <Plug2 className="size-3.5" /> Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {connectedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur animate-in slide-in-from-bottom-4">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div className="text-sm">
              <span className="font-medium">{connectedCount}</span>{" "}
              <span className="text-muted-foreground">
                tool{connectedCount === 1 ? "" : "s"} connected. Ready to scan your data?
              </span>
            </div>
            <button
              onClick={handleScan}
              disabled={scanMutation.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground shadow-lg shadow-brand/30 transition-all hover:brightness-105 hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            >
              {scanMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Scan my data
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
