import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clipboard,
  Loader2,
  Plug,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { MobileMenuButton } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type McpScope =
  | "projects:read"
  | "conversations:reply"
  | "resources:write";

interface McpConnection {
  id: string;
  clientId: string;
  clientName: string;
  scopes: McpScope[];
  connectedAt: string;
}

interface McpConnectionsResponse {
  connections: McpConnection[];
}

interface ClientSnippet {
  id: string;
  label: string;
  location: string;
  code: string;
}

function buildClientSnippets(serverUrl: string): ClientSnippet[] {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      location: "Run in your terminal, then use /mcp to authorize",
      code: `claude mcp add --transport http --scope user replymaven ${serverUrl}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      location: "~/.cursor/mcp.json",
      code: JSON.stringify(
        {
          mcpServers: {
            replymaven: {
              type: "http",
              url: serverUrl,
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      location: ".vscode/mcp.json",
      code: JSON.stringify(
        {
          servers: {
            replymaven: {
              type: "http",
              url: serverUrl,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

function formatConnectedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getScopeLabel(scope: McpScope): string {
  switch (scope) {
    case "projects:read":
      return "Read workspace";
    case "conversations:reply":
      return "Reply to conversations";
    case "resources:write":
      return "Manage knowledge";
  }
}

function McpConnections() {
  const queryClient = useQueryClient();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const serverUrl = `${window.location.origin}/api/mcp`;
  const snippets = buildClientSnippets(serverUrl);

  const connectionsQuery = useQuery<McpConnectionsResponse>({
    queryKey: ["mcp-connections"],
    queryFn: async () => {
      const res = await fetch("/api/mcp/connections");
      if (!res.ok) throw new Error("Failed to load MCP connections");
      return res.json();
    },
  });

  const revokeConnection = useMutation({
    mutationFn: async (authorizationId: string) => {
      const res = await fetch(`/api/mcp/connections/${authorizationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to revoke connection");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      toast.success("MCP connection revoked");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  async function copyText(value: string, copyId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(copyId);
      window.setTimeout(() => setCopiedValue(null), 1_500);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function handleRevoke(connection: McpConnection): void {
    const confirmed = window.confirm(
      `Revoke ${connection.clientName}? It will immediately lose access to ReplyMaven.`,
    );
    if (confirmed) revokeConnection.mutate(connection.id);
  }

  const connections = connectionsQuery.data?.connections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            MCP Connections
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Connect AI clients to your ReplyMaven workspace with secure OAuth.
            Clients only receive the permissions you approve.
          </p>
        </div>
      </div>

      <section className="rounded-2xl bg-card p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            Connect a client
          </h2>
        </div>

        <Tabs defaultValue="claude-code">
          <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
            {snippets.map((snippet) => (
              <TabsTrigger key={snippet.id} value={snippet.id}>
                {snippet.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {snippets.map((snippet) => (
            <TabsContent key={snippet.id} value={snippet.id} className="mt-4">
              <div className="overflow-hidden rounded-xl bg-background">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="truncate text-xs text-muted-foreground">
                    {snippet.location}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyText(snippet.code, snippet.id)}
                    aria-label={`Copy ${snippet.label} configuration`}
                  >
                    {copiedValue === snippet.id ? (
                      <Check className="text-emerald-400" />
                    ) : (
                      <Clipboard />
                    )}
                    Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto px-4 pb-4 text-[13px] leading-6 text-foreground">
                  <code>{snippet.code}</code>
                </pre>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <section className="rounded-2xl bg-card p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Connected clients
            </h2>
          </div>
          {!connectionsQuery.isLoading && (
            <span className="shrink-0 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
              {connections.length} active
            </span>
          )}
        </div>

        {connectionsQuery.isLoading ? (
          <div className="space-y-3" aria-label="Loading MCP connections">
            {[0, 1].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-xl bg-muted/40" />
            ))}
          </div>
        ) : connectionsQuery.isError ? (
          <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            Connections could not be loaded. Refresh the page to try again.
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl bg-background/50 px-5 py-10 text-center">
            <ShieldCheck className="mb-3 size-8 text-muted-foreground" />
            <p className="font-medium text-foreground">No connected clients yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <article
                key={connection.id}
                className="flex flex-col gap-4 rounded-xl bg-background/50 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Plug className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {connection.clientName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connected {formatConnectedAt(connection.connectedAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {connection.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          {getScopeLabel(scope)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-end text-muted-foreground hover:text-destructive sm:self-center"
                  onClick={() => handleRevoke(connection)}
                  disabled={
                    revokeConnection.isPending &&
                    revokeConnection.variables === connection.id
                  }
                >
                  {revokeConnection.isPending &&
                  revokeConnection.variables === connection.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Unplug />
                  )}
                  Revoke
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default McpConnections;
