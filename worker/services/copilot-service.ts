import { type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, asc, count } from "drizzle-orm";
import {
  copilotMessages,
  type CopilotMessageRow,
  type NewCopilotMessageRow,
} from "../db";

export class CopilotService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getThread(conversationId: string): Promise<CopilotMessageRow[]> {
    return this.db
      .select()
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conversationId))
      .orderBy(asc(copilotMessages.createdAt));
  }

  async addMessage(
    data: Omit<NewCopilotMessageRow, "id" | "createdAt">,
  ): Promise<CopilotMessageRow> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.db
      .insert(copilotMessages)
      .values({ id, createdAt: now, ...data });
    return {
      id,
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      sources: data.sources ?? null,
      agentUserId: data.agentUserId ?? null,
      autoSuggest: data.autoSuggest ?? false,
      createdAt: now,
    };
  }

  async hasMessages(conversationId: string): Promise<boolean> {
    const rows = await this.db
      .select({ n: count() })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversationId, conversationId));
    return (rows[0]?.n ?? 0) > 0;
  }

  // Remove the proactive auto-draft rows for a conversation so a fresh one can
  // be generated (the "Rewrite" / regenerate path). Agent↔Copilot Q&A rows are
  // left intact — only the throwaway suggestion is replaced.
  async clearAutoSuggestions(conversationId: string): Promise<void> {
    await this.db
      .delete(copilotMessages)
      .where(
        and(
          eq(copilotMessages.conversationId, conversationId),
          eq(copilotMessages.autoSuggest, true),
        ),
      );
  }
}
