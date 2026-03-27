import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, desc, and, gt, ne, inArray } from "drizzle-orm";
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

  async getConversationById(
    id: string,
    projectId: string,
  ): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getConversationsByProject(
    projectId: string,
    limit = 50,
    offset = 0,
    statusFilter: "open" | "closed" | "all" = "all",
  ): Promise<ConversationRow[]> {
    const conditions = [eq(conversations.projectId, projectId)];
    if (statusFilter === "open") {
      conditions.push(ne(conversations.status, "closed"));
    } else if (statusFilter === "closed") {
      conditions.push(eq(conversations.status, "closed"));
    }
    return this.db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(
        desc(conversations.lastActivityAt),
        desc(conversations.updatedAt),
      )
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
    return (await this.getConversationById(id, data.projectId))!;
  }

  async updateConversationStatus(
    id: string,
    projectId: string,
    status: ConversationRow["status"],
    closeReason?: ConversationRow["closeReason"],
  ): Promise<void> {
    const updates: Partial<ConversationRow> = { status };
    if (status === "closed" && closeReason) {
      updates.closeReason = closeReason;
    }
    await this.db
      .update(conversations)
      .set(updates)
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );
  }

  async updateConversationEmail(
    id: string,
    projectId: string,
    email: string,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ visitorEmail: email })
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );
  }

  async getActiveConversationByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.visitorId, visitorId),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    const conv = rows[0] ?? null;
    if (!conv) return null;
    // Return non-closed conversations directly
    if (conv.status !== "closed") return conv;
    // Return recently closed conversations (within 24h) so widget can show history + allow reopen
    const hoursSinceClosed = (Date.now() - conv.updatedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceClosed < 24) return conv;
    return null;
  }

  async updateConversation(
    id: string,
    projectId: string,
    data: {
      visitorName?: string;
      visitorEmail?: string;
      metadata?: string;
    },
  ): Promise<ConversationRow | null> {
    const existing = await this.getConversationById(id, projectId);
    if (!existing) return null;

    const updates: Record<string, unknown> = {};
    if (data.visitorName !== undefined) updates.visitorName = data.visitorName;
    if (data.visitorEmail !== undefined) updates.visitorEmail = data.visitorEmail;
    if (data.metadata !== undefined) {
      // Merge new metadata with existing metadata
      const existingMeta = existing.metadata
        ? JSON.parse(existing.metadata)
        : {};
      const newMeta = JSON.parse(data.metadata);
      updates.metadata = JSON.stringify({ ...existingMeta, ...newMeta });
    }

    if (Object.keys(updates).length === 0) return existing;

    await this.db
      .update(conversations)
      .set(updates)
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );

    return this.getConversationById(id, projectId);
  }

  async updateTelegramThreadId(
    id: string,
    projectId: string,
    threadId: string,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ telegramThreadId: threadId })
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );
  }

  async getAgentModeConversations(
    projectId: string,
  ): Promise<ConversationRow[]> {
    return this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          inArray(conversations.status, ["waiting_agent", "agent_replied"]),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(10);
  }

  // ─── Stale Chat Management ───────────────────────────────────────────────────

  async checkAndCloseStale(
    conversationId: string,
    projectId: string,
    autoCloseMinutes: number,
  ): Promise<{ closed: boolean; conversation: ConversationRow | null }> {
    const conversation = await this.getConversationById(conversationId, projectId);
    if (!conversation) return { closed: false, conversation: null };
    if (conversation.status === "closed") return { closed: false, conversation };

    const lastActivity = conversation.lastActivityAt?.getTime() ?? conversation.createdAt.getTime();
    const staleThreshold = Date.now() - autoCloseMinutes * 60 * 1000;

    if (lastActivity < staleThreshold) {
      await this.updateConversationStatus(conversationId, projectId, "closed", "ended");
      const updated = await this.getConversationById(conversationId, projectId);
      return { closed: true, conversation: updated };
    }

    return { closed: false, conversation };
  }

  async checkAndCloseStaleForProject(
    projectConversations: ConversationRow[],
    autoCloseMinutes: number,
  ): Promise<string[]> {
    const closedIds: string[] = [];
    const staleThreshold = Date.now() - autoCloseMinutes * 60 * 1000;

    const sorted = [...projectConversations].sort((a, b) => {
      const aTime = a.lastActivityAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastActivityAt?.getTime() ?? b.createdAt.getTime();
      return aTime - bTime;
    });

    for (const conv of sorted) {
      if (conv.status === "closed") continue;
      const lastActivity = conv.lastActivityAt?.getTime() ?? conv.createdAt.getTime();
      if (lastActivity < staleThreshold) {
        await this.updateConversationStatus(conv.id, conv.projectId, "closed", "ended");
        closedIds.push(conv.id);
      }
    }

    return closedIds;
  }

  async reopenConversation(
    id: string,
    projectId: string,
  ): Promise<ConversationRow | null> {
    const now = new Date();
    await this.db
      .update(conversations)
      .set({
        status: "active",
        closeReason: null,
        lastActivityAt: now,
      })
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );
    return this.getConversationById(id, projectId);
  }

  async updateVisitorLastSeen(
    id: string,
    projectId: string,
    presence: "active" | "background" = "active",
  ): Promise<ConversationRow | null> {
    const now = new Date();
    const updates: Record<string, unknown> = {
      visitorLastSeenAt: now,
      visitorPresence: presence,
    };
    if (presence === "active") {
      updates.visitorLastOnlineAt = now;
    }
    await this.db
      .update(conversations)
      .set(updates)
      .where(
        and(eq(conversations.id, id), eq(conversations.projectId, projectId)),
      );
    return this.getConversationById(id, projectId);
  }

  async getLastConversationByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.visitorId, visitorId),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── Messages ───────────────────────────────────────────────────────────────

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async getMessagesSince(
    conversationId: string,
    since: number,
  ): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gt(messages.createdAt, new Date(since)),
        ),
      )
      .orderBy(messages.createdAt);
  }

  async addMessage(
    data: Omit<NewMessageRow, "id" | "createdAt">,
    projectId: string,
  ): Promise<MessageRow> {
    const id = crypto.randomUUID();
    await this.db.insert(messages).values({ id, ...data });

    const now = new Date();
    await this.db
      .update(conversations)
      .set({ updatedAt: now, lastActivityAt: now })
      .where(eq(conversations.id, data.conversationId));

    // Update KV cache
    await this.updateKVCache(data.conversationId, projectId);

    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return rows[0]!;
  }

  // ─── KV Cache ───────────────────────────────────────────────────────────────

  private cacheKey(projectId: string, conversationId: string): string {
    return `conv:${projectId}:${conversationId}`;
  }

  async getFromCache(
    conversationId: string,
    projectId: string,
  ): Promise<MessageRow[] | null> {
    const cached = await this.kv.get(
      this.cacheKey(projectId, conversationId),
      "json",
    );
    return cached as MessageRow[] | null;
  }

  async updateKVCache(
    conversationId: string,
    projectId: string,
  ): Promise<void> {
    const recentMessages = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(50);

    // Store in reverse order (oldest first)
    const ordered = recentMessages.reverse();
    await this.kv.put(
      this.cacheKey(projectId, conversationId),
      JSON.stringify(ordered),
      { expirationTtl: 86400 },
    );
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
