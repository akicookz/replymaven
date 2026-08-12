import type { SidechatToolDescriptor } from "../../shared/sidechat-agent";
import type {
  ConnectProjectMcpInput,
  McpConnectionView,
  ProjectMcpPolicyInput,
} from "../agents/sidechat/mcp-types";
import { getMcpPreset, listMcpPresets } from "../agents/sidechat/mcp-presets";
import {
  validateMcpCallbackHost,
  validateMcpServerUrl,
} from "../agents/sidechat/mcp-policy";
import {
  createProjectMcpConnectionSchema,
  grantSidechatAlwaysAllowSchema,
  revokeSidechatAlwaysAllowSchema,
  updateProjectMcpPolicySchema,
} from "../validation";
import type { SidechatRouteActor } from "./sidechat-agent-handlers";

interface ProjectMcpParent {
  connectMcp(input: ConnectProjectMcpInput): Promise<McpConnectionView>;
  listMcpConnections(): Promise<McpConnectionView[]>;
  refreshMcpCatalog(connectionId: string): Promise<McpConnectionView | null>;
  disconnectMcp(connectionId: string): Promise<boolean>;
  updateMcpToolPolicy(
    connectionId: string,
    tools: ProjectMcpPolicyInput[],
  ): Promise<McpConnectionView | null>;
  grantAlwaysForPendingApproval(
    conversationId: string,
    actorUserId: string,
    approvalId: string,
    toolCallId: string,
  ): Promise<boolean>;
  revokeAlwaysAllow(
    connectionId: string,
    toolName: string,
    catalogFingerprint: string,
  ): Promise<boolean>;
}

interface ProjectMcpCallbackParent {
  fetch(request: Request): Promise<Response>;
}

interface ProjectServiceLike {
  getProjectById(
    projectId: string,
  ): Promise<{ id: string; userId: string } | null>;
}

interface AuthorizedProjectOptions {
  actor: SidechatRouteActor | null;
  projectId: string;
  projectService: ProjectServiceLike;
}

interface ProjectMcpOptions extends AuthorizedProjectOptions {
  getParent(): Promise<ProjectMcpParent>;
}

interface ConnectProjectMcpOptions extends ProjectMcpOptions {
  request: Request;
  callbackHost: string;
}

interface ConnectionProjectMcpOptions extends ProjectMcpOptions {
  connectionId: string;
}

interface UpdateProjectMcpPolicyOptions extends ConnectionProjectMcpOptions {
  request: Request;
}

interface McpOAuthCallbackOptions {
  projectId: string;
  request: Request;
  getParent(): Promise<ProjectMcpCallbackParent>;
}

interface GrantProjectToolAlwaysAllowOptions extends ProjectMcpOptions {
  conversationId: string;
  approvalId: string;
  request: Request;
}

interface RevokeProjectToolAlwaysAllowOptions extends ProjectMcpOptions {
  request: Request;
}

function errorResponse(
  error: string,
  status: 400 | 401 | 403 | 404 | 409 | 502,
): Response {
  return Response.json({ error }, { status });
}

async function authorizeProject(
  options: AuthorizedProjectOptions,
  mutation: boolean,
): Promise<Response | null> {
  const { actor } = options;
  if (!actor) return errorResponse("unauthorized", 401);
  if (
    actor.role === "member" &&
    !actor.accessAllProjects &&
    !actor.projectIds?.includes(options.projectId)
  ) {
    return errorResponse("not_found", 404);
  }
  const project = await options.projectService.getProjectById(options.projectId);
  if (!project || project.userId !== actor.effectiveUserId) {
    return errorResponse("not_found", 404);
  }
  if (mutation && actor.role === "member") {
    return errorResponse("forbidden", 403);
  }
  return null;
}

function safeAuthUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeDescriptor(tool: SidechatToolDescriptor): SidechatToolDescriptor {
  return {
    connectionId: tool.connectionId,
    toolName: tool.toolName,
    exposedName: tool.exposedName,
    displayName: tool.displayName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    catalogFingerprint: tool.catalogFingerprint,
    audience: "sidechat",
    safety: tool.safety ?? (tool.access === "read" ? "read" : "write"),
    access: tool.access,
    enabled: tool.enabled,
    alwaysAllowed: tool.alwaysAllowed === true,
  };
}

function safeConnection(connection: McpConnectionView): McpConnectionView {
  const authUrl = safeAuthUrl(connection.authUrl);
  const safeStates = new Set([
    "ready",
    "authenticating",
    "connecting",
    "connected",
    "discovering",
    "failed",
    "disconnected",
  ]);
  return {
    id: connection.id,
    name: connection.name,
    presetKey: connection.presetKey,
    url: connection.url,
    authMode: connection.authMode,
    state: safeStates.has(connection.state) ? connection.state : "failed",
    ...(authUrl ? { authUrl } : {}),
    ...(connection.issue === "tool_discovery_failed"
      ? { issue: connection.issue }
      : {}),
    tools: connection.tools.map(safeDescriptor),
  };
}

function validConnectionId(connectionId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/u.test(connectionId);
}

async function parseJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleGetProjectMcp(
  options: ProjectMcpOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, false);
  if (denied) return denied;

  try {
    const parent = await options.getParent();
    const connections = await parent.listMcpConnections();
    return Response.json({
      canManage: options.actor?.role !== "member",
      presets: listMcpPresets(),
      connections: connections.map(safeConnection),
    });
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleConnectProjectMcp(
  options: ConnectProjectMcpOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;

  const parsed = createProjectMcpConnectionSchema.safeParse(
    await parseJson(options.request),
  );
  if (!parsed.success) return errorResponse("invalid_request", 400);

  const preset = parsed.data.presetKey
    ? getMcpPreset(parsed.data.presetKey)
    : null;
  if (
    parsed.data.presetKey &&
    (!preset || !preset.auth.some((mode) => mode === parsed.data.authMode))
  ) {
    return errorResponse("unsupported_auth_mode", 400);
  }

  let url: string;
  try {
    url = validateMcpServerUrl(preset?.url ?? parsed.data.url ?? "");
  } catch {
    return errorResponse("invalid_mcp_url", 400);
  }

  let callbackHost: string;
  try {
    callbackHost = validateMcpCallbackHost(options.callbackHost);
  } catch {
    return errorResponse("invalid_callback_host", 502);
  }

  const input: ConnectProjectMcpInput = {
    name: preset?.label ?? parsed.data.name ?? "MCP server",
    presetKey: preset?.key ?? null,
    url,
    authMode: parsed.data.authMode,
    ...(parsed.data.bearerToken
      ? { bearerToken: parsed.data.bearerToken }
      : {}),
    ...(parsed.data.headers ? { headers: parsed.data.headers } : {}),
    callbackHost,
    callbackPath: `/api/sidechat/mcp/oauth/${encodeURIComponent(options.projectId)}`,
  };

  try {
    const parent = await options.getParent();
    const connection = await parent.connectMcp(input);
    return Response.json({ connection: safeConnection(connection) }, { status: 201 });
  } catch {
    return errorResponse("mcp_connection_failed", 502);
  }
}

export async function handleRefreshProjectMcp(
  options: ConnectionProjectMcpOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;
  if (!validConnectionId(options.connectionId)) {
    return errorResponse("invalid_connection", 400);
  }

  try {
    const parent = await options.getParent();
    const connection = await parent.refreshMcpCatalog(options.connectionId);
    return connection
      ? Response.json({ connection: safeConnection(connection) })
      : errorResponse("not_found", 404);
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleUpdateProjectMcpPolicy(
  options: UpdateProjectMcpPolicyOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;
  if (!validConnectionId(options.connectionId)) {
    return errorResponse("invalid_connection", 400);
  }
  const parsed = updateProjectMcpPolicySchema.safeParse(
    await parseJson(options.request),
  );
  if (!parsed.success) return errorResponse("invalid_request", 400);

  try {
    const parent = await options.getParent();
    const connection = await parent.updateMcpToolPolicy(
      options.connectionId,
      parsed.data.tools,
    );
    return connection
      ? Response.json({ connection: safeConnection(connection) })
      : errorResponse("not_found", 404);
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleDisconnectProjectMcp(
  options: ConnectionProjectMcpOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;
  if (!validConnectionId(options.connectionId)) {
    return errorResponse("invalid_connection", 400);
  }

  try {
    const parent = await options.getParent();
    const disconnected = await parent.disconnectMcp(options.connectionId);
    return disconnected
      ? new Response(null, { status: 204 })
      : errorResponse("not_found", 404);
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleGrantProjectToolAlwaysAllow(
  options: GrantProjectToolAlwaysAllowOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;
  if (
    !options.conversationId || options.conversationId.length > 200 ||
    !options.approvalId || options.approvalId.length > 200
  ) {
    return errorResponse("invalid_request", 400);
  }
  const parsed = grantSidechatAlwaysAllowSchema.safeParse(
    await parseJson(options.request),
  );
  if (!parsed.success) return errorResponse("invalid_request", 400);

  try {
    const parent = await options.getParent();
    const granted = await parent.grantAlwaysForPendingApproval(
      options.conversationId,
      options.actor!.userId,
      options.approvalId,
      parsed.data.toolCallId,
    );
    return granted
      ? new Response(null, { status: 204 })
      : errorResponse("approval_stale", 409);
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleRevokeProjectToolAlwaysAllow(
  options: RevokeProjectToolAlwaysAllowOptions,
): Promise<Response> {
  const denied = await authorizeProject(options, true);
  if (denied) return denied;
  const parsed = revokeSidechatAlwaysAllowSchema.safeParse(
    await parseJson(options.request),
  );
  if (!parsed.success) return errorResponse("invalid_request", 400);

  try {
    const parent = await options.getParent();
    const revoked = await parent.revokeAlwaysAllow(
      parsed.data.connectionId,
      parsed.data.toolName,
      parsed.data.catalogFingerprint,
    );
    return revoked
      ? new Response(null, { status: 204 })
      : errorResponse("not_found", 404);
  } catch {
    return errorResponse("mcp_unavailable", 502);
  }
}

export async function handleMcpOAuthCallback(
  options: McpOAuthCallbackOptions,
): Promise<Response> {
  if (!options.projectId || options.projectId.length > 100) {
    return errorResponse("not_found", 404);
  }
  try {
    const parent = await options.getParent();
    return await parent.fetch(options.request);
  } catch {
    return errorResponse("mcp_callback_failed", 502);
  }
}
