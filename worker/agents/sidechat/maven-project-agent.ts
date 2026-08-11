import { Agent, type Connection, type ConnectionContext } from "agents";
import { drizzle } from "drizzle-orm/d1";
import type {
  ExecuteProjectToolRequest,
  ExecuteProjectToolResult,
  MavenProjectState,
  SidechatCustomerContext,
  SidechatStatus,
  SidechatSummary,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import type { ToolRow } from "../../db";
import { buildCustomerByIdQuery } from "../../services/customer-service";
import { ChatService } from "../../services/chat-service";
import { ProjectService } from "../../services/project-service";
import { TeamService } from "../../services/team-service";
import { ToolService } from "../../services/tool-service";
import { type AppEnv } from "../../types";
import { createSearchKnowledgeTool } from "../../chat-runtime/tools/internal/search-knowledge";
import { executeHttpToolRequest } from "../../chat-runtime/tools/http-tool-executor";
import type { MavenTurnContext, SupportToolDefinition } from "../../chat-runtime/types";
import {
  authorizeSubAgentRequest,
  readVerifiedSidechatClaims,
  toSidechatChildName,
} from "./agent-auth";
import { MavenChatAgent } from "./maven-chat-agent";
import type {
  ConnectProjectMcpInput,
  McpConnectionView,
  ProjectMcpAuthMode,
  ProjectMcpPolicyInput,
} from "./mcp-types";
import { getMcpPreset, type McpPresetKey } from "./mcp-presets";
import {
  normalizeMcpCatalog,
  normalizeMcpToolResult,
  type DiscoveredMcpTool,
} from "./mcp-policy";
import { buildSidechatContext } from "./sidechat-context";
import {
  buildSidechatToolDescriptors,
  executeSidechatProjectTool,
  persistSidechatActionAudit,
} from "./project-tool-proxy";

interface McpConnectionMetadataRow {
  id: string;
  name: string;
  preset_key: string | null;
  url: string;
  auth_mode: string;
}

interface McpToolPolicyRow {
  connection_id: string;
  tool_name: string;
  exposed_name: string;
  display_name: string;
  description: string;
  input_schema: string;
  catalog_fingerprint: string;
  access: string;
  enabled: number;
}

interface NativeMcpServer {
  name: string;
  server_url: string;
  auth_url: string | null;
  state: string;
}

function readMcpAuthMode(value: string): ProjectMcpAuthMode | null {
  return value === "oauth" ||
    value === "bearer" ||
    value === "headers" ||
    value === "none"
    ? value
    : null;
}

function readMcpPresetKey(value: string | null): McpPresetKey | null {
  return value && getMcpPreset(value) ? (value as McpPresetKey) : null;
}

function parseMcpToolPolicy(row: McpToolPolicyRow): SidechatToolDescriptor | null {
  if (
    (row.access !== "read" && row.access !== "write") ||
    (row.enabled !== 0 && row.enabled !== 1)
  ) {
    return null;
  }
  try {
    const inputSchema = JSON.parse(row.input_schema) as unknown;
    if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
      return null;
    }
    return {
      connectionId: row.connection_id,
      toolName: row.tool_name,
      exposedName: row.exposed_name,
      displayName: row.display_name,
      description: row.description,
      inputSchema,
      catalogFingerprint: row.catalog_fingerprint,
      audience: "sidechat",
      access: row.access,
      enabled: row.enabled === 1,
    };
  } catch {
    return null;
  }
}

function upsertSidechatSummary(
  state: MavenProjectState,
  conversationId: string,
  childName: string,
  status: SidechatStatus,
  updatedAt = Date.now(),
): MavenProjectState {
  return {
    ...state,
    sidechats: {
      ...state.sidechats,
      [conversationId]: {
        conversationId,
        childName,
        status,
        updatedAt,
      },
    },
  };
}

export class MavenProjectAgent extends Agent<AppEnv, MavenProjectState> {
  initialState: MavenProjectState = { sidechats: {} };
  private readonly sidechatRegistrationLocks = new Map<string, Promise<void>>();
  private mcpOperationTail: Promise<void> = Promise.resolve();

  async registerSidechat(
    conversationId: string,
  ): Promise<{ childName: string; created: boolean }> {
    const previousRegistration =
      this.sidechatRegistrationLocks.get(conversationId) ?? Promise.resolve();
    let releaseRegistration = (): void => undefined;
    const registrationComplete = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const lock = previousRegistration.then(() => registrationComplete);
    this.sidechatRegistrationLocks.set(conversationId, lock);

    await previousRegistration;
    try {
      const childName = toSidechatChildName(conversationId);
      const created = !this.hasSubAgent(MavenChatAgent, childName);
      await this.subAgent(MavenChatAgent, childName);
      const existing = this.state.sidechats[conversationId];
      this.setState(
        upsertSidechatSummary(
          this.state,
          conversationId,
          childName,
          existing?.status ?? "idle",
        ),
      );
      return { childName, created };
    } finally {
      releaseRegistration();
      if (this.sidechatRegistrationLocks.get(conversationId) === lock) {
        this.sidechatRegistrationLocks.delete(conversationId);
      }
    }
  }

  async getSidechatRegistration(
    conversationId: string,
  ): Promise<{ childName: string } | null> {
    const childName = toSidechatChildName(conversationId);
    return this.hasSubAgent(MavenChatAgent, childName) ? { childName } : null;
  }

  async getSidechatSummaries(): Promise<SidechatSummary[]> {
    return Object.values(this.state.sidechats)
      .filter((summary) =>
        this.hasSubAgent(MavenChatAgent, summary.childName),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async updateSidechatSummary(
    conversationId: string,
    status: SidechatStatus,
  ): Promise<boolean> {
    const childName = toSidechatChildName(conversationId);
    if (!this.hasSubAgent(MavenChatAgent, childName)) return false;
    this.setState(
      upsertSidechatSummary(
        this.state,
        conversationId,
        childName,
        status,
      ),
    );
    return true;
  }

  async getSidechatContext(
    childName: string,
    conversationId: string,
  ): Promise<SidechatCustomerContext> {
    this.assertRegisteredSidechat(childName, conversationId);
    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    return buildSidechatContext({
      projectId: this.name,
      conversationId,
      dependencies: {
        getConversation(id, projectId) {
          return chatService.getConversationById(id, projectId);
        },
        async getCustomer(projectId, customerId) {
          const rows = await buildCustomerByIdQuery(
            db,
            projectId,
            customerId,
          );
          return rows[0] ?? null;
        },
        getRecentPublicMessages(id, limit) {
          return chatService.getRecentPublicMessages(id, limit);
        },
      },
    });
  }

  async getSidechatToolDescriptors(
    childName: string,
    conversationId: string,
  ): Promise<SidechatToolDescriptor[]> {
    this.assertRegisteredSidechat(childName, conversationId);
    const db = drizzle(this.env.DB);
    const toolService = new ToolService(db);
    const sidechatTools = await toolService.getEnabledToolsForChannel(
      this.name,
      "sidechat",
    );
    const [httpDescriptors, mcpConnections] = await Promise.all([
      buildSidechatToolDescriptors(this.name, sidechatTools),
      this.listMcpConnections(),
    ]);
    return [
      ...httpDescriptors,
      ...mcpConnections.flatMap((connection) => connection.tools),
    ];
  }

  async connectMcp(input: ConnectProjectMcpInput): Promise<McpConnectionView> {
    return this.runExclusiveMcpOperation(() => this.connectMcpUnlocked(input));
  }

  private async connectMcpUnlocked(
    input: ConnectProjectMcpInput,
  ): Promise<McpConnectionView> {
    this.ensureMcpApplicationSchema();
    const duplicate = this.readMcpConnectionMetadata().some(
      (connection) =>
        connection.name === input.name && connection.url === input.url,
    );
    if (duplicate) throw new Error("MCP connection already exists");

    const requestedId = `mcp-${crypto.randomUUID()}`;
    const headers = this.mcpTransportHeaders(input);
    const result = await this.addMcpServer(input.name, input.url, {
      id: requestedId,
      callbackHost: input.callbackHost,
      callbackPath: input.callbackPath,
      transport: {
        type: "streamable-http",
        ...(headers ? { headers } : {}),
      },
    });
    if (result.state === "authenticating" && input.authMode !== "oauth") {
      await this.removeMcpServer(result.id);
      throw new Error("Configured MCP credentials were rejected");
    }

    try {
      this.sql`
        INSERT INTO sidechat_mcp_connections (
          id, name, preset_key, url, auth_mode, created_at, updated_at
        ) VALUES (
          ${result.id}, ${input.name}, ${input.presetKey}, ${input.url},
          ${input.authMode}, ${Date.now()}, ${Date.now()}
        )
      `;
    } catch (error) {
      await this.removeMcpServer(result.id);
      throw error;
    }

    if (result.state === "ready") {
      await this.syncMcpCatalog(result.id);
    }
    const connection = this.buildMcpConnectionView(
      result.id,
      result.state === "authenticating" ? result.authUrl : undefined,
    );
    if (!connection) throw new Error("MCP connection metadata unavailable");
    return connection;
  }

  async listMcpConnections(): Promise<McpConnectionView[]> {
    return this.runExclusiveMcpOperation(() => this.listMcpConnectionsUnlocked());
  }

  private async listMcpConnectionsUnlocked(): Promise<McpConnectionView[]> {
    this.ensureMcpApplicationSchema();
    await this.mcp.waitForConnections({ timeout: 10_000 });
    const nativeState = this.getMcpServers();
    for (const connection of this.readMcpConnectionMetadata()) {
      if (nativeState.servers[connection.id]?.state === "ready") {
        await this.syncMcpCatalog(connection.id);
      }
    }
    return this.readMcpConnectionMetadata()
      .map((connection) => this.buildMcpConnectionView(connection.id))
      .filter((connection): connection is McpConnectionView => connection !== null);
  }

  async refreshMcpCatalog(
    connectionId: string,
  ): Promise<McpConnectionView | null> {
    return this.runExclusiveMcpOperation(() =>
      this.refreshMcpCatalogUnlocked(connectionId),
    );
  }

  private async refreshMcpCatalogUnlocked(
    connectionId: string,
  ): Promise<McpConnectionView | null> {
    this.ensureMcpApplicationSchema();
    if (!this.readMcpConnectionMetadata(connectionId)) return null;
    await this.mcp.waitForConnections({ timeout: 10_000 });
    const server = this.getMcpServers().servers[connectionId];
    if (!server) return this.buildMcpConnectionView(connectionId);
    if (server.state === "connected" || server.state === "ready") {
      await this.mcp.discoverIfConnected(connectionId, { timeoutMs: 30_000 });
    }
    if (this.getMcpServers().servers[connectionId]?.state === "ready") {
      await this.syncMcpCatalog(connectionId);
    }
    return this.buildMcpConnectionView(connectionId);
  }

  async updateMcpToolPolicy(
    connectionId: string,
    updates: ProjectMcpPolicyInput[],
  ): Promise<McpConnectionView | null> {
    return this.runExclusiveMcpOperation(() =>
      this.updateMcpToolPolicyUnlocked(connectionId, updates),
    );
  }

  private async updateMcpToolPolicyUnlocked(
    connectionId: string,
    updates: ProjectMcpPolicyInput[],
  ): Promise<McpConnectionView | null> {
    this.ensureMcpApplicationSchema();
    if (!this.readMcpConnectionMetadata(connectionId)) return null;
    const policies = this.readMcpToolPolicies(connectionId);
    const policiesByName = new Map(
      policies.map((policy) => [policy.toolName, policy] as const),
    );
    const seen = new Set<string>();
    for (const update of updates) {
      if (seen.has(update.toolName)) {
        throw new Error("Duplicate MCP tool policy");
      }
      seen.add(update.toolName);
      const current = policiesByName.get(update.toolName);
      if (
        !current ||
        current.catalogFingerprint !== update.catalogFingerprint
      ) {
        throw new Error("MCP catalog changed");
      }
    }
    for (const update of updates) {
      this.sql`
        UPDATE sidechat_mcp_tool_policy
        SET enabled = ${update.enabled ? 1 : 0}, access = ${update.access},
            updated_at = ${Date.now()}
        WHERE connection_id = ${connectionId}
          AND tool_name = ${update.toolName}
          AND catalog_fingerprint = ${update.catalogFingerprint}
      `;
    }
    return this.buildMcpConnectionView(connectionId);
  }

  async disconnectMcp(connectionId: string): Promise<boolean> {
    return this.runExclusiveMcpOperation(() =>
      this.disconnectMcpUnlocked(connectionId),
    );
  }

  private async disconnectMcpUnlocked(connectionId: string): Promise<boolean> {
    this.ensureMcpApplicationSchema();
    if (!this.readMcpConnectionMetadata(connectionId)) return false;
    await this.removeMcpServer(connectionId);
    this.sql`
      DELETE FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
    `;
    this.sql`
      DELETE FROM sidechat_mcp_connections
      WHERE id = ${connectionId}
    `;
    return true;
  }

  async executeProjectTool(
    request: ExecuteProjectToolRequest,
  ): Promise<ExecuteProjectToolResult> {
    const db = drizzle(this.env.DB);
    const chatService = new ChatService(db);
    const toolService = new ToolService(db);
    return executeSidechatProjectTool({
      projectId: this.name,
      request,
      dependencies: {
        isRegisteredSidechat: (childName, conversationId) => {
          try {
            this.assertRegisteredSidechat(childName, conversationId);
            return true;
          } catch {
            return false;
          }
        },
        getConversation: () =>
          chatService.getConversationById(
            request.conversationId,
            this.name,
          ),
        canActorAccessProject: (actorUserId) =>
          this.canActorAccessProject(db, actorUserId),
        getAuthoritativeHttpTool: (toolId) =>
          toolService.getAuthoritativeTool(this.name, toolId),
        getAuthoritativeMcpTool: (connectionId, toolName) =>
          this.getMcpToolPolicy(connectionId, toolName),
        runKnowledgeSearch: async (input) => {
          const conversation = await chatService.getConversationById(
            request.conversationId,
            this.name,
          );
          if (!conversation || conversation.archivedAt !== null) {
            return { found: false, context: "", sources: [], topScore: 0 };
          }
          const context: MavenTurnContext = {
            channel: "sidechat",
            projectId: this.name,
            conversationId: request.conversationId,
            actorUserId: request.actorUserId,
            customerId: conversation.customerId,
            ownership: {
              status: conversation.status,
              chatState: conversation.chatState,
            },
          };
          const definition = createSearchKnowledgeTool({
            env: this.env,
            db,
            context,
            collectSources() {
              // Native private tool results already carry bounded safe sources.
            },
          });
          return definition.execute(input, {});
        },
        runExternalAction: (action) =>
          chatService.runExternalActionIfOperational(
            request.conversationId,
            this.name,
            action,
          ),
        executeHttpTool: async (tool, input) =>
          executeHttpToolRequest(
            {
              tool: this.toHttpExecutionDefinition(tool),
              params: input as Record<string, unknown>,
              encryptionKey: this.env.ENCRYPTION_KEY,
            },
            {},
          ),
        executeMcpTool: (connectionId, toolName, input) =>
          this.executeNativeMcpTool(connectionId, toolName, input),
        writeAudit: (metadata) => this.writeSidechatActionAudit(metadata),
      },
    });
  }

  private ensureMcpApplicationSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS sidechat_mcp_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        preset_key TEXT,
        url TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS sidechat_mcp_tool_policy (
        connection_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        exposed_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        catalog_fingerprint TEXT NOT NULL,
        access TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        catalog_present INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (connection_id, tool_name)
      )
    `;
  }

  private async runExclusiveMcpOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mcpOperationTail ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.mcpOperationTail = tail;
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mcpOperationTail === tail) {
        this.mcpOperationTail = Promise.resolve();
      }
    }
  }

  private readMcpConnectionMetadata(): McpConnectionMetadataRow[];
  private readMcpConnectionMetadata(
    connectionId: string,
  ): McpConnectionMetadataRow | null;
  private readMcpConnectionMetadata(
    connectionId?: string,
  ): McpConnectionMetadataRow[] | McpConnectionMetadataRow | null {
    const rows = connectionId
      ? this.sql<McpConnectionMetadataRow>`
          SELECT id, name, preset_key, url, auth_mode
          FROM sidechat_mcp_connections
          WHERE id = ${connectionId}
          LIMIT 1
        `
      : this.sql<McpConnectionMetadataRow>`
          SELECT id, name, preset_key, url, auth_mode
          FROM sidechat_mcp_connections
          ORDER BY created_at ASC, id ASC
        `;
    return connectionId ? rows[0] ?? null : rows;
  }

  private readMcpToolPolicies(
    connectionId: string,
  ): SidechatToolDescriptor[] {
    return this.sql<McpToolPolicyRow>`
      SELECT connection_id, tool_name, exposed_name, display_name,
             description, input_schema, catalog_fingerprint, access, enabled
      FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND catalog_present = 1
      ORDER BY tool_name ASC
    `
      .map(parseMcpToolPolicy)
      .filter((tool): tool is SidechatToolDescriptor => tool !== null);
  }

  private getMcpToolPolicy(
    connectionId: string,
    toolName: string,
  ): SidechatToolDescriptor | null {
    this.ensureMcpApplicationSchema();
    const rows = this.sql<McpToolPolicyRow>`
      SELECT connection_id, tool_name, exposed_name, display_name,
             description, input_schema, catalog_fingerprint, access, enabled
      FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND tool_name = ${toolName}
        AND catalog_present = 1
      LIMIT 1
    `;
    return rows[0] ? parseMcpToolPolicy(rows[0]) : null;
  }

  private mcpTransportHeaders(
    input: ConnectProjectMcpInput,
  ): Record<string, string> | undefined {
    if (input.authMode === "bearer" && input.bearerToken) {
      return { Authorization: `Bearer ${input.bearerToken}` };
    }
    return input.authMode === "headers" ? input.headers : undefined;
  }

  private async syncMcpCatalog(connectionId: string): Promise<void> {
    const discovered = this.mcp.listTools({ serverId: connectionId }).map(
      (tool) =>
        ({
          serverId: tool.serverId,
          name: tool.name,
          ...(tool.title ? { title: tool.title } : {}),
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        }) as DiscoveredMcpTool,
    );
    const normalized = await normalizeMcpCatalog(
      connectionId,
      discovered,
      this.readMcpToolPolicies(connectionId),
    );
    this.sql`
      UPDATE sidechat_mcp_tool_policy
      SET catalog_present = 0, updated_at = ${Date.now()}
      WHERE connection_id = ${connectionId}
    `;
    for (const tool of normalized) {
      this.sql`
        INSERT INTO sidechat_mcp_tool_policy (
          connection_id, tool_name, exposed_name, display_name, description,
          input_schema, catalog_fingerprint, access, enabled,
          catalog_present, updated_at
        ) VALUES (
          ${tool.connectionId}, ${tool.toolName}, ${tool.exposedName},
          ${tool.displayName}, ${tool.description},
          ${JSON.stringify(tool.inputSchema)}, ${tool.catalogFingerprint},
          ${tool.access}, ${tool.enabled ? 1 : 0}, 1, ${Date.now()}
        )
        ON CONFLICT (connection_id, tool_name) DO UPDATE SET
          exposed_name = excluded.exposed_name,
          display_name = excluded.display_name,
          description = excluded.description,
          input_schema = excluded.input_schema,
          catalog_fingerprint = excluded.catalog_fingerprint,
          access = excluded.access,
          enabled = excluded.enabled,
          catalog_present = 1,
          updated_at = excluded.updated_at
      `;
    }
    this.sql`
      DELETE FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND catalog_present = 0
    `;
  }

  private buildMcpConnectionView(
    connectionId: string,
    authUrl?: string,
  ): McpConnectionView | null {
    const metadata = this.readMcpConnectionMetadata(connectionId);
    const authMode = metadata ? readMcpAuthMode(metadata.auth_mode) : null;
    if (!metadata || !authMode) return null;
    const native = this.getMcpServers().servers[connectionId] as
      | NativeMcpServer
      | undefined;
    return {
      id: metadata.id,
      name: metadata.name,
      presetKey: readMcpPresetKey(metadata.preset_key),
      url: metadata.url,
      authMode,
      state: native?.state ?? "disconnected",
      ...(authUrl || native?.auth_url
        ? { authUrl: authUrl ?? native?.auth_url ?? undefined }
        : {}),
      tools: this.readMcpToolPolicies(connectionId),
    };
  }

  private async executeNativeMcpTool(
    connectionId: string,
    toolName: string,
    input: unknown,
  ): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { error: "invalid_tool_input" };
    }
    await this.mcp.waitForConnections({ timeout: 10_000 });
    const result = await this.mcp.callTool({
      serverId: connectionId,
      name: toolName,
      arguments: input as Record<string, unknown>,
    });
    return result.isError
      ? { error: "mcp_tool_failed" }
      : normalizeMcpToolResult(result);
  }

  private async canActorAccessProject(
    db: ReturnType<typeof drizzle>,
    actorUserId: string,
  ): Promise<boolean> {
    const project = await new ProjectService(db).getProjectById(this.name);
    if (!project) return false;
    if (project.userId === actorUserId) return true;
    const teamService = new TeamService(db);
    const membership = await teamService.getMembershipForOwner(
      actorUserId,
      project.userId,
    );
    if (!membership) return false;
    return (
      membership.role === "admin" ||
      membership.accessAllProjects ||
      await teamService.memberHasProjectAccess(membership.id, this.name)
    );
  }

  private toHttpExecutionDefinition(tool: ToolRow): SupportToolDefinition {
    return {
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      headers: tool.headers,
      parameters: tool.parameters,
      responseMapping: tool.responseMapping,
      enabled: tool.enabled,
      timeout: tool.timeout,
    };
  }

  private writeSidechatActionAudit(
    metadata: SidechatToolAuditMetadata,
  ): void {
    persistSidechatActionAudit(this.sql.bind(this), metadata);
  }

  private assertRegisteredSidechat(
    childName: string,
    conversationId: string,
  ): void {
    const expectedChildName = toSidechatChildName(conversationId);
    const summary = this.state.sidechats[conversationId];
    if (
      childName !== expectedChildName ||
      summary?.childName !== childName ||
      !this.hasSubAgent(MavenChatAgent, childName)
    ) {
      throw new Error("Sidechat is not registered");
    }
  }

  override shouldConnectionBeReadonly(): boolean {
    return true;
  }

  override async onConnect(
    connection: Connection,
    context: ConnectionContext,
  ): Promise<void> {
    const claims = readVerifiedSidechatClaims(context.request);
    if (!claims || claims.scope !== "parent" || claims.parentName !== this.name) {
      throw new Error("Unauthorized Sidechat parent connection");
    }
    await super.onConnect(connection, context);
    connection.setState({ sidechatActor: claims });
  }

  override async onBeforeSubAgent(
    request: Request,
    child: { className: string; name: string },
  ): Promise<Request | Response | void> {
    if (
      child.className !== MavenChatAgent.name ||
      !this.hasSubAgent(MavenChatAgent, child.name)
    ) {
      return new Response("Not found", { status: 404 });
    }
    return authorizeSubAgentRequest(
      request,
      this.name,
      child.name,
      this.env.SIDECHAT_TOKEN_SECRET,
    );
  }
}

export { upsertSidechatSummary };
