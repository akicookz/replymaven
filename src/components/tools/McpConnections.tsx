import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Hand,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  Trash2,
  Server,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ExpandableToolCard } from "./ExpandableToolCard";

type McpAuthMode = "oauth" | "bearer" | "headers" | "none";
type McpToolAccess = "read" | "write";
type McpToolSafety = "read" | "write" | "destructive";
type McpToolPermission = "allow" | "ask" | "disabled";

interface McpPreset {
  key: string;
  label: string;
  url: string;
  auth: McpAuthMode[];
  icon: string;
  readOnly?: boolean;
}

interface McpTool {
  connectionId: string;
  toolName: string;
  exposedName: string;
  displayName: string;
  description: string;
  inputSchema: unknown;
  catalogFingerprint: string;
  audience: "sidechat";
  safety?: McpToolSafety;
  access: McpToolAccess;
  enabled: boolean;
  alwaysAllowed: boolean;
}

interface McpConnection {
  id: string;
  name: string;
  presetKey: string | null;
  url: string;
  authMode: McpAuthMode;
  state: string;
  authUrl?: string;
  issue?: "tool_discovery_failed";
  tools: McpTool[];
}

interface McpConnectionsResponse {
  canManage: boolean;
  presets: McpPreset[];
  connections: McpConnection[];
}

interface McpConnectionsProps {
  projectId: string;
}

interface ConnectInput {
  presetKey: string;
  authMode: McpAuthMode;
}

interface ToolPolicyInput {
  toolName: string;
  catalogFingerprint: string;
  enabled: boolean;
  access: McpToolAccess;
}

interface PolicyMutationInput {
  connectionId: string;
  tools: ToolPolicyInput[];
}

async function parseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

function policyFromConnection(connection: McpConnection): ToolPolicyInput[] {
  return connection.tools.map((tool) => ({
    toolName: tool.toolName,
    catalogFingerprint: tool.catalogFingerprint,
    enabled: tool.enabled,
    access: tool.access,
  }));
}

function isMcpLinked(connection: McpConnection | undefined): boolean {
  if (!connection) return false;
  return connection.state === "connecting" ||
    connection.state === "connected" ||
    connection.state === "discovering" ||
    connection.state === "ready";
}

function isConnectionSettling(connection: McpConnection | undefined): boolean {
  if (!connection || connection.issue) return false;
  return connection.state === "connecting" ||
    connection.state === "discovering" ||
    (connection.state === "connected" && connection.tools.length === 0);
}

function connectionCardStatus(
  connection: McpConnection | undefined,
  settling: boolean,
  reconnecting: boolean,
): "Configure" | "Connecting" | "Reconnecting" | "Reconnect" | "Connect" {
  if (reconnecting) return "Reconnecting";
  if (settling) return "Connecting";
  if (isMcpLinked(connection)) return "Configure";
  if (connection?.authMode === "oauth") return "Reconnect";
  return "Connect";
}

function policiesMatch(left: ToolPolicyInput[], right: ToolPolicyInput[]): boolean {
  if (left.length !== right.length) return false;
  const rightByName = new Map(right.map((item) => [item.toolName, item]));
  return left.every((item) => {
    const other = rightByName.get(item.toolName);
    return other != null
      && item.catalogFingerprint === other.catalogFingerprint
      && item.enabled === other.enabled
      && item.access === other.access;
  });
}

function oauthErrorMessage(category: string): string {
  if (category === "expired") return "Authorization expired. Reconnect to try again.";
  if (category === "denied") return "Authorization was cancelled. Reconnect to try again.";
  return "MCP authorization failed. Reconnect to try again.";
}

function reconnectErrorMessage(message: string): string {
  if (message === "mcp_reconnect_failed") return "Could not reconnect. Try again.";
  if (message === "oauth_reconnect_unsupported") return "This connection does not use OAuth. Refresh tools instead.";
  return message;
}

function emptyToolsCopy(connection: McpConnection): string {
  if (isConnectionSettling(connection)) return "Loading tools.";
  return "No tools discovered yet. Refresh to try again.";
}

function safetyForTool(tool: McpTool): McpToolSafety {
  return tool.safety ?? (tool.access === "read" ? "read" : "write");
}

function permissionForTool(
  tool: McpTool,
  policy: ToolPolicyInput,
): McpToolPermission {
  if (!policy.enabled) return "disabled";
  if (tool.alwaysAllowed || policy.access === "read") return "allow";
  return "ask";
}

function groupPermission(
  tools: McpTool[],
  policies: ToolPolicyInput[],
): McpToolPermission | "mixed" {
  const values = new Set(
    tools.map((tool) => {
      const policy = policies.find((item) => item.toolName === tool.toolName) ?? {
        toolName: tool.toolName,
        catalogFingerprint: tool.catalogFingerprint,
        enabled: false,
        access: tool.access,
      };
      return permissionForTool(tool, policy);
    }),
  );
  return values.size === 1 ? [...values][0]! : "mixed";
}

function permissionLabel(permission: McpToolPermission | "mixed"): string {
  if (permission === "allow") return "Always allow";
  if (permission === "ask") return "Ask before use";
  if (permission === "disabled") return "Disabled";
  return "Mixed";
}

function groupLabel(safety: McpToolSafety): string {
  if (safety === "read") return "Read-only tools";
  if (safety === "destructive") return "Destructive tools";
  return "Write tools";
}

function ProviderMark({ preset }: { preset: McpPreset }) {
  return (
    <img
      src={preset.icon}
      alt=""
      aria-hidden="true"
      className="size-8 shrink-0 rounded-lg bg-muted object-contain p-1.5"
    />
  );
}

function GenericServerMark() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
      <Server className="size-4 text-muted-foreground" />
    </span>
  );
}

function McpConnections({ projectId }: McpConnectionsProps) {
  const queryClient = useQueryClient();
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, ToolPolicyInput[]>>({});
  const [toolSearch, setToolSearch] = useState("");
  const [openToolGroups, setOpenToolGroups] = useState<Record<string, boolean>>({});

  const queryKey = ["sidechat-mcp", projectId] as const;
  useEffect(() => {
    const url = new URL(window.location.href);
    const category = url.searchParams.get("mcp_oauth_error");
    if (!category) return;
    toast.error(oauthErrorMessage(category));
    url.searchParams.delete("mcp_oauth_error");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const { data, isLoading, isError } = useQuery<McpConnectionsResponse>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/sidechat/mcp/connections`);
      if (!response.ok) throw await parseError(response, "Failed to load connectors");
      return response.json();
    },
    refetchInterval: (query) =>
      query.state.data?.connections.some(isConnectionSettling) ? 1_500 : false,
  });

  const connect = useMutation({
    mutationFn: async (input: ConnectInput) => {
      const response = await fetch(`/api/projects/${projectId}/sidechat/mcp/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await parseError(response, "Could not connect");
      return response.json() as Promise<{ connection: McpConnection }>;
    },
    onSuccess: ({ connection }) => {
      void queryClient.invalidateQueries({ queryKey });
      if (connection.authUrl) {
        window.location.assign(connection.authUrl);
      } else if (isMcpLinked(connection)) {
        setExpandedConnectionId(connection.id);
      } else {
        toast.error(`Could not finish connecting ${connection.name}.`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const savePolicy = useMutation({
    mutationFn: async ({ connectionId, tools }: PolicyMutationInput) => {
      const response = await fetch(
        `/api/projects/${projectId}/sidechat/mcp/connections/${connectionId}/tools`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tools }),
        },
      );
      if (!response.ok) throw await parseError(response, "Could not save tool access");
      return response.json() as Promise<{ connection: McpConnection }>;
    },
    onSuccess: ({ connection }) => {
      setPolicyDrafts((current) => ({
        ...current,
        [connection.id]: policyFromConnection(connection),
      }));
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Tool permissions saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refresh = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/sidechat/mcp/connections/${connectionId}/refresh`,
        { method: "POST" },
      );
      if (!response.ok) throw await parseError(response, "Could not refresh tools");
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reconnect = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/sidechat/mcp/connections/${connectionId}/reconnect`,
        { method: "POST" },
      );
      if (!response.ok) throw await parseError(response, "Could not reconnect server");
      return response.json() as Promise<{ connection: McpConnection }>;
    },
    onSuccess: ({ connection }) => {
      void queryClient.invalidateQueries({ queryKey });
      if (connection.authUrl) {
        window.location.assign(connection.authUrl);
      } else if (isMcpLinked(connection)) {
        setExpandedConnectionId(connection.id);
      }
    },
    onError: (error: Error) => toast.error(reconnectErrorMessage(error.message)),
  });

  const disconnect = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/sidechat/mcp/connections/${connectionId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw await parseError(response, "Could not disconnect server");
    },
    onSuccess: () => {
      setExpandedConnectionId(null);
      setToolSearch("");
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const revokeAlwaysAllow = useMutation({
    mutationFn: async (tool: McpTool) => {
      const response = await fetch(
        `/api/projects/${projectId}/sidechat/approvals/always`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: tool.connectionId,
            toolName: tool.toolName,
            catalogFingerprint: tool.catalogFingerprint,
          }),
        },
      );
      if (!response.ok) {
        throw await parseError(response, "Could not revoke permission");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function activatePreset(
    preset: McpPreset,
    connection: McpConnection | undefined,
  ): void {
    if (connection && isMcpLinked(connection)) {
      toggleConnection(connection);
      return;
    }
    if (!data?.canManage || connect.isPending || refresh.isPending || reconnect.isPending) return;
    if (connection) {
      reconnect.mutate(connection.id);
      return;
    }
    connect.mutate({ presetKey: preset.key, authMode: "oauth" });
  }

  function activateCustomConnection(connection: McpConnection): void {
    if (isMcpLinked(connection)) {
      toggleConnection(connection);
      return;
    }
    if (!data?.canManage || refresh.isPending || reconnect.isPending) return;
    if (connection.authMode === "oauth") {
      reconnect.mutate(connection.id);
      return;
    }
    refresh.mutate(connection.id, {
      onSuccess: (result) => {
        const refreshed = (result as { connection?: McpConnection }).connection;
        if (refreshed?.authUrl) {
          window.location.assign(refreshed.authUrl);
        } else if (refreshed && isMcpLinked(refreshed)) {
          setExpandedConnectionId(refreshed.id);
        } else {
          toast.error(`Could not finish connecting ${connection.name}.`);
        }
      },
    });
  }

  function setConnectionPanel(connection: McpConnection, opening: boolean): void {
    setExpandedConnectionId(opening ? connection.id : null);
    if (opening) {
      setToolSearch("");
      setPolicyDrafts((current) => ({
        ...current,
        [connection.id]: current[connection.id] ?? policyFromConnection(connection),
      }));
    }
  }

  function toggleConnection(connection: McpConnection): void {
    setConnectionPanel(connection, expandedConnectionId !== connection.id);
  }

  function permissionUpdate(
    tool: McpTool,
    permission: McpToolPermission,
  ): Pick<ToolPolicyInput, "enabled" | "access"> | null {
    const safety = safetyForTool(tool);
    if (permission === "disabled") {
      return {
        enabled: false,
        access: safety === "read" ? "read" : "write",
      };
    }
    if (permission === "ask") {
      return { enabled: true, access: "write" };
    }
    if (safety === "read") {
      return { enabled: true, access: "read" };
    }
    if (tool.alwaysAllowed) {
      return { enabled: true, access: "write" };
    }
    return null;
  }

  function setToolPermission(
    connection: McpConnection,
    tool: McpTool,
    permission: McpToolPermission,
  ): void {
    const update = permissionUpdate(tool, permission);
    if (!update) {
      toast.info("Approve this tool once in Sidechat before allowing it automatically.");
      return;
    }
    if (permission === "ask" && tool.alwaysAllowed) {
      revokeAlwaysAllow.mutate(tool);
    }
    updateToolPolicy(connection, tool.toolName, update);
  }

  function setGroupPermission(
    connection: McpConnection,
    tools: McpTool[],
    permission: McpToolPermission,
  ): void {
    if (permission === "ask") {
      for (const tool of tools) {
        if (tool.alwaysAllowed) revokeAlwaysAllow.mutate(tool);
      }
    }
    setPolicyDrafts((current) => {
      const policies = current[connection.id] ?? policyFromConnection(connection);
      const updates = new Map(
        tools.flatMap((tool) => {
          const update = permissionUpdate(tool, permission);
          return update ? [[tool.toolName, update] as const] : [];
        }),
      );
      return {
        ...current,
        [connection.id]: policies.map((policy) => {
          const update = updates.get(policy.toolName);
          return update ? { ...policy, ...update } : policy;
        }),
      };
    });
  }

  function toggleToolGroup(connectionId: string, safety: McpToolSafety): void {
    const key = `${connectionId}:${safety}`;
    setOpenToolGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  function updateToolPolicy(
    connection: McpConnection,
    toolName: string,
    update: Partial<Pick<ToolPolicyInput, "enabled" | "access">>,
  ): void {
    setPolicyDrafts((current) => ({
      ...current,
      [connection.id]: (current[connection.id] ?? policyFromConnection(connection)).map(
        (tool) => tool.toolName === toolName ? { ...tool, ...update } : tool,
      ),
    }));
  }

  function renderConnectionSettings(connection: McpConnection) {
    const reconnecting = reconnect.isPending && reconnect.variables === connection.id;
    const savedPolicy = policyFromConnection(connection);
    const policies = policyDrafts[connection.id] ?? savedPolicy;
    const policyDirty = !policiesMatch(policies, savedPolicy);
    const normalizedSearch = toolSearch.trim().toLowerCase();
    const filteredTools = connection.tools.filter((tool) =>
      !normalizedSearch ||
      tool.displayName.toLowerCase().includes(normalizedSearch) ||
      tool.toolName.toLowerCase().includes(normalizedSearch) ||
      tool.description.toLowerCase().includes(normalizedSearch)
    );
    const groups = (["read", "write", "destructive"] as const)
      .map((safety) => ({
        safety,
        tools: filteredTools.filter((tool) => safetyForTool(tool) === safety),
      }))
      .filter((group) => group.tools.length > 0);
    return (
      <div className="space-y-5 px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Connection</p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <p className="truncate text-xs text-muted-foreground">{connection.url}</p>
              <button
                type="button"
                aria-label="Copy connector URL"
                title="Copy URL"
                onClick={() => {
                  void navigator.clipboard.writeText(connection.url);
                  toast.success("Connector URL copied.");
                }}
                className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:size-10 after:content-['']"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>

          {data?.canManage && (
            <div className="flex shrink-0 items-center gap-2">
              {connection.tools.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={savePolicy.isPending || reconnecting || !policyDirty}
                  onClick={() => savePolicy.mutate({
                    connectionId: connection.id,
                    tools: policies,
                  })}
                >
                  {savePolicy.isPending && <Loader2 className="animate-spin" />}
                  Save tools
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 px-0"
                    aria-label={`More options for ${connection.name}`}
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-32">
                  <DropdownMenuItem
                    disabled={refresh.isPending || reconnecting}
                    onSelect={() => refresh.mutate(connection.id)}
                  >
                    <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
                    Refresh tools
                  </DropdownMenuItem>
                  {connection.authMode === "oauth" && (
                    <DropdownMenuItem
                      disabled={reconnect.isPending}
                      onSelect={() => reconnect.mutate(connection.id)}
                    >
                      <RefreshCw className={cn(reconnect.isPending && "animate-spin")} />
                      Reconnect
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={disconnect.isPending || reconnecting}
                    onSelect={() => disconnect.mutate(connection.id)}
                  >
                    <Trash2 />
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {connection.tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {emptyToolsCopy(connection)}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={toolSearch}
                onChange={(event) => setToolSearch(event.target.value)}
                placeholder={`Search ${connection.tools.length} tools`}
                aria-label={`Search ${connection.name} tools`}
                className="pl-9"
              />
            </div>

            {groups.length === 0 ? (
              <p className="rounded-xl bg-background/60 px-3 py-4 text-sm text-muted-foreground">
                No tools match your search.
              </p>
            ) : groups.map((group) => {
              const groupKey = `${connection.id}:${group.safety}`;
              const open = normalizedSearch.length > 0 || openToolGroups[groupKey] === true;
              const currentPermission = groupPermission(group.tools, policies);
              const canAllowAll = group.safety === "read" ||
                group.tools.every((tool) => tool.alwaysAllowed);
              return (
                <div key={group.safety} className="space-y-2 rounded-xl bg-background/45 p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleToolGroup(connection.id, group.safety)}
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {open ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium text-foreground">
                        {groupLabel(group.safety)}
                      </span>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                        {group.tools.length}
                      </span>
                    </button>

                    {data?.canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {permissionLabel(currentPermission)}
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-32">
                          {canAllowAll && (
                            <DropdownMenuItem
                              onSelect={() => setGroupPermission(
                                connection,
                                group.tools,
                                "allow",
                              )}
                            >
                              <Check />
                              Always allow
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => setGroupPermission(
                              connection,
                              group.tools,
                              "ask",
                            )}
                          >
                            <Hand />
                            Ask before use
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setGroupPermission(
                              connection,
                              group.tools,
                              "disabled",
                            )}
                          >
                            <Ban />
                            Disable
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {open && (
                    <div className="space-y-1.5">
                      {group.tools.map((tool) => {
                        const policy = policies.find(
                          (item) => item.toolName === tool.toolName,
                        ) ?? {
                          toolName: tool.toolName,
                          catalogFingerprint: tool.catalogFingerprint,
                          enabled: false,
                          access: tool.access,
                        };
                        const permission = permissionForTool(tool, policy);
                        const allowDisabled = group.safety !== "read" &&
                          !tool.alwaysAllowed;
                        return (
                          <div
                            key={tool.toolName}
                            className="flex min-h-10 items-center gap-3 rounded-xl bg-background/75 px-3 py-1.5"
                            title={tool.description || undefined}
                          >
                            <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                              {tool.displayName}
                            </p>
                            {data?.canManage && (
                              <div
                                className="flex shrink-0 rounded-lg bg-muted p-0.5"
                                aria-label={`${tool.displayName} permission`}
                              >
                                <button
                                  type="button"
                                  aria-label={`Always allow ${tool.displayName}`}
                                  aria-pressed={permission === "allow"}
                                  disabled={allowDisabled}
                                  title={allowDisabled
                                    ? "Approve once in Sidechat before allowing automatically"
                                    : "Always allow"}
                                  onClick={() => setToolPermission(connection, tool, "allow")}
                                  className={cn(
                                    "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
                                    permission === "allow"
                                      ? "bg-background text-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  <Check className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Ask before using ${tool.displayName}`}
                                  aria-pressed={permission === "ask"}
                                  title="Ask before use"
                                  onClick={() => setToolPermission(connection, tool, "ask")}
                                  className={cn(
                                    "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    permission === "ask"
                                      ? "bg-background text-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  <Hand className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Disable ${tool.displayName}`}
                                  aria-pressed={permission === "disabled"}
                                  title="Disable"
                                  onClick={() => setToolPermission(connection, tool, "disabled")}
                                  className={cn(
                                    "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    permission === "disabled"
                                      ? "bg-background text-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  <Ban className="size-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderConnectionCard(
    key: string,
    label: string,
    mark: ReactNode,
    connection: McpConnection | undefined,
    onActivate: () => void,
  ) {
    const connected = isMcpLinked(connection);
    const settling = isConnectionSettling(connection);
    const expanded = Boolean(
      connected && connection && expandedConnectionId === connection.id,
    );
    const busy =
      (connect.isPending && connect.variables?.presetKey === key) ||
      (refresh.isPending && refresh.variables === connection?.id) ||
      (reconnect.isPending && reconnect.variables === connection?.id) ||
      settling;
    const status = (
      <>
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {connectionCardStatus(
          connection,
          settling,
          reconnect.isPending && reconnect.variables === connection?.id,
        )}
      </>
    );
    const disabled =
      (!connected && (!data?.canManage || settling)) ||
      (reconnect.isPending && reconnect.variables === connection?.id);

    return (
      <ExpandableToolCard
        key={key}
        mark={mark}
        title={label}
        status={status}
        configured={connected}
        disabled={disabled}
        mode={connected && connection ? "panel" : "action"}
        open={expanded}
        onActivate={onActivate}
        onOpenChange={(next) => {
          if (connection) setConnectionPanel(connection, next);
        }}
        panelId={connection ? `mcp-connection-${connection.id}` : undefined}
      >
        {connection && renderConnectionSettings(connection)}
      </ExpandableToolCard>
    );
  }

  return (
    <section className="space-y-3" aria-label="MCP connectors">
      {isLoading && <div className="h-24 rounded-2xl bg-muted/50 animate-pulse" />}
      {isError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          Failed to load connectors.
        </div>
      )}

      {data && (
        <>
          {!data.canManage && (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Only project owners and admins can change connectors.
            </p>
          )}

          <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
            {data.presets.map((preset) => {
              const connection = data.connections.find(
                (candidate) => candidate.presetKey === preset.key,
              );
              return renderConnectionCard(
                preset.key,
                preset.label,
                <ProviderMark preset={preset} />,
                connection,
                () => activatePreset(preset, connection),
              );
            })}
            {data.connections
              .filter((connection) => connection.presetKey === null)
              .map((connection) => renderConnectionCard(
                connection.id,
                connection.name,
                <GenericServerMark />,
                connection,
                () => activateCustomConnection(connection),
              ))}
          </div>
        </>
      )}
    </section>
  );
}

export default McpConnections;
