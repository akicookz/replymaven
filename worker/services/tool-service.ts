import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, desc, isNull, asc, inArray } from "drizzle-orm";
import {
  tools,
  toolExecutions,
  type ToolRow,
  type NewToolRow,
  type ToolExecutionRow,
} from "../db";
import {
  isReservedMavenToolName,
  toolAudienceSchema,
  type MavenChannel,
} from "../validation";

// ─── Tool Service ─────────────────────────────────────────────────────────────

type CreateToolInput = Omit<
  NewToolRow,
  "id" | "createdAt" | "updatedAt" | "allowedChannels"
> & {
  allowedChannels?: MavenChannel[];
};

type ToolUpdateInput = Partial<
  Pick<
    ToolRow,
    | "displayName"
    | "description"
    | "endpoint"
    | "method"
    | "headers"
    | "parameters"
    | "responseMapping"
    | "enabled"
    | "timeout"
    | "sortOrder"
    | "access"
    | "schemaFingerprint"
  >
> & {
  allowedChannels?: MavenChannel[];
};

function serializeAllowedChannels(allowedChannels: unknown): string {
  return JSON.stringify(toolAudienceSchema.parse(allowedChannels));
}

export class ToolService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async getTools(projectId: string): Promise<ToolRow[]> {
    return this.db
      .select()
      .from(tools)
      .where(eq(tools.projectId, projectId))
      .orderBy(tools.sortOrder);
  }

  async getEnabledTools(projectId: string): Promise<ToolRow[]> {
    return this.db
      .select()
      .from(tools)
      .where(and(eq(tools.projectId, projectId), eq(tools.enabled, true)))
      .orderBy(tools.sortOrder);
  }

  async getEnabledToolsForChannel(
    projectId: string,
    channel: MavenChannel,
  ): Promise<ToolRow[]> {
    const enabledTools = await this.getEnabledTools(projectId);

    return enabledTools.filter((tool) => {
      if (isReservedMavenToolName(tool.name)) return false;
      let allowedChannels: unknown;
      try {
        allowedChannels = JSON.parse(tool.allowedChannels);
      } catch {
        return false;
      }

      const parsed = toolAudienceSchema.safeParse(allowedChannels);
      return parsed.success && parsed.data.includes(channel);
    });
  }

  async getToolById(id: string, projectId: string): Promise<ToolRow | null> {
    const rows = await this.db
      .select()
      .from(tools)
      .where(and(eq(tools.id, id), eq(tools.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getAuthoritativeTool(
    projectId: string,
    toolId: string,
  ): Promise<ToolRow | null> {
    return this.getToolById(toolId, projectId);
  }

  async getToolByName(name: string, projectId: string): Promise<ToolRow | null> {
    const rows = await this.db
      .select()
      .from(tools)
      .where(and(eq(tools.name, name), eq(tools.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createTool(
    data: CreateToolInput,
  ): Promise<ToolRow> {
    if (isReservedMavenToolName(data.name)) {
      throw new Error("This name is reserved for an internal Maven tool");
    }
    const id = crypto.randomUUID();
    const { allowedChannels, ...toolData } = data;
    await this.db.insert(tools).values({
      id,
      ...toolData,
      ...(allowedChannels === undefined
        ? {}
        : { allowedChannels: serializeAllowedChannels(allowedChannels) }),
    });
    return (await this.getToolById(id, data.projectId))!;
  }

  async updateTool(
    id: string,
    projectId: string,
    updates: ToolUpdateInput,
  ): Promise<ToolRow | null> {
    const { allowedChannels, ...toolUpdates } = updates;
    await this.db
      .update(tools)
      .set({
        ...toolUpdates,
        ...(allowedChannels === undefined
          ? {}
          : { allowedChannels: serializeAllowedChannels(allowedChannels) }),
      })
      .where(and(eq(tools.id, id), eq(tools.projectId, projectId)));
    return this.getToolById(id, projectId);
  }

  async deleteTool(id: string, projectId: string): Promise<boolean> {
    await this.db
      .delete(tools)
      .where(and(eq(tools.id, id), eq(tools.projectId, projectId)));
    // Verify deletion
    const check = await this.getToolById(id, projectId);
    return check === null;
  }

  async getToolCount(projectId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(tools)
      .where(eq(tools.projectId, projectId));
    return rows.length;
  }

  // ─── Execution Logging ──────────────────────────────────────────────────────

  async logExecution(data: {
    toolId: string;
    conversationId?: string | null;
    messageId?: string | null;
    input: Record<string, unknown>;
    output: unknown;
    status: "success" | "error" | "timeout";
    httpStatus?: number | null;
    duration: number;
    errorMessage?: string | null;
  }): Promise<ToolExecutionRow> {
    const id = crypto.randomUUID();
    await this.db.insert(toolExecutions).values({
      id,
      toolId: data.toolId,
      conversationId: data.conversationId ?? null,
      messageId: data.messageId ?? null,
      input: JSON.stringify(data.input),
      output: data.output ? JSON.stringify(data.output).slice(0, 10240) : null,
      status: data.status,
      httpStatus: data.httpStatus ?? null,
      duration: data.duration,
      errorMessage: data.errorMessage ?? null,
    });

    const rows = await this.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.id, id))
      .limit(1);
    return rows[0]!;
  }

  async getExecutions(
    projectId: string,
    options?: { toolId?: string; limit?: number; offset?: number },
  ): Promise<ToolExecutionRow[]> {
    // Join through tools table to filter by project
    const projectTools = await this.getTools(projectId);
    const toolIds = projectTools.map((t) => t.id);

    if (toolIds.length === 0) return [];

    let query = this.db
      .select()
      .from(toolExecutions)
      .orderBy(desc(toolExecutions.createdAt));

    if (options?.toolId) {
      query = query.where(eq(toolExecutions.toolId, options.toolId)) as typeof query;
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await query.limit(limit).offset(offset);

    // Filter to only executions belonging to this project's tools
    return rows.filter((r) => toolIds.includes(r.toolId));
  }

  // ─── Message Linking ────────────────────────────────────────────────────────

  /**
   * Link the named, still-unlinked executions to a specific bot message.
   * Called after the bot message is stored post-streaming.
   */
  async linkExecutionsToMessage(
    executionIds: string[],
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (executionIds.length === 0) return;
    await this.db
      .update(toolExecutions)
      .set({ messageId })
      .where(
        and(
          inArray(toolExecutions.id, executionIds),
          eq(toolExecutions.conversationId, conversationId),
          isNull(toolExecutions.messageId),
        ),
      );
  }

  /**
   * Get all tool executions for a conversation, joined with tool metadata.
   * Ordered by creation time (ascending) for chronological display.
   */
  async getExecutionsByConversation(
    conversationId: string,
  ): Promise<
    (ToolExecutionRow & { toolName: string; displayName: string; method: string })[]
  > {
    const rows = await this.db
      .select({
        id: toolExecutions.id,
        toolId: toolExecutions.toolId,
        conversationId: toolExecutions.conversationId,
        messageId: toolExecutions.messageId,
        input: toolExecutions.input,
        output: toolExecutions.output,
        status: toolExecutions.status,
        httpStatus: toolExecutions.httpStatus,
        duration: toolExecutions.duration,
        errorMessage: toolExecutions.errorMessage,
        createdAt: toolExecutions.createdAt,
        toolName: tools.name,
        displayName: tools.displayName,
        method: tools.method,
      })
      .from(toolExecutions)
      .innerJoin(tools, eq(toolExecutions.toolId, tools.id))
      .where(eq(toolExecutions.conversationId, conversationId))
      .orderBy(asc(toolExecutions.createdAt));

    return rows;
  }

  /**
   * Get tool executions scoped to a specific list of message IDs. Used by the
   * dashboard detail endpoint so we don't pull executions for messages we
   * aren't displaying (the conversation may have hundreds of historic
   * tool calls; we only want the ones attached to the current page).
   */
  async getExecutionsByMessageIds(
    messageIds: string[],
  ): Promise<
    (ToolExecutionRow & { toolName: string; displayName: string; method: string })[]
  > {
    if (messageIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: toolExecutions.id,
        toolId: toolExecutions.toolId,
        conversationId: toolExecutions.conversationId,
        messageId: toolExecutions.messageId,
        input: toolExecutions.input,
        output: toolExecutions.output,
        status: toolExecutions.status,
        httpStatus: toolExecutions.httpStatus,
        duration: toolExecutions.duration,
        errorMessage: toolExecutions.errorMessage,
        createdAt: toolExecutions.createdAt,
        toolName: tools.name,
        displayName: tools.displayName,
        method: tools.method,
      })
      .from(toolExecutions)
      .innerJoin(tools, eq(toolExecutions.toolId, tools.id))
      .where(inArray(toolExecutions.messageId, messageIds))
      .orderBy(asc(toolExecutions.createdAt));

    return rows;
  }
}
