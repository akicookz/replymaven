import { useState, type ReactNode } from "react";
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
  Wrench,
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
  presetKey?: string;
  name?: string;
  url?: string;
  authMode: McpAuthMode;
  bearerToken?: string;
  headers?: Record<string, string>;
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

function parseHeaders(value: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    const headerValue = line.slice(separator + 1).trim();
    if (
      !key ||
      !headerValue ||
      Object.prototype.hasOwnProperty.call(headers, key)
    ) {
      return null;
    }
    headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : null;
}

function authLabel(mode: McpAuthMode): string {
  if (mode === "oauth") return "OAuth";
  if (mode === "bearer") return "Bearer token";
  if (mode === "headers") return "Custom headers";
  return "No authentication";
}

function policyFromConnection(connection: McpConnection): ToolPolicyInput[] {
  return connection.tools.map((tool) => ({
    toolName: tool.toolName,
    catalogFingerprint: tool.catalogFingerprint,
    enabled: tool.enabled,
    access: tool.access,
  }));
}

function isConnectionSettling(connection: McpConnection | undefined): boolean {
  if (!connection || connection.issue) return false;
  return connection.state === "connecting" ||
    connection.state === "connected" ||
    connection.state === "discovering";
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
      <Wrench className="size-4 text-muted-foreground" />
    </span>
  );
}

function McpConnections({ projectId }: McpConnectionsProps) {
  const queryClient = useQueryClient();
  const [customOpen, setCustomOpen] = useState(false);
  const [authMode, setAuthMode] = useState<McpAuthMode>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, ToolPolicyInput[]>>({});
  const [toolSearch, setToolSearch] = useState("");
  const [openToolGroups, setOpenToolGroups] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const queryKey = ["sidechat-mcp", projectId] as const;
  const { data, isLoading, isError } = useQuery<McpConnectionsResponse>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/sidechat/mcp/connections`);
      if (!response.ok) throw await parseError(response, "Failed to load MCP connections");
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
      if (!response.ok) throw await parseError(response, "Could not connect MCP server");
      return response.json() as Promise<{ connection: McpConnection }>;
    },
    onSuccess: ({ connection }, input) => {
      setBearerToken("");
      setCustomHeaders("");
      setCustomOpen(false);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey });
      if (connection.authUrl) {
        window.location.assign(connection.authUrl);
      } else if (connection.state === "ready") {
        setExpandedConnectionId(connection.id);
      } else if (input.presetKey) {
        toast.error(`Could not finish connecting ${connection.name}.`);
      }
    },
    onError: (error: Error, input) => {
      if (input.presetKey) toast.error(error.message);
      else setFormError(error.message);
    },
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

  function chooseCustom(): void {
    setCustomOpen((current) => !current);
    setExpandedConnectionId(null);
    setAuthMode("none");
    setBearerToken("");
    setFormError(null);
  }

  function submitConnection(): void {
    setFormError(null);
    const input: ConnectInput = {
      name: customName.trim(),
      url: customUrl.trim(),
      authMode,
      ...(authMode === "bearer" ? { bearerToken } : {}),
    };
    if (authMode === "headers") {
      const headers = parseHeaders(customHeaders);
      if (!headers) {
        setFormError("Enter one header per line as Name: value.");
        return;
      }
      input.headers = headers;
    }
    connect.mutate(input);
  }

  function activatePreset(
    preset: McpPreset,
    connection: McpConnection | undefined,
  ): void {
    if (connection?.state === "ready") {
      toggleConnection(connection);
      return;
    }
    if (!data?.canManage || connect.isPending || refresh.isPending) return;
    if (connection?.authUrl) {
      window.location.assign(connection.authUrl);
      return;
    }
    if (connection) {
      refresh.mutate(connection.id, {
        onSuccess: (result) => {
          const refreshed = (result as { connection?: McpConnection }).connection;
          if (refreshed?.authUrl) {
            window.location.assign(refreshed.authUrl);
          } else if (refreshed?.state === "ready") {
            setExpandedConnectionId(refreshed.id);
          } else {
            toast.error(`Could not finish connecting ${preset.label}.`);
          }
        },
      });
      return;
    }
    connect.mutate({ presetKey: preset.key, authMode: "oauth" });
  }

  function activateCustomConnection(connection: McpConnection): void {
    if (connection.state === "ready") {
      toggleConnection(connection);
      return;
    }
    if (!data?.canManage || refresh.isPending) return;
    if (connection.authUrl) {
      window.location.assign(connection.authUrl);
      return;
    }
    refresh.mutate(connection.id, {
      onSuccess: (result) => {
        const refreshed = (result as { connection?: McpConnection }).connection;
        if (refreshed?.authUrl) {
          window.location.assign(refreshed.authUrl);
        } else if (refreshed?.state === "ready") {
          setExpandedConnectionId(refreshed.id);
        } else {
          toast.error(`Could not finish connecting ${connection.name}.`);
        }
      },
    });
  }

  function toggleConnection(connection: McpConnection): void {
    const opening = expandedConnectionId !== connection.id;
    setExpandedConnectionId(opening ? connection.id : null);
    if (opening) {
      setCustomOpen(false);
      setToolSearch("");
      setPolicyDrafts((current) => ({
        ...current,
        [connection.id]: current[connection.id] ?? policyFromConnection(connection),
      }));
    }
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

  const allowedAuthModes: McpAuthMode[] = ["none", "oauth", "bearer", "headers"];
  const canSubmit = customName.trim().length > 0 &&
    customUrl.trim().length > 0 &&
    (authMode !== "bearer" || bearerToken.length > 0) &&
    (authMode !== "headers" || customHeaders.trim().length > 0);

  function renderConnectionSettings(connection: McpConnection) {
    const policies = policyDrafts[connection.id] ?? policyFromConnection(connection);
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
      <div
        id={`mcp-connection-${connection.id}`}
        className="space-y-5 bg-muted/20 px-4 py-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Connection</p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <p className="truncate text-xs text-muted-foreground">{connection.url}</p>
              <button
                type="button"
                aria-label="Copy MCP server URL"
                title="Copy URL"
                onClick={() => {
                  void navigator.clipboard.writeText(connection.url);
                  toast.success("MCP server URL copied.");
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
                  disabled={savePolicy.isPending}
                  onClick={() => savePolicy.mutate({
                    connectionId: connection.id,
                    tools: policies,
                  })}
                >
                  {savePolicy.isPending && <Loader2 className="animate-spin" />}
                  Save tools
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(connection.id)}
              >
                Disconnect
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More options for ${connection.name}`}
                    className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem
                    disabled={refresh.isPending}
                    onSelect={() => refresh.mutate(connection.id)}
                  >
                    <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
                    Refresh tools
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={disconnect.isPending}
                    onSelect={() => disconnect.mutate(connection.id)}
                  >
                    <Trash2 />
                    Remove connection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {connection.tools.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {connection.issue === "tool_discovery_failed"
              ? "Tool discovery failed. Refresh to try again."
              : "No tools discovered yet."}
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Tool permissions</h3>
              <p className="mt-1 text-xs text-muted-foreground text-pretty">
                Choose which tools Maven can use and when approval is required.
              </p>
            </div>

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
                            className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {permissionLabel(currentPermission)}
                            <ChevronDown className="size-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
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
                            className="flex min-h-14 items-center gap-3 rounded-xl bg-background/75 px-3 py-2"
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
                                    "flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
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
                                    "flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                                    "flex size-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
    const connected = connection?.state === "ready";
    const settling = isConnectionSettling(connection);
    const expanded = connected && expandedConnectionId === connection.id;
    const busy =
      (connect.isPending && connect.variables?.presetKey === key) ||
      (refresh.isPending && refresh.variables === connection?.id) ||
      settling;
    return (
      <div
        key={key}
        className={cn(
          "overflow-hidden rounded-xl bg-card",
          connected ? "" : "border-2 border-dashed border-muted",
        )}
      >
        <button
          type="button"
          aria-expanded={connected ? expanded : undefined}
          aria-controls={connected ? `mcp-connection-${connection.id}` : undefined}
          disabled={!connected && (!data?.canManage || settling)}
          onClick={onActivate}
          className="flex min-h-14 w-full min-w-0 items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
        >
          <div className="flex shrink-0 items-center gap-2">
            {expanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            {mark}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {label}
          </p>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-xs font-medium",
              connected ? "text-primary" : "text-muted-foreground",
            )}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {connected ? "Connected" : settling ? "Connecting" : "Connect"}
          </span>
        </button>
        {expanded && connection && renderConnectionSettings(connection)}
      </div>
    );
  }

  function renderCustomConnectionForm() {
    return (
      <div id="custom-mcp-connection" className="space-y-4 bg-muted/20 px-4 py-4">
        <p className="text-xs text-muted-foreground text-pretty">
          Credentials are sent directly to the project agent and are never shown again.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            Server name
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-input focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Customer data"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            HTTPS server URL
            <input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-input focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="https://mcp.example.com/mcp"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Authentication method">
          {allowedAuthModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAuthMode(mode)}
              aria-pressed={authMode === mode}
              className={cn(
                "min-h-10 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                authMode === mode
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {authLabel(mode)}
            </button>
          ))}
        </div>

        {authMode === "bearer" && (
          <label className="max-w-xl space-y-1.5 text-sm font-medium text-foreground">
            Bearer token
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Custom server bearer token"
              value={bearerToken}
              onChange={(event) => setBearerToken(event.target.value)}
              className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-input focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Paste token"
            />
          </label>
        )}

        {authMode === "headers" && (
          <label className="max-w-xl space-y-1.5 text-sm font-medium text-foreground">
            Headers
            <textarea
              value={customHeaders}
              onChange={(event) => setCustomHeaders(event.target.value)}
              className="min-h-24 w-full resize-y rounded-xl bg-background px-3 py-2 text-sm outline-none ring-1 ring-input focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="X-API-Key: value"
            />
            <span className="block text-xs font-normal text-muted-foreground">
              One header per line. Values are write-only.
            </span>
          </label>
        )}

        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-10"
            disabled={!canSubmit || connect.isPending}
            onClick={submitConnection}
          >
            {connect.isPending && <Loader2 className="animate-spin" />}
            Connect server
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-10"
            onClick={() => {
              setCustomOpen(false);
              setBearerToken("");
              setCustomHeaders("");
              setFormError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function renderCustomServerCard() {
    return (
      <div className="overflow-hidden rounded-xl border-2 border-dashed border-muted bg-card">
        <button
          type="button"
          aria-expanded={customOpen}
          aria-controls="custom-mcp-connection"
          disabled={!data?.canManage}
          onClick={chooseCustom}
          className="flex min-h-14 w-full min-w-0 items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
        >
          <div className="flex shrink-0 items-center gap-2">
            {customOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <GenericServerMark />
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            Custom server
          </p>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            Connect
          </span>
        </button>
        {customOpen && data?.canManage && renderCustomConnectionForm()}
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="mcp-connections-heading">
      <div>
        <div>
          <h2 id="mcp-connections-heading" className="text-lg font-semibold text-foreground">
            MCP connections
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            Connect MCP servers to private Sidechat.
          </p>
        </div>
      </div>

      {isLoading && <div className="h-24 rounded-2xl bg-muted/50 animate-pulse" />}
      {isError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          Failed to load MCP connections.
        </div>
      )}

      {data && (
        <>
          {!data.canManage && (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Only project owners and admins can change MCP connections.
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
            {renderCustomServerCard()}
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
