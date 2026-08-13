import {
  Agent,
  type AgentMcpOAuthProvider,
  type Connection,
  type ConnectionContext,
} from "agents";
import { drizzle } from "drizzle-orm/d1";
import type {
  ExecuteProjectToolRequest,
  ExecuteProjectToolResult,
  MavenConversationDashboardPage,
  MavenConversationListQuery,
  MavenConversationListResult,
  MavenConversationSummary,
  MavenInboxCounts,
  MavenProjectState,
  MavenProjectEvent,
  PendingSidechatApprovalScope,
  SidechatCustomerContext,
  SidechatStatus,
  SidechatSummary,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import {
  toPublicChildName,
  toSidechatChildName,
} from "../../../shared/maven-conversation";
import type { ToolRow } from "../../db";
import { buildCustomerByIdQuery } from "../../services/customer-service";
import { createPublicConversationStore } from "../../conversations/create-public-conversation-store";
import type {
  PublicBulkConversationActionResult,
  PublicConversationAction,
  PublicConversationStore,
  PublicRetentionClaim,
} from "../../conversations/public-conversation-store";
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
} from "../sidechat/agent-auth";
import {
  authorizePublicSubAgentRequest,
  readVerifiedPublicChatClaims,
} from "./public/public-agent-auth";
import { MavenChatAgent } from "./maven-chat-agent";
import type {
  ConnectProjectMcpInput,
  McpConnectionView,
  ProjectMcpAuthMode,
  ProjectMcpPolicyInput,
} from "../sidechat/mcp-types";
import { getMcpPreset, type McpPresetKey } from "../sidechat/mcp-presets";
import {
  normalizeMcpCatalog,
  normalizeMcpToolResult,
  type DiscoveredMcpTool,
  validateMcpServerUrl,
} from "../sidechat/mcp-policy";
import { ReadOnlyMcpOAuthClientProvider } from "../sidechat/mcp-oauth-provider";
import { buildSidechatContext } from "../sidechat/sidechat-context";
import {
  buildSidechatToolDescriptors,
  executeSidechatProjectTool,
  persistSidechatActionAudit,
} from "../sidechat/project-tool-proxy";
import {
  ConversationDirectory,
  type ConversationDirectorySql,
} from "./conversation-directory";

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
  safety: string | null;
  access: string;
  enabled: number;
}

interface AlwaysAllowGrantRow {
  connection_id: string;
  tool_name: string;
  catalog_fingerprint: string;
  access: string;
}

interface NativeMcpServer {
  name: string;
  server_url: string;
  auth_url: string | null;
  state: string;
}

type AddMcpServerResult =
  | { id: string; state: "authenticating"; authUrl: string }
  | { id: string; state: "ready" };

const MCP_TOOL_TIMEOUT_MS = 30_000;

async function runWithExternalActionLease<T>(
  conversationStore: PublicConversationStore,
  projectId: string,
  conversationId: string,
  action: () => Promise<T>,
): Promise<{ executed: boolean; value?: T }> {
  const lease = await conversationStore.acquireExternalAction({
    projectId,
    conversationId,
  });
  if (!lease) return { executed: false };
  try {
    return { executed: true, value: await action() };
  } finally {
    await conversationStore.releaseExternalAction(lease);
  }
}

function sameMcpServerUrl(left: string, right: string): boolean {
  try {
    return validateMcpServerUrl(left) === validateMcpServerUrl(right);
  } catch {
    return false;
  }
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
  const safety = row.safety === "read" ||
      row.safety === "write" ||
      row.safety === "destructive"
    ? row.safety
    : row.access === "read"
      ? "read"
      : "write";
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
      safety,
      access: row.access,
      enabled: row.enabled === 1,
    };
  } catch {
    return null;
  }
}

export class MavenProjectAgent extends Agent<AppEnv, MavenProjectState> {
  initialState: MavenProjectState = { sidechats: {} };
  private readonly sidechatRegistrationLocks = new Map<string, Promise<void>>();
  private directory?: ConversationDirectory;
  private readOnlyMcpOAuthConnections?: Set<string> = new Set<string>();
  private mcpOperationTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.mcp.configureOAuthCallback({
      successRedirect:
        `/app/projects/${encodeURIComponent(this.name)}/quick-actions?tab=tools`,
    });
  }

  createMcpOAuthProvider(callbackUrl: string): AgentMcpOAuthProvider {
    return new ReadOnlyMcpOAuthClientProvider(
      this.ctx.storage,
      "ReplyMaven",
      callbackUrl,
      (serverId) => this.readOnlyMcpOAuthConnectionIds().has(serverId),
    );
  }

  private readOnlyMcpOAuthConnectionIds(): Set<string> {
    this.readOnlyMcpOAuthConnections ??= new Set<string>();
    return this.readOnlyMcpOAuthConnections;
  }

  private conversationDirectory(): ConversationDirectory {
    if (this.directory) return this.directory;
    const durableSql = this.ctx.storage.sql;
    const adapter: ConversationDirectorySql = {
      execute<T>(query: string, bindings: Array<string | number | null>): T[] {
        return durableSql.exec(query, ...bindings).toArray() as T[];
      },
    };
    this.directory = new ConversationDirectory(adapter);
    const legacySidechats = Object.values(this.state.sidechats);
    for (const summary of legacySidechats) {
      const existing = this.directory.getConversation(summary.conversationId);
      if (existing?.sidechatChildName) continue;
      this.directory.updateSidechatSummary(
        summary.conversationId,
        summary.childName as `sc_${string}`,
        summary.status,
        summary.updatedAt,
      );
    }
    if (legacySidechats.length > 0) {
      this.setState({ sidechats: {} });
    }
    return this.directory;
  }

  async listConversations(
    query: MavenConversationListQuery,
  ): Promise<MavenConversationListResult> {
    return this.conversationDirectory().listConversations(query);
  }

  async getDashboardConversationPage(
    query: MavenConversationListQuery,
  ): Promise<MavenConversationDashboardPage> {
    const page = this.conversationDirectory().listConversations(query);
    return {
      ...page,
      counts: this.conversationDirectory().getInboxCounts(query.now),
    };
  }

  async getInboxCounts(now = Date.now()): Promise<MavenInboxCounts> {
    return this.conversationDirectory().getInboxCounts(now);
  }

  async getConversationSummary(
    conversationId: string,
  ): Promise<MavenConversationSummary | null> {
    return this.conversationDirectory().getConversation(conversationId);
  }

  async findConversationByTelegramThreadId(
    telegramThreadId: string,
  ): Promise<MavenConversationSummary | null> {
    return this.conversationDirectory().findByTelegramThreadId(
      telegramThreadId,
    );
  }

  async upsertConversationSummary(
    summary: MavenConversationSummary,
  ): Promise<{ applied: boolean; revision: number }> {
    const result = this.conversationDirectory().upsertConversationSummary(
      summary,
    );
    if (result.applied) {
      const inboxCounts = this.conversationDirectory().getInboxCounts();
      this.setState({
        sidechats: {},
        conversation: summary,
        inboxCounts,
      });
      this.broadcastProjectEvent({ type: "conversation-summary", summary });
      this.broadcastProjectEvent({ type: "inbox-counts", counts: inboxCounts });
    }
    return result;
  }

  async reconcileConversationSummary(
    summary: MavenConversationSummary,
  ): Promise<{ applied: boolean; revision: number }> {
    return this.upsertConversationSummary(summary);
  }

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
      const existing = this.conversationDirectory().getConversation(
        conversationId,
      );
      const status = existing?.sidechatStatus ?? "idle";
      const updatedAt = Date.now();
      this.conversationDirectory().updateSidechatSummary(
        conversationId,
        childName,
        status,
        updatedAt,
      );
      this.setState({
        sidechats: {
          [conversationId]: {
            conversationId,
            childName,
            status,
            updatedAt,
          },
        },
      });
      return { childName, created };
    } finally {
      releaseRegistration();
      if (this.sidechatRegistrationLocks.get(conversationId) === lock) {
        this.sidechatRegistrationLocks.delete(conversationId);
      }
    }
  }

  async registerPublicConversation(
    conversationId: string,
  ): Promise<{ childName: `pub_${string}`; created: boolean }> {
    const childName = toPublicChildName(conversationId);
    const created = !this.hasSubAgent(MavenChatAgent, childName);
    await this.subAgent(MavenChatAgent, childName);
    return { childName, created };
  }

  async closePublicConversationsAsSpam(input: {
    visitorId: string;
    visitorEmail?: string | null;
  }): Promise<string[]> {
    const matches = this.conversationDirectory().listOpenByVisitor(
      input.visitorId,
      input.visitorEmail,
    );
    const closedIds: string[] = [];
    for (let offset = 0; offset < matches.length; offset += 25) {
      const batch = matches.slice(offset, offset + 25);
      const results = await Promise.all(batch.map(async (summary) => {
        const child = await this.subAgent(
          MavenChatAgent,
          summary.publicChildName,
        );
        const updated = await child.applyConversationAction({
          action: "flag_spam",
        });
        return updated ? summary.conversationId : null;
      }));
      closedIds.push(...results.filter((id): id is string => id !== null));
    }
    return closedIds;
  }

  async listAllPublicConversationSummaries(): Promise<
    MavenConversationSummary[]
  > {
    return this.conversationDirectory().listAll();
  }

  async bulkApplyPublicActions(input: {
    conversationIds: string[];
    action: PublicConversationAction;
  }): Promise<PublicBulkConversationActionResult> {
    const uniqueIds = [...new Set(input.conversationIds)];
    const updatedIds: string[] = [];
    const skippedIds: string[] = [];
    for (let offset = 0; offset < uniqueIds.length; offset += 25) {
      const batch = uniqueIds.slice(offset, offset + 25);
      const results = await Promise.all(batch.map(async (conversationId) => {
        const summary = this.conversationDirectory().getConversation(
          conversationId,
        );
        if (!summary || summary.visitorId === "") return false;
        const child = await this.subAgent(
          MavenChatAgent,
          summary.publicChildName,
        );
        return await child.applyConversationAction(input.action) !== null;
      }));
      results.forEach((updated, index) => {
        (updated ? updatedIds : skippedIds).push(batch[index]!);
      });
    }
    return { updatedIds, skippedIds };
  }

  async reconcilePublicAutoCloseSchedules(
    autoCloseMinutes: number | null,
  ): Promise<void> {
    const summaries = this.conversationDirectory().listAll().filter(
      (summary) => summary.archivedAt === null && summary.status !== "closed",
    );
    for (let offset = 0; offset < summaries.length; offset += 25) {
      await Promise.all(summaries.slice(offset, offset + 25).map(
        async (summary) => {
          const child = await this.subAgent(
            MavenChatAgent,
            summary.publicChildName,
          );
          await child.reconcilePublicAutoClose(autoCloseMinutes);
        },
      ));
    }
  }

  async claimExpiredPublicArchives(input: {
    retentionCutoff: number;
    staleClaimCutoff: number;
    claimAt: number;
    limit: number;
  }): Promise<PublicRetentionClaim[]> {
    const candidates = this.conversationDirectory()
      .listExpiredArchiveCandidates(
        input.retentionCutoff,
        input.staleClaimCutoff,
        input.limit,
      );
    const claimed: PublicRetentionClaim[] = [];
    for (const summary of candidates) {
      const child = await this.subAgent(
        MavenChatAgent,
        summary.publicChildName,
      );
      if (await child.claimPublicRetention(input)) {
        claimed.push({
          id: summary.conversationId,
          projectId: this.name,
          purgeStartedAt: input.claimAt,
        });
      }
    }
    return claimed;
  }

  async hasPublicUploadKeyElsewhere(input: {
    key: string;
    excludedConversationId: string;
  }): Promise<boolean> {
    for (const summary of this.conversationDirectory().listAll()) {
      if (summary.conversationId === input.excludedConversationId) continue;
      const child = await this.subAgent(
        MavenChatAgent,
        summary.publicChildName,
      );
      if (await child.hasPublicUploadKey(input.key)) return true;
    }
    return false;
  }

  async deleteClaimedPublicConversation(input: {
    conversationId: string;
    purgeStartedAt: number;
  }): Promise<boolean> {
    const summary = this.conversationDirectory().getConversation(
      input.conversationId,
    );
    if (!summary || summary.visitorId === "") return false;
    const child = await this.subAgent(
      MavenChatAgent,
      summary.publicChildName,
    );
    if (!await child.matchesPublicRetentionClaim(input.purgeStartedAt)) {
      return false;
    }
    await this.deleteSubAgent(MavenChatAgent, summary.publicChildName);
    const removed = this.conversationDirectory().removeConversation(
      input.conversationId,
    );
    if (removed) {
      const inboxCounts = this.conversationDirectory().getInboxCounts();
      this.setState({
        sidechats: {},
        inboxCounts,
      });
      this.broadcastProjectEvent({ type: "inbox-counts", counts: inboxCounts });
    }
    return removed;
  }

  async getSidechatRegistration(
    conversationId: string,
  ): Promise<{ childName: string } | null> {
    const childName = toSidechatChildName(conversationId);
    const summary = this.conversationDirectory().getConversation(
      conversationId,
    );
    return summary?.sidechatChildName === childName &&
        this.hasSubAgent(MavenChatAgent, childName)
      ? { childName }
      : null;
  }

  async destroySidechat(conversationId: string): Promise<void> {
    const childName = toSidechatChildName(conversationId);
    if (this.hasSubAgent(MavenChatAgent, childName)) {
      await this.deleteSubAgent(MavenChatAgent, childName);
    }
    this.conversationDirectory().removeSidechat(conversationId);
    this.setState({ sidechats: {} });
  }

  async destroyProjectData(): Promise<void> {
    for (const child of this.listSubAgents(MavenChatAgent)) {
      await this.deleteSubAgent(MavenChatAgent, child.name);
    }
    for (const serverId of Object.keys(this.getMcpServers().servers)) {
      await this.removeMcpServer(serverId);
    }
    await this.destroy();
  }

  async getSidechatSummaries(): Promise<SidechatSummary[]> {
    return this.conversationDirectory().getSidechatSummaries()
      .filter((summary) =>
        this.hasSubAgent(MavenChatAgent, summary.childName),
      );
  }

  async updateSidechatSummary(
    conversationId: string,
    status: SidechatStatus,
  ): Promise<boolean> {
    const childName = toSidechatChildName(conversationId);
    if (!this.hasSubAgent(MavenChatAgent, childName)) return false;
    const updatedAt = Date.now();
    this.conversationDirectory().updateSidechatSummary(
      conversationId,
      childName,
      status,
      updatedAt,
    );
    this.setState({
      sidechats: {
        [conversationId]: {
          conversationId,
          childName,
          status,
          updatedAt,
        },
      },
    });
    return true;
  }

  async isSidechatOperational(
    childName: string,
    conversationId: string,
  ): Promise<boolean> {
    try {
      this.assertRegisteredSidechat(childName, conversationId);
    } catch {
      return false;
    }
    const db = drizzle(this.env.DB);
    const conversationStore = createPublicConversationStore({
      db,
      env: this.env,
    });
    const conversation = await conversationStore.get(
      this.name,
      conversationId,
    );
    return conversation?.archivedAt === null;
  }

  async enforceSidechatArchive(conversationId: string): Promise<void> {
    const childName = toSidechatChildName(conversationId);
    if (!this.hasSubAgent(MavenChatAgent, childName)) return;
    const child = await this.subAgent(MavenChatAgent, childName);
    await child.enforceArchive();
  }

  async getSidechatContext(
    childName: string,
    conversationId: string,
  ): Promise<SidechatCustomerContext> {
    this.assertRegisteredSidechat(childName, conversationId);
    const db = drizzle(this.env.DB);
    const conversationStore = createPublicConversationStore({
      db,
      env: this.env,
    });
    return buildSidechatContext({
      projectId: this.name,
      conversationId,
      dependencies: {
        getConversation(id, projectId) {
          return conversationStore.get(projectId, id);
        },
        async getCustomer(projectId, customerId) {
          const rows = await buildCustomerByIdQuery(
            db,
            projectId,
            customerId,
          );
          return rows[0] ?? null;
        },
        getRecentPublicMessages(projectId, id, limit) {
          return conversationStore.getRecentMessages(projectId, id, limit);
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
    this.ensureMcpApplicationSchema();
    return [
      ...httpDescriptors,
      ...mcpConnections.flatMap((connection) => connection.tools),
    ].map((descriptor) => this.withAlwaysAllowState(descriptor));
  }

  async grantAlwaysForPendingApproval(
    conversationId: string,
    actorUserId: string,
    approvalId: string,
    toolCallId: string,
  ): Promise<boolean> {
    const childName = toSidechatChildName(conversationId);
    this.assertRegisteredSidechat(childName, conversationId);
    const db = drizzle(this.env.DB);
    const conversationStore = createPublicConversationStore({
      db,
      env: this.env,
    });
    const [conversation, actorAllowed] = await Promise.all([
      conversationStore.get(this.name, conversationId),
      this.canActorAccessProject(db, actorUserId),
    ]);
    if (!conversation || conversation.archivedAt !== null || !actorAllowed) {
      return false;
    }
    const child = await this.subAgent(MavenChatAgent, childName);
    const pending = await child.getPendingApprovalScope(
      approvalId,
      toolCallId,
    ) as PendingSidechatApprovalScope | null;
    if (!pending) return false;
    const descriptor = (await this.getSidechatToolDescriptors(
      childName,
      conversationId,
    )).find((candidate) => candidate.exposedName === pending.exposedName);
    if (!descriptor || descriptor.access !== "write" || !descriptor.enabled) {
      return false;
    }
    const latestConversation = await conversationStore.get(
      this.name,
      conversationId,
    );
    if (!latestConversation || latestConversation.archivedAt !== null) {
      return false;
    }
    this.ensureMcpApplicationSchema();
    void this.sql`
      INSERT INTO sidechat_always_allow_grants (
        connection_id, tool_name, catalog_fingerprint, access,
        granted_by, created_at
      ) VALUES (
        ${descriptor.connectionId}, ${descriptor.toolName},
        ${descriptor.catalogFingerprint}, ${descriptor.access},
        ${actorUserId}, ${Date.now()}
      )
      ON CONFLICT (connection_id, tool_name) DO UPDATE SET
        catalog_fingerprint = excluded.catalog_fingerprint,
        access = excluded.access,
        granted_by = excluded.granted_by,
        created_at = excluded.created_at
    `;
    return true;
  }

  async revokeAlwaysAllow(
    connectionId: string,
    toolName: string,
    catalogFingerprint: string,
  ): Promise<boolean> {
    this.ensureMcpApplicationSchema();
    const removed = this.sql<{ connection_id: string }>`
      DELETE FROM sidechat_always_allow_grants
      WHERE connection_id = ${connectionId}
        AND tool_name = ${toolName}
        AND catalog_fingerprint = ${catalogFingerprint}
      RETURNING connection_id
    `;
    return removed.length === 1;
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
    const preset = input.presetKey ? getMcpPreset(input.presetKey) : null;
    if (preset?.readOnly) {
      this.readOnlyMcpOAuthConnectionIds().add(requestedId);
    }
    const headers = this.mcpTransportHeaders(input);
    let result: AddMcpServerResult;
    try {
      result = await this.addMcpServer(input.name, input.url, {
        id: requestedId,
        callbackHost: input.callbackHost,
        callbackPath: input.callbackPath,
        transport: {
          type: "auto",
          ...(headers ? { headers } : {}),
        },
      });
    } catch (error) {
      await this.removeMcpServer(requestedId).catch(() => undefined);
      throw error;
    } finally {
      this.readOnlyMcpOAuthConnectionIds().delete(requestedId);
    }
    if (result.state === "authenticating" && input.authMode !== "oauth") {
      await this.removeMcpServer(result.id);
      throw new Error("Configured MCP credentials were rejected");
    }

    try {
      void this.sql`
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
    for (const connection of this.readMcpConnectionMetadata()) {
      const preset = connection.preset_key
        ? getMcpPreset(connection.preset_key)
        : null;
      if (preset && !sameMcpServerUrl(connection.url, preset.url)) {
        await this.disconnectMcpUnlocked(connection.id);
        continue;
      }
      await this.reconcileMcpCatalog(connection.id, false);
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
    await this.reconcileMcpCatalog(connectionId, true);
    return this.buildMcpConnectionView(connectionId);
  }

  private async reconcileMcpCatalog(
    connectionId: string,
    refreshReadyCatalog: boolean,
  ): Promise<void> {
    const server = this.getMcpServers().servers[connectionId];
    const safetyNeedsSync = this.sql<{ pending: number }>`
      SELECT 1 AS pending
      FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND catalog_present = 1
        AND safety IS NULL
      LIMIT 1
    `.length > 0;
    if (
      server?.state === "connected" ||
      ((refreshReadyCatalog || safetyNeedsSync) && server?.state === "ready")
    ) {
      try {
        await this.mcp.discoverIfConnected(connectionId, {
          timeoutMs: 30_000,
        });
      } catch {
        // The safe connection view below reports the discovery issue without
        // exposing provider errors or failing the entire project catalog.
      }
    }
    if (this.getMcpServers().servers[connectionId]?.state === "ready") {
      await this.syncMcpCatalog(connectionId);
    }
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
      if (current.safety !== "read" && update.access === "read") {
        throw new Error("Write tools cannot bypass approval");
      }
    }
    for (const update of updates) {
      const current = policiesByName.get(update.toolName);
      if (
        current &&
        (current.access !== update.access ||
          (current.enabled && !update.enabled))
      ) {
        this.deleteAlwaysAllowGrant(connectionId, update.toolName);
      }
      void this.sql`
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
    void this.sql`
      DELETE FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
    `;
    void this.sql`
      DELETE FROM sidechat_always_allow_grants
      WHERE connection_id = ${connectionId}
    `;
    void this.sql`
      DELETE FROM sidechat_mcp_connections
      WHERE id = ${connectionId}
    `;
    return true;
  }

  async executeProjectTool(
    request: ExecuteProjectToolRequest,
  ): Promise<ExecuteProjectToolResult> {
    const db = drizzle(this.env.DB);
    const conversationStore = createPublicConversationStore({
      db,
      env: this.env,
    });
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
          conversationStore.get(
            this.name,
            request.conversationId,
          ),
        canActorAccessProject: (actorUserId) =>
          this.canActorAccessProject(db, actorUserId),
        getAuthoritativeHttpTool: (toolId) =>
          toolService.getAuthoritativeTool(this.name, toolId),
        getAuthoritativeMcpTool: (connectionId, toolName) =>
          this.getMcpToolPolicy(connectionId, toolName),
        hasAlwaysAllowGrant: (candidate) =>
          this.hasAlwaysAllowGrant(candidate),
        runKnowledgeSearch: async (input) => {
          const conversation = await conversationStore.get(
            this.name,
            request.conversationId,
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
              chatState:
                Object.keys(conversation.chatState).length > 0
                  ? JSON.stringify(conversation.chatState)
                  : null,
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
          runWithExternalActionLease(
            conversationStore,
            this.name,
            request.conversationId,
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
    void this.sql`
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
    void this.sql`
      CREATE TABLE IF NOT EXISTS sidechat_mcp_tool_policy (
        connection_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        exposed_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        input_schema TEXT NOT NULL,
        catalog_fingerprint TEXT NOT NULL,
        safety TEXT,
        access TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        catalog_present INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (connection_id, tool_name)
      )
    `;
    const policyColumns = this.sql<{ name: string }>`
      PRAGMA table_info(sidechat_mcp_tool_policy)
    `;
    if (!policyColumns.some((column) => column.name === "safety")) {
      void this.sql`
        ALTER TABLE sidechat_mcp_tool_policy ADD COLUMN safety TEXT
      `;
    }
    void this.sql`
      CREATE TABLE IF NOT EXISTS sidechat_always_allow_grants (
        connection_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        catalog_fingerprint TEXT NOT NULL,
        access TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
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
             description, input_schema, catalog_fingerprint, safety,
             access, enabled
      FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND catalog_present = 1
      ORDER BY tool_name ASC
    `
      .map(parseMcpToolPolicy)
      .filter((tool): tool is SidechatToolDescriptor => tool !== null)
      .map((tool) => this.withAlwaysAllowState(tool));
  }

  private getMcpToolPolicy(
    connectionId: string,
    toolName: string,
  ): SidechatToolDescriptor | null {
    this.ensureMcpApplicationSchema();
    const rows = this.sql<McpToolPolicyRow>`
      SELECT connection_id, tool_name, exposed_name, display_name,
             description, input_schema, catalog_fingerprint, safety,
             access, enabled
      FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND tool_name = ${toolName}
        AND catalog_present = 1
      LIMIT 1
    `;
    const descriptor = rows[0] ? parseMcpToolPolicy(rows[0]) : null;
    return descriptor ? this.withAlwaysAllowState(descriptor) : null;
  }

  private readAlwaysAllowGrant(
    connectionId: string,
    toolName: string,
  ): AlwaysAllowGrantRow | null {
    const rows = this.sql<AlwaysAllowGrantRow>`
      SELECT connection_id, tool_name, catalog_fingerprint, access
      FROM sidechat_always_allow_grants
      WHERE connection_id = ${connectionId}
        AND tool_name = ${toolName}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private withAlwaysAllowState(
    descriptor: SidechatToolDescriptor,
  ): SidechatToolDescriptor {
    if (descriptor.access !== "write" || !descriptor.enabled) {
      return { ...descriptor, alwaysAllowed: false };
    }
    const grant = this.readAlwaysAllowGrant(
      descriptor.connectionId,
      descriptor.toolName,
    );
    return {
      ...descriptor,
      alwaysAllowed: Boolean(
        grant &&
        grant.catalog_fingerprint === descriptor.catalogFingerprint &&
        grant.access === descriptor.access,
      ),
    };
  }

  private hasAlwaysAllowGrant(
    request: ExecuteProjectToolRequest,
  ): boolean {
    if (request.access !== "write") return false;
    this.ensureMcpApplicationSchema();
    const grant = this.readAlwaysAllowGrant(
      request.connectionId,
      request.toolName,
    );
    return Boolean(
      grant &&
      grant.catalog_fingerprint === request.catalogFingerprint &&
      grant.access === request.access,
    );
  }

  private deleteAlwaysAllowGrant(
    connectionId: string,
    toolName: string,
  ): void {
    void this.sql`
      DELETE FROM sidechat_always_allow_grants
      WHERE connection_id = ${connectionId}
        AND tool_name = ${toolName}
    `;
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
    const metadata = this.readMcpConnectionMetadata(connectionId);
    const preset = metadata?.preset_key
      ? getMcpPreset(metadata.preset_key)
      : null;
    const previousPolicies = new Map(
      this.readMcpToolPolicies(connectionId).map((tool) => [tool.toolName, tool]),
    );
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
      { forceReadOnly: preset?.readOnly === true },
    );
    void this.sql`
      UPDATE sidechat_mcp_tool_policy
      SET catalog_present = 0, updated_at = ${Date.now()}
      WHERE connection_id = ${connectionId}
    `;
    for (const tool of normalized) {
      const previous = previousPolicies.get(tool.toolName);
      if (
        previous &&
        (previous.catalogFingerprint !== tool.catalogFingerprint ||
          previous.access !== tool.access ||
          (previous.enabled && !tool.enabled))
      ) {
        this.deleteAlwaysAllowGrant(connectionId, tool.toolName);
      }
      void this.sql`
        INSERT INTO sidechat_mcp_tool_policy (
          connection_id, tool_name, exposed_name, display_name, description,
          input_schema, catalog_fingerprint, safety, access, enabled,
          catalog_present, updated_at
        ) VALUES (
          ${tool.connectionId}, ${tool.toolName}, ${tool.exposedName},
          ${tool.displayName}, ${tool.description},
          ${JSON.stringify(tool.inputSchema)}, ${tool.catalogFingerprint},
          ${tool.safety ?? tool.access}, ${tool.access},
          ${tool.enabled ? 1 : 0}, 1, ${Date.now()}
        )
        ON CONFLICT (connection_id, tool_name) DO UPDATE SET
          exposed_name = excluded.exposed_name,
          display_name = excluded.display_name,
          description = excluded.description,
          input_schema = excluded.input_schema,
          catalog_fingerprint = excluded.catalog_fingerprint,
          safety = excluded.safety,
          access = excluded.access,
          enabled = excluded.enabled,
          catalog_present = 1,
          updated_at = excluded.updated_at
      `;
    }
    void this.sql`
      DELETE FROM sidechat_mcp_tool_policy
      WHERE connection_id = ${connectionId}
        AND catalog_present = 0
    `;
    void this.sql`
      DELETE FROM sidechat_always_allow_grants
      WHERE connection_id = ${connectionId}
        AND NOT EXISTS (
          SELECT 1
          FROM sidechat_mcp_tool_policy
          WHERE sidechat_mcp_tool_policy.connection_id =
                sidechat_always_allow_grants.connection_id
            AND sidechat_mcp_tool_policy.tool_name =
                sidechat_always_allow_grants.tool_name
            AND sidechat_mcp_tool_policy.catalog_present = 1
        )
    `;
  }

  private buildMcpConnectionView(
    connectionId: string,
    authUrl?: string,
  ): McpConnectionView | null {
    const metadata = this.readMcpConnectionMetadata(connectionId);
    const authMode = metadata ? readMcpAuthMode(metadata.auth_mode) : null;
    if (!metadata || !authMode) return null;
    const presetKey = readMcpPresetKey(metadata.preset_key);
    const preset = presetKey ? getMcpPreset(presetKey) : null;
    const native = this.getMcpServers().servers[connectionId] as
      | NativeMcpServer
      | undefined;
    return {
      id: metadata.id,
      name: metadata.name,
      presetKey,
      url: metadata.url,
      authMode,
      state: native?.state ?? "disconnected",
      ...(authUrl || native?.auth_url
        ? { authUrl: authUrl ?? native?.auth_url ?? undefined }
        : {}),
      ...(native?.state === "connected"
        ? { issue: "tool_discovery_failed" as const }
        : {}),
      tools: this.readMcpToolPolicies(connectionId).map((tool) => ({
        ...tool,
        source: {
          kind: "mcp" as const,
          name: metadata.name,
          icon: preset?.icon ?? null,
        },
      })),
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const call = this.mcp.callTool({
      serverId: connectionId,
      name: toolName,
      arguments: input as Record<string, unknown>,
    }).then(
      (result) => ({ kind: "result" as const, result }),
      () => ({ kind: "error" as const }),
    );
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timeoutId = setTimeout(
        () => resolve({ kind: "timeout" }),
        MCP_TOOL_TIMEOUT_MS,
      );
    });
    const outcome = await Promise.race([call, timeout]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (outcome.kind !== "result") {
      return { error: outcome.kind === "timeout"
        ? "mcp_tool_timeout"
        : "mcp_tool_failed" };
    }
    const { result } = outcome;
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

  private broadcastProjectEvent(event: MavenProjectEvent): void {
    this.broadcast(JSON.stringify(event));
  }

  private assertRegisteredSidechat(
    childName: string,
    conversationId: string,
  ): void {
    const expectedChildName = toSidechatChildName(conversationId);
    const summary = this.conversationDirectory().getConversation(
      conversationId,
    );
    if (
      childName !== expectedChildName ||
      summary?.sidechatChildName !== childName ||
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
    if (child.name.startsWith("pub_")) {
      const conversationId = child.name.slice(4);
      const summary = this.conversationDirectory().getConversation(
        conversationId,
      );
      if (summary?.publicChildName !== child.name) {
        return new Response("Not found", { status: 404 });
      }
      const authorized = await authorizePublicSubAgentRequest(
        request,
        this.name,
        child.name,
        this.env.SIDECHAT_TOKEN_SECRET,
      );
      if (authorized instanceof Response) return authorized;
      const claims = readVerifiedPublicChatClaims(authorized);
      if (
        !claims ||
        (claims.actor === "visitor" &&
          (claims.visitorId !== summary.visitorId ||
            summary.archivedAt !== null))
      ) {
        return new Response("Not found", { status: 404 });
      }
      return authorized;
    }
    const authorized = await authorizeSubAgentRequest(
      request,
      this.name,
      child.name,
      this.env.SIDECHAT_TOKEN_SECRET,
    );
    if (authorized instanceof Response) return authorized;
    const claims = readVerifiedSidechatClaims(authorized);
    if (
      claims?.scope === "child" &&
      claims.canSubmit &&
      !await this.isSidechatOperational(child.name, claims.conversationId)
    ) {
      return new Response("Conversation archived", { status: 409 });
    }
    return authorized;
  }
}
