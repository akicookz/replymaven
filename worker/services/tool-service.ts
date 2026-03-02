import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, desc, isNull, asc } from "drizzle-orm";
import {
  tools,
  toolExecutions,
  type ToolRow,
  type NewToolRow,
  type ToolExecutionRow,
} from "../db";

// ─── Tool Service ─────────────────────────────────────────────────────────────

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

  async getToolById(id: string, projectId: string): Promise<ToolRow | null> {
    const rows = await this.db
      .select()
      .from(tools)
      .where(and(eq(tools.id, id), eq(tools.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
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
    data: Omit<NewToolRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ToolRow> {
    const id = crypto.randomUUID();
    await this.db.insert(tools).values({ id, ...data });
    return (await this.getToolById(id, data.projectId))!;
  }

  async updateTool(
    id: string,
    projectId: string,
    updates: Partial<
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
      >
    >,
  ): Promise<ToolRow | null> {
    await this.db
      .update(tools)
      .set(updates)
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
   * Link all unlinked tool executions for a conversation to a specific bot message.
   * Called after the bot message is stored post-streaming.
   */
  async linkExecutionsToMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    await this.db
      .update(toolExecutions)
      .set({ messageId })
      .where(
        and(
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
}
