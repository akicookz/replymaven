import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, desc, and } from "drizzle-orm";
import {
  conversations,
  messages,
  cannedResponses,
  type ConversationRow,
  type NewConversationRow,
  type MessageRow,
  type NewMessageRow,
} from "../db";

export class ChatService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private kv: KVNamespace,
  ) {}

  // ─── Conversations ──────────────────────────────────────────────────────────

  async getConversationById(id: string): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getConversationsByProject(
    projectId: string,
    limit = 50,
    offset = 0,
  ): Promise<ConversationRow[]> {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  async createConversation(
    data: Omit<NewConversationRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ConversationRow> {
    const id = crypto.randomUUID();
    await this.db
      .insert(conversations)
      .values({ id, ...data });
    return (await this.getConversationById(id))!;
  }

  async updateConversationStatus(
    id: string,
    status: ConversationRow["status"],
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ status })
      .where(eq(conversations.id, id));
  }

  async updateConversationEmail(
    id: string,
    email: string,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ visitorEmail: email })
      .where(eq(conversations.id, id));
  }

  // ─── Messages ───────────────────────────────────────────────────────────────

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async addMessage(
    data: Omit<NewMessageRow, "id" | "createdAt">,
  ): Promise<MessageRow> {
    const id = crypto.randomUUID();
    await this.db.insert(messages).values({ id, ...data });

    // Update KV cache
    await this.updateKVCache(data.conversationId);

    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return rows[0]!;
  }

  // ─── KV Cache ───────────────────────────────────────────────────────────────

  async getFromCache(conversationId: string): Promise<MessageRow[] | null> {
    const cached = await this.kv.get(`conv:${conversationId}`, "json");
    return cached as MessageRow[] | null;
  }

  async updateKVCache(conversationId: string): Promise<void> {
    const recentMessages = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(50);

    // Store in reverse order (oldest first)
    const ordered = recentMessages.reverse();
    await this.kv.put(`conv:${conversationId}`, JSON.stringify(ordered), {
      expirationTtl: 86400, // 24 hours
    });
  }

  // ─── Canned Responses ───────────────────────────────────────────────────────

  async findCannedResponse(
    projectId: string,
    query: string,
  ): Promise<{ trigger: string; response: string } | null> {
    const approved = await this.db
      .select()
      .from(cannedResponses)
      .where(
        and(
          eq(cannedResponses.projectId, projectId),
          eq(cannedResponses.status, "approved"),
        ),
      );

    // Simple keyword matching -- find the best match
    const queryLower = query.toLowerCase();
    for (const cr of approved) {
      if (queryLower.includes(cr.trigger.toLowerCase())) {
        return { trigger: cr.trigger, response: cr.response };
      }
    }
    return null;
  }
}
