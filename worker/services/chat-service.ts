import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, desc, and, gt, lt, lte, ne, isNull, inArray, isNotNull, or, like, sql } from "drizzle-orm";
import {
  conversations,
  messages,
  type ConversationRow,
  type NewConversationRow,
  type MessageRow,
  type NewMessageRow,
} from "../db";
import {
  type ConversationChatState,
  createInitialChatState,
  parseChatState,
} from "../chat-runtime/types";

export type SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted";
export type InboxFilter = "needs-you" | "all" | "snoozed" | "resolved" | "flagged";

export class ChatService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

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
    searchQuery?: string,
    inboxFilter?: InboxFilter,
  ): Promise<ConversationRow[]> {
    const now = new Date();
    const conditions = [eq(conversations.projectId, projectId)];
    if (inboxFilter) {
      switch (inboxFilter) {
        case "needs-you":
          conditions.push(eq(conversations.status, "waiting_agent"));
          conditions.push(or(isNull(conversations.snoozedUntil), lte(conversations.snoozedUntil, now))!);
          break;
        case "snoozed": conditions.push(gt(conversations.snoozedUntil, now)); break;
        case "resolved": conditions.push(eq(conversations.status, "closed")); break;
        case "flagged": conditions.push(eq(conversations.closeReason, "spam")); break;
        case "all": conditions.push(ne(conversations.status, "closed")); break;
      }
    } else if (statusFilter === "open") {
      conditions.push(ne(conversations.status, "closed"));
    } else if (statusFilter === "closed") {
      conditions.push(eq(conversations.status, "closed"));
    }
    const trimmedQuery = searchQuery?.trim();
    if (trimmedQuery) {
      const pattern = `%${trimmedQuery.toLowerCase()}%`;
      // SQLite LIKE is case-insensitive only for ASCII; use LOWER() to handle
      // mixed-case visitor names/emails uniformly. Indexes on
      // LOWER(visitor_name) / LOWER(visitor_email) (migration 0039) keep this
      // fast even with prefix wildcard.
      const nameMatch = like(sql`LOWER(${conversations.visitorName})`, pattern);
      const emailMatch = like(sql`LOWER(${conversations.visitorEmail})`, pattern);
      const matcher = or(nameMatch, emailMatch);
      if (matcher) conditions.push(matcher);
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

  async getConversationCounts(
    projectId: string,
  ): Promise<{ all: number; open: number; closed: number }> {
    const rows = await this.db
      .select({
        status: conversations.status,
        count: sql<number>`count(*)`,
      })
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .groupBy(conversations.status);

    let all = 0;
    let closed = 0;
    for (const row of rows) {
      all += row.count;
      if (row.status === "closed") closed = row.count;
    }
    return { all, open: all - closed, closed };
  }

  async setSnooze(conversationId: string, projectId: string, until: Date | null): Promise<void> {
    await this.db.update(conversations)
      .set({ snoozedUntil: until })
      .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
  }

  async setPriority(conversationId: string, projectId: string, priority: "low" | "medium" | "high"): Promise<void> {
    await this.db.update(conversations)
      .set({ priority })
      .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
  }

  async getConversationUpdatesSince(
    projectId: string,
    since: Date,
    limit = 100,
  ): Promise<
    Array<
      Omit<ConversationRow, "chatState" | "telegramThreadId">
    >
  > {
    // Return the full sidebar-renderable shape (everything except the heavy
    // chatState JSON and the telegram thread id, neither of which the
    // dashboard sidebar consumes). The since filter still bounds the count;
    // payload per poll is typically small. Letting the client see the full
    // row means brand-new conversations or off-page conversations can be
    // prepended into the loaded list, instead of being silently dropped.
    const rows = await this.db
      .select({
        id: conversations.id,
        projectId: conversations.projectId,
        visitorId: conversations.visitorId,
        visitorName: conversations.visitorName,
        visitorEmail: conversations.visitorEmail,
        status: conversations.status,
        closeReason: conversations.closeReason,
        metadata: conversations.metadata,
        lastActivityAt: conversations.lastActivityAt,
        visitorLastSeenAt: conversations.visitorLastSeenAt,
        visitorPresence: conversations.visitorPresence,
        visitorLastOnlineAt: conversations.visitorLastOnlineAt,
        snoozedUntil: conversations.snoozedUntil,
        priority: conversations.priority,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          gt(conversations.lastActivityAt, since),
        ),
      )
      .orderBy(desc(conversations.lastActivityAt))
      .limit(limit);
    return rows;
  }

  async createConversation(
    data: Omit<NewConversationRow, "id" | "createdAt" | "updatedAt">,
  ): Promise<ConversationRow> {
    const id = crypto.randomUUID();

    await this.db
      .insert(conversations)
      .values({
        id,
        ...data,
        chatState: JSON.stringify(createInitialChatState()),
      });
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
    const staleThreshold = Date.now() - autoCloseMinutes * 60 * 1000;

    const staleIds = projectConversations
      .filter((conv) => {
        if (conv.status === "closed") return false;
        const lastActivity = conv.lastActivityAt?.getTime() ?? conv.createdAt.getTime();
        return lastActivity < staleThreshold;
      })
      .map((conv) => conv.id);

    if (staleIds.length > 0) {
      await this.db
        .update(conversations)
        .set({ status: "closed", closeReason: "ended", updatedAt: new Date() })
        .where(inArray(conversations.id, staleIds));
    }

    return staleIds;
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

  async getRecentConversationByVisitorEmail(
    projectId: string,
    email: string,
  ): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.visitorEmail, email),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── Chat State ─────────────────────────────────────────────────────────────

  async getChatState(
    conversationId: string,
    projectId: string,
  ): Promise<ConversationChatState> {
    const conversation = await this.getConversationById(
      conversationId,
      projectId,
    );
    return parseChatState(conversation?.chatState ?? null);
  }

  async saveChatState(
    conversationId: string,
    projectId: string,
    chatState: ConversationChatState,
  ): Promise<void> {
    await this.db
      .update(conversations)
      .set({ chatState: JSON.stringify(chatState) })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
        ),
      );
  }

  // ─── Messages ───────────────────────────────────────────────────────────────

  // Fetch the latest message for each given conversation. Returns a map keyed
  // by conversationId. Used by the dashboard sidebar to render a 1-line preview
  // under each visitor name.
  async getLastMessagesByConversationIds(
    conversationIds: string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        role: "visitor" | "bot" | "agent" | "system";
        content: string;
        senderName: string | null;
        emailedAt: Date | null;
        createdAt: Date;
      }
    >
  > {
    if (conversationIds.length === 0) return new Map();

    // Correlated subquery picks the row whose createdAt matches MAX for that
    // conversation. Truncate content server-side to ~140 chars so a busy
    // sidebar doesn't ship hundreds of KB of bot-response bodies.
    const PREVIEW_CHARS = 140;
    const rows = await this.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: sql<string>`SUBSTR(${messages.content}, 1, ${PREVIEW_CHARS})`,
        senderName: messages.senderName,
        emailedAt: messages.emailedAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          sql`${messages.createdAt} = (
            SELECT MAX(m2.created_at) FROM messages m2
            WHERE m2.conversation_id = ${messages.conversationId}
          )`,
        ),
      );

    const map = new Map<
      string,
      {
        id: string;
        role: "visitor" | "bot" | "agent" | "system";
        content: string;
        senderName: string | null;
        emailedAt: Date | null;
        createdAt: Date;
      }
    >();
    for (const row of rows) {
      // First write wins on the rare case of ties on createdAt.
      if (!map.has(row.conversationId)) {
        const { conversationId: _omit, ...rest } = row;
        void _omit;
        map.set(row.conversationId, rest);
      }
    }
    return map;
  }

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), ne(messages.role, "system")))
      .orderBy(messages.createdAt);
  }

  // Paginated reads — used by the dashboard detail endpoint to avoid
  // shipping unbounded message history on every conversation click.
  async getRecentMessages(
    conversationId: string,
    limit = 30,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    // Selected newest-first to use the index; reverse for chronological display.
    return { messages: sliced.reverse(), hasMore };
  }

  async getMessagesBefore(
    conversationId: string,
    beforeCreatedAt: Date,
    limit = 30,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          lt(messages.createdAt, beforeCreatedAt),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return { messages: sliced.reverse(), hasMore };
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
          ne(messages.role, "system"),
          gt(messages.createdAt, new Date(since)),
        ),
      )
      .orderBy(messages.createdAt);
  }

  // Writes an internal system event message. Does NOT bump lastActivityAt so
  // snooze/flag actions don't reorder the conversation list.
  async addSystemMessage(
    conversationId: string,
    kind: SystemEventKind,
    content: string,
  ): Promise<MessageRow> {
    const id = crypto.randomUUID();
    const now = new Date();
    const sources = JSON.stringify({ systemKind: kind });
    await this.db.insert(messages).values({
      id, conversationId, role: "system", content, sources, createdAt: now,
    });
    return {
      id, conversationId, role: "system", content, sources,
      imageUrl: null, senderName: null, senderAvatar: null, userId: null,
      createdAt: now, emailedAt: null,
    };
  }

  async addMessage(
    data: Omit<NewMessageRow, "id" | "createdAt">,
  ): Promise<MessageRow> {
    const id = crypto.randomUUID();
    const now = new Date();

    await Promise.all([
      this.db.insert(messages).values({ id, createdAt: now, ...data }),
      this.db
        .update(conversations)
        .set({ updatedAt: now, lastActivityAt: now })
        .where(eq(conversations.id, data.conversationId)),
    ]);

    return {
      id,
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      imageUrl: data.imageUrl ?? null,
      sources: data.sources ?? null,
      senderName: data.senderName ?? null,
      senderAvatar: data.senderAvatar ?? null,
      userId: data.userId ?? null,
      createdAt: now,
      emailedAt: null,
    };
  }

  async getMessageById(messageId: string): Promise<MessageRow | null> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getLatestEmailedAgentMessage(
    conversationId: string,
  ): Promise<MessageRow | null> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.role, "agent"),
          isNotNull(messages.emailedAt),
          isNotNull(messages.userId),
        ),
      )
      .orderBy(desc(messages.emailedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async markMessageAsEmailed(messageId: string): Promise<void> {
    await this.db
      .update(messages)
      .set({ emailedAt: new Date() })
      .where(eq(messages.id, messageId));
  }

  async getInboxCounts(projectId: string): Promise<Record<InboxFilter, number>> {
    const now = new Date();
    const [statusRows, snoozed, flagged] = await Promise.all([
      this.db.select({ status: conversations.status, count: sql<number>`count(*)` })
        .from(conversations).where(eq(conversations.projectId, projectId))
        .groupBy(conversations.status),
      this.db.select({ count: sql<number>`count(*)` }).from(conversations)
        .where(and(eq(conversations.projectId, projectId), gt(conversations.snoozedUntil, now))),
      this.db.select({ count: sql<number>`count(*)` }).from(conversations)
        .where(and(eq(conversations.projectId, projectId), eq(conversations.closeReason, "spam"))),
    ]);
    let waiting = 0, open = 0, closed = 0;
    for (const r of statusRows) {
      if (r.status === "waiting_agent") waiting = r.count;
      if (r.status !== "closed") open += r.count;
      if (r.status === "closed") closed = r.count;
    }
    return {
      "needs-you": waiting, all: open, snoozed: snoozed[0]?.count ?? 0,
      resolved: closed, flagged: flagged[0]?.count ?? 0,
    };
  }

  // Hard-delete a message. Caller must verify project ownership via the
  // conversation first. Only agent-role messages are deletable. Idempotent:
  // returns { deleted: false, reason: "not_found" } if the row is already gone,
  // letting the caller treat racing deletes as success.
  async deleteAgentMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{
    deleted: boolean;
    reason?: "not_found" | "wrong_conversation" | "not_agent";
    row?: MessageRow;
  }> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    const row = rows[0];
    if (!row) return { deleted: false, reason: "not_found" };
    if (row.conversationId !== conversationId) {
      return { deleted: false, reason: "wrong_conversation" };
    }
    if (row.role !== "agent") return { deleted: false, reason: "not_agent" };

    await this.db.delete(messages).where(eq(messages.id, messageId));

    // Recompute lastActivityAt so the conversation list re-orders correctly.
    // Falls back to the conversation's createdAt when no messages remain.
    await this.db
      .update(conversations)
      .set({
        lastActivityAt: sql`COALESCE(
          (SELECT MAX(${messages.createdAt}) FROM ${messages}
           WHERE ${messages.conversationId} = ${conversationId}),
          ${conversations.createdAt}
        )`,
      })
      .where(eq(conversations.id, conversationId));

    return { deleted: true, row };
  }
}
