import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type McpAuthMode = "oauth" | "bearer" | "headers" | "none";
type McpToolAccess = "read" | "write";

interface McpPreset {
  key: string;
  label: string;
  url: string;
  auth: McpAuthMode[];
  icon: string;
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
  access: McpToolAccess;
  enabled: boolean;
}

interface McpConnection {
  id: string;
  name: string;
  presetKey: string | null;
  url: string;
  authMode: McpAuthMode;
  state: string;
  authUrl?: string;
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

function stateLabel(state: string): string {
  if (state === "ready" || state === "connected") return "Connected";
  if (state === "authenticating") return "Authorization required";
  if (state === "connecting" || state === "discovering") return "Connecting";
  if (state === "disconnected") return "Disconnected";
  return "Connection failed";
}

function stateDotClass(state: string): string {
  if (state === "ready" || state === "connected") return "bg-success";
  if (state === "authenticating" || state === "connecting" || state === "discovering") {
    return "bg-warning";
  }
  return "bg-destructive";
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

function ProviderMark({ preset }: { preset: McpPreset }) {
  return (
    <img
      src={preset.icon}
      alt=""
      aria-hidden="true"
      className="size-8 shrink-0 rounded-lg bg-background object-contain p-1.5 ring-1 ring-foreground/5"
    />
  );
}

function McpConnections({ projectId }: McpConnectionsProps) {
  const queryClient = useQueryClient();
  const [selectedPreset, setSelectedPreset] = useState<McpPreset | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [authMode, setAuthMode] = useState<McpAuthMode>("oauth");
  const [bearerToken, setBearerToken] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, ToolPolicyInput[]>>({});
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const queryKey = ["sidechat-mcp", projectId] as const;
  const { data, isLoading, isError } = useQuery<McpConnectionsResponse>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/sidechat/mcp/connections`);
      if (!response.ok) throw await parseError(response, "Failed to load MCP connections");
      return response.json();
    },
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
    onSuccess: ({ connection }) => {
      setBearerToken("");
      setCustomHeaders("");
      setAuthorizationUrl(connection.authUrl ?? null);
      setSelectedPreset(null);
      setCustomOpen(false);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => setFormError(error.message),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
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
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function choosePreset(preset: McpPreset): void {
    setSelectedPreset(preset);
    setCustomOpen(false);
    setExpandedConnectionId(null);
    setAuthMode(preset.auth[0] ?? "oauth");
    setBearerToken("");
    setAuthorizationUrl(null);
    setFormError(null);
  }

  function chooseCustom(): void {
    setSelectedPreset(null);
    setCustomOpen(true);
    setExpandedConnectionId(null);
    setAuthMode("none");
    setBearerToken("");
    setAuthorizationUrl(null);
    setFormError(null);
  }

  function submitConnection(): void {
    setFormError(null);
    const input: ConnectInput = selectedPreset
      ? {
          presetKey: selectedPreset.key,
          authMode,
          ...(authMode === "bearer" ? { bearerToken } : {}),
        }
      : {
          name: customName.trim(),
          url: customUrl.trim(),
          authMode,
          ...(authMode === "bearer" ? { bearerToken } : {}),
        };
    if (!selectedPreset && authMode === "headers") {
      const headers = parseHeaders(customHeaders);
      if (!headers) {
        setFormError("Enter one header per line as Name: value.");
        return;
      }
      input.headers = headers;
    }
    connect.mutate(input);
  }

  function toggleConnection(connection: McpConnection): void {
    const opening = expandedConnectionId !== connection.id;
    setExpandedConnectionId(opening ? connection.id : null);
    if (opening) {
      setPolicyDrafts((current) => ({
        ...current,
        [connection.id]: current[connection.id] ?? policyFromConnection(connection),
      }));
    }
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

  const allowedAuthModes: McpAuthMode[] = selectedPreset
    ? selectedPreset.auth
    : ["none", "oauth", "bearer", "headers"];
  const canSubmit = selectedPreset
    ? authMode !== "bearer" || bearerToken.length > 0
    : customName.trim().length > 0 &&
      customUrl.trim().length > 0 &&
      (authMode !== "bearer" || bearerToken.length > 0) &&
      (authMode !== "headers" || customHeaders.trim().length > 0);

  return (
    <section className="space-y-3" aria-labelledby="mcp-connections-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="mcp-connections-heading" className="text-sm font-semibold text-foreground">
            MCP connections
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
            Connect project servers for private Sidechat. Discovered tools stay disabled until you enable them.
          </p>
        </div>
        {data?.canManage && (
          <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={chooseCustom}>
            <Plus />
            Custom server
          </Button>
        )}
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

          {data.canManage && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {data.presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => choosePreset(preset)}
                  aria-expanded={selectedPreset?.key === preset.key}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedPreset?.key === preset.key ? "bg-accent" : "hover:bg-muted/60",
                  )}
                >
                  <ProviderMark preset={preset} />
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">{preset.label}</p>
                </button>
              ))}
            </div>
          )}

          {data.canManage && (selectedPreset || customOpen) && (
            <div className="rounded-2xl bg-card p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Connect {selectedPreset?.label ?? "custom MCP server"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Credentials are sent directly to the project agent and are never shown again.
                  </p>
                </div>

                {!selectedPreset && (
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
                )}

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
                      aria-label={`${selectedPreset?.label ?? "Custom server"} bearer token`}
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
                    Connect {selectedPreset?.label ?? "server"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-10"
                    onClick={() => {
                      setSelectedPreset(null);
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
            </div>
          )}

          {authorizationUrl && (
            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground">
                Authorization is required to finish this connection.
              </p>
              <Button asChild size="sm" className="min-h-10">
                <a href={authorizationUrl} target="_blank" rel="noreferrer">
                  Continue authorization
                </a>
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {data.connections.length === 0 ? (
              <p className="rounded-xl bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                No MCP servers connected yet.
              </p>
            ) : (
              data.connections.map((connection) => {
                const expanded = expandedConnectionId === connection.id;
                const policies = policyDrafts[connection.id] ?? policyFromConnection(connection);
                return (
                  <div key={connection.id} className="overflow-hidden rounded-xl bg-card shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggleConnection(connection)}
                      aria-expanded={expanded}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{connection.name}</p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("size-1.5 rounded-full", stateDotClass(connection.state))} />
                          {stateLabel(connection.state)} · {connection.tools.length} tools
                        </div>
                      </div>
                    </button>

                    {expanded && (
                      <div className="space-y-4 bg-muted/20 px-4 py-4">
                        {connection.authUrl && (
                          <Button asChild size="sm" className="min-h-10">
                            <a href={connection.authUrl} target="_blank" rel="noreferrer">
                              Continue authorization
                            </a>
                          </Button>
                        )}

                        {connection.tools.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No tools discovered. Refresh after the server is authorized.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {connection.tools.map((tool) => {
                              const policy = policies.find((item) => item.toolName === tool.toolName) ?? {
                                toolName: tool.toolName,
                                catalogFingerprint: tool.catalogFingerprint,
                                enabled: false,
                                access: tool.access,
                              };
                              return (
                                <div key={tool.toolName} className="rounded-xl bg-background/70 px-3 py-3">
                                  <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-foreground">{tool.displayName}</p>
                                      {tool.description && (
                                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground text-pretty">
                                          {tool.description}
                                        </p>
                                      )}
                                    </div>
                                    {data.canManage && (
                                      <div className="flex min-h-10 shrink-0 items-center px-2">
                                        <Switch
                                          size="sm"
                                          className="relative after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
                                          checked={policy.enabled}
                                          onCheckedChange={(enabled) => updateToolPolicy(
                                            connection,
                                            tool.toolName,
                                            { enabled },
                                          )}
                                          aria-label={`Enable ${tool.displayName}`}
                                        />
                                      </div>
                                    )}
                                  </div>
                                  {data.canManage && (
                                    <div className="mt-2 flex gap-1" aria-label={`${tool.displayName} access`}>
                                      {(["read", "write"] as const).map((access) => (
                                        <button
                                          key={access}
                                          type="button"
                                          onClick={() => updateToolPolicy(
                                            connection,
                                            tool.toolName,
                                            { access },
                                          )}
                                          aria-pressed={policy.access === access}
                                          className={cn(
                                            "min-h-10 rounded-lg px-3 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            policy.access === access
                                              ? "bg-foreground text-background"
                                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                          )}
                                        >
                                          {access}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {data.canManage && (
                          <div className="flex flex-wrap items-center gap-2">
                            {connection.tools.length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                className="min-h-10"
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
                              className="min-h-10"
                              disabled={refresh.isPending}
                              onClick={() => refresh.mutate(connection.id)}
                            >
                              <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
                              Refresh
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="min-h-10 text-destructive hover:text-destructive"
                              disabled={disconnect.isPending}
                              onClick={() => disconnect.mutate(connection.id)}
                            >
                              <Trash2 />
                              Disconnect
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default McpConnections;
