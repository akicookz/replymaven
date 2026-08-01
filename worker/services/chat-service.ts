import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, desc, and, gt, lt, lte, ne, isNull, inArray, isNotNull, or, like, sql, type SQL } from "drizzle-orm";
import {
  conversations,
  messages,
  type ConversationRow,
  type NewConversationRow,
  type MessageRow,
  type NewMessageRow,
} from "../db";
import {
  applyChatOwnershipEvent,
  type ChatOwnershipEvent,
  type ConversationChatState,
  createInitialChatState,
  fallbackAiParticipationForStatus,
  mergeChatStateForPersistence,
  parseChatState,
} from "../chat-runtime/types";

export type SystemEventKind = "flagged" | "joined" | "snoozed" | "snooze_ended" | "drafted" | "review_summary";
export type InboxFilter =
  | "needs-you"
  | "all"
  | "snoozed"
  | "resolved"
  | "archived"
  | "flagged";

// Query for conversations that entered (or re-entered) Needs You since
// `since` (ms). Status changes bump updatedAt, so it doubles as the
// escalation watermark. Exported so tests can enforce its tenant-scope contract.
export function buildNeedsReviewQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
  since: number,
  now: Date = new Date(),
) {
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.status, "waiting_agent"),
        isNull(conversations.archivedAt),
        gt(conversations.updatedAt, new Date(since)),
        // Snoozing bumps updatedAt; without this guard the ping would
        // re-surface the very conversation the user just snoozed.
        notSnoozedCondition(now),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(20);
}

function buildHasVisitorMessagesQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationId: string,
) {
  return db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "visitor"),
      ),
    )
    .limit(1);
}

function buildVisitorMessageCountQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationId: string,
) {
  return db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "visitor"),
      ),
    );
}

interface ConditionalBotMessageInput {
  id: string;
  conversationId: string;
  projectId: string;
  content: string;
  sources: string | null;
  senderName: string | null;
  createdAt: Date;
  expectedStatus: ConversationRow["status"];
  expectedChatState: string | null;
}

export function buildConditionalBotMessageQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  input: ConditionalBotMessageInput,
) {
  const chatStateCondition =
    input.expectedChatState === null
      ? isNull(conversations.chatState)
      : eq(conversations.chatState, input.expectedChatState);
  const selectQuery = db
    .select({
      id: sql<string>`${input.id}`.as("id"),
      conversationId: conversations.id,
      role: sql<"bot">`${"bot"}`.as("role"),
      content: sql<string>`${input.content}`.as("content"),
      imageUrl: sql<null>`null`.as("image_url"),
      sources: sql<string | null>`${input.sources}`.as("sources"),
      senderName: sql<string | null>`${input.senderName}`.as("sender_name"),
      senderAvatar: sql<null>`null`.as("sender_avatar"),
      userId: sql<null>`null`.as("user_id"),
      createdAt: sql<Date>`${Math.floor(input.createdAt.getTime() / 1000)}`.as(
        "created_at",
      ),
      emailedAt: sql<null>`null`.as("emailed_at"),
      deliveredAt: sql<null>`null`.as("delivered_at"),
      readAt: sql<null>`null`.as("read_at"),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.projectId, input.projectId),
        eq(conversations.status, input.expectedStatus),
        chatStateCondition,
      ),
    );

  return db.insert(messages).select(selectQuery).returning();
}

export function buildHumanTakeoverQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationId: string,
  projectId: string,
  activityAt?: Date,
) {
  const validChatState = sql`case when json_valid(${conversations.chatState}) then ${conversations.chatState} else '{}' end`;
  const nextChatState = sql`json_set(
    ${validChatState},
    '$.state', 'agent_mode',
    '$.aiParticipation', 'human_only',
    '$.ownershipRevision', coalesce(json_extract(${validChatState}, '$.ownershipRevision'), 0) + 1
  )`;
  return db
    .update(conversations)
    .set({
      status: "agent_replied",
      closeReason: null,
      chatState: nextChatState,
      ...(activityAt ? { lastActivityAt: activityAt } : {}),
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
      ),
    )
    .returning({
      status: conversations.status,
      chatState: conversations.chatState,
    });
}

// ─── Inbox tab predicates ────────────────────────────────────────────────────
// Snoozed and flagged (spam) conversations live ONLY in their own tabs: they
// are excluded from Needs You, All, and Resolved. "Blocked" visitors'
// conversations are closed with closeReason "spam" at ban time, so the spam
// exclusion covers them too.

function notSnoozedCondition(now: Date): SQL {
  return or(
    isNull(conversations.snoozedUntil),
    lte(conversations.snoozedUntil, now),
  )!;
}

function notSpamCondition(): SQL {
  return or(
    isNull(conversations.closeReason),
    ne(conversations.closeReason, "spam"),
  )!;
}

function notArchivedCondition(): SQL {
  return isNull(conversations.archivedAt);
}

function inboxFilterConditions(filter: InboxFilter, now: Date): SQL[] {
  switch (filter) {
    case "needs-you":
      return [
        eq(conversations.status, "waiting_agent"),
        notSnoozedCondition(now),
        notArchivedCondition(),
      ];
    case "all":
      return [
        notSnoozedCondition(now),
        notSpamCondition(),
        notArchivedCondition(),
      ];
    case "snoozed":
      return [gt(conversations.snoozedUntil, now), notArchivedCondition()];
    case "resolved":
      return [
        eq(conversations.status, "closed"),
        notSpamCondition(),
        notArchivedCondition(),
      ];
    case "archived":
      return [isNotNull(conversations.archivedAt)];
    case "flagged":
      return [eq(conversations.closeReason, "spam"), notArchivedCondition()];
  }
}

// Single-pass conditional counts derived from the SAME predicate builders as
// the tab lists, so a sidebar badge can never disagree with what its tab
// shows. Exported so tests can enforce its tenant-scope contract.
export function buildInboxCountsQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
  now: Date,
) {
  const bucket = (filter: InboxFilter) =>
    sql<number>`coalesce(sum(case when ${and(...inboxFilterConditions(filter, now))} then 1 else 0 end), 0)`;
  return db
    .select({
      needsYou: bucket("needs-you"),
      all: bucket("all"),
      snoozed: bucket("snoozed"),
      resolved: bucket("resolved"),
      archived: bucket("archived"),
      flagged: bucket("flagged"),
    })
    .from(conversations)
    .where(eq(conversations.projectId, projectId));
}

// Close every open conversation a banned visitor has in the project (spam) in
// one guarded UPDATE … RETURNING — no select/update race, and already-closed
// rows are never relabelled. Matches by id OR email, mirroring
// VisitorBanService.isVisitorBanned.
export function buildBanSweepQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
  visitorId: string,
  visitorEmail?: string | null,
) {
  const visitorMatch = visitorEmail
    ? or(
        eq(conversations.visitorId, visitorId),
        eq(conversations.visitorEmail, visitorEmail),
      )!
    : eq(conversations.visitorId, visitorId);
  return db
    .update(conversations)
    .set({ status: "closed", closeReason: "spam" })
    .where(
      and(
        eq(conversations.projectId, projectId),
        ne(conversations.status, "closed"),
        visitorMatch,
      ),
    )
    .returning({ id: conversations.id });
}

export function buildAiResolutionQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationId: string,
  projectId: string,
  expectedChatState?: string | null,
  resolvedChatState?: string,
) {
  const conditions = [
    eq(conversations.id, conversationId),
    eq(conversations.projectId, projectId),
    inArray(conversations.status, ["active", "waiting_agent"]),
  ];
  if (expectedChatState !== undefined) {
    conditions.push(
      expectedChatState === null
        ? isNull(conversations.chatState)
        : eq(conversations.chatState, expectedChatState),
    );
  }
  return db
    .update(conversations)
    .set({
      status: "closed",
      closeReason: "bot_resolved",
      ...(resolvedChatState ? { chatState: resolvedChatState } : {}),
    })
    .where(and(...conditions))
    .returning({ id: conversations.id });
}

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
      conditions.push(...inboxFilterConditions(inboxFilter, now));
    } else {
      conditions.push(notArchivedCondition());
      if (statusFilter === "open") {
        conditions.push(ne(conversations.status, "closed"));
      } else if (statusFilter === "closed") {
        conditions.push(eq(conversations.status, "closed"));
      }
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
      .where(
        and(
          eq(conversations.projectId, projectId),
          notArchivedCondition(),
        ),
      )
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

  async setAssignee(
    conversationId: string,
    projectId: string,
    assigneeId: string | null,
  ): Promise<void> {
    await this.db.update(conversations)
      .set({ assigneeId })
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
    //
    // Gate on updatedAt, not lastActivityAt: every mutation bumps updatedAt
    // ($onUpdate), so a peer's snooze/flag/block reaches other dashboards'
    // polls too — those don't touch lastActivityAt and used to stay invisible
    // until a full refetch. Strict superset: activity bumps both columns.
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
        archivedAt: conversations.archivedAt,
        purgeStartedAt: conversations.purgeStartedAt,
        priority: conversations.priority,
        assigneeId: conversations.assigneeId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          gt(conversations.updatedAt, since),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows;
  }

  // See buildNeedsReviewQuery for the query semantics and why it's extracted.
  async getNeedsReviewSince(projectId: string, since: number): Promise<ConversationRow[]> {
    return buildNeedsReviewQuery(this.db, projectId, since, new Date());
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

  async resolveConversationByAi(
    id: string,
    projectId: string,
  ): Promise<boolean> {
    const conversation = await this.getConversationById(id, projectId);
    if (!conversation) return false;
    const currentState = parseChatState(conversation.chatState, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    });
    if (currentState.aiParticipation === "human_only") return false;
    const resolvedState = applyChatOwnershipEvent(
      currentState,
      "ai_handed_back",
    );
    const rows = await buildAiResolutionQuery(
      this.db,
      id,
      projectId,
      conversation.chatState,
      JSON.stringify(resolvedState),
    );
    return rows.length > 0;
  }

  async transitionChatOwnership(
    id: string,
    projectId: string,
    event: ChatOwnershipEvent,
  ): Promise<ConversationRow["status"] | null> {
    if (event === "team_requested") {
      await this.claimTeamRequest(id, projectId);
      const latest = await this.getConversationById(id, projectId);
      return latest?.status ?? null;
    }

    if (event === "human_joined") {
      const ownership = await this.takeHumanOwnership(id, projectId);
      return ownership?.status ?? null;
    }

    const conversation = await this.getConversationById(id, projectId);
    if (!conversation) return null;

    const currentState = parseChatState(conversation.chatState, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    });
    const nextState = applyChatOwnershipEvent(currentState, event);
    const status = "active";
    const ownershipConditions = [
      eq(conversations.id, id),
      eq(conversations.projectId, projectId),
      eq(conversations.status, conversation.status),
      conversation.chatState === null
        ? isNull(conversations.chatState)
        : eq(conversations.chatState, conversation.chatState),
    ];
    const updated = await this.db
      .update(conversations)
      .set({
        status,
        chatState: JSON.stringify(nextState),
        ...(event === "ai_handed_back" ? { closeReason: null } : {}),
      })
      .where(and(...ownershipConditions))
      .returning({ status: conversations.status });

    if (updated[0]) return updated[0].status;
    const latest = await this.getConversationById(id, projectId);
    return latest?.status ?? null;
  }

  async claimTeamRequest(id: string, projectId: string): Promise<boolean> {
    const conversation = await this.getConversationById(id, projectId);
    if (!conversation) return false;

    const currentState = parseChatState(conversation.chatState, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    });
    if (currentState.aiParticipation === "human_only") return false;

    const nextState = applyChatOwnershipEvent(currentState, "team_requested");
    const updated = await this.db
      .update(conversations)
      .set({
        status: "waiting_agent",
        chatState: JSON.stringify(nextState),
      })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.projectId, projectId),
          inArray(conversations.status, ["active", "waiting_agent"]),
          conversation.chatState === null
            ? isNull(conversations.chatState)
            : eq(conversations.chatState, conversation.chatState),
        ),
      )
      .returning({ id: conversations.id });

    return updated.length > 0;
  }

  async takeHumanOwnership(
    id: string,
    projectId: string,
  ): Promise<{
    status: ConversationRow["status"];
    chatState: string | null;
  } | null> {
    const rows = await buildHumanTakeoverQuery(this.db, id, projectId);
    return rows[0] ?? null;
  }

  async prepareContactSupportOwnership(
    id: string,
    projectId: string,
  ): Promise<"waiting_agent" | "agent_replied" | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const conversation = await this.getConversationById(id, projectId);
      if (!conversation) return null;
      const currentState = parseChatState(conversation.chatState, {
        fallbackAiParticipation: fallbackAiParticipationForStatus(
          conversation.status,
        ),
      });

      if (currentState.aiParticipation === "human_only") {
        const ownership = await this.takeHumanOwnership(id, projectId);
        return ownership ? "agent_replied" : null;
      }
      if (conversation.status === "closed") {
        await this.reopenConversation(id, projectId, "active");
        continue;
      }
      if (
        conversation.status === "active" ||
        conversation.status === "waiting_agent"
      ) {
        if (await this.claimTeamRequest(id, projectId)) {
          return "waiting_agent";
        }
        continue;
      }
      return null;
    }

    return null;
  }

  // Close every open conversation this visitor has in the project as spam, so
  // blocking clears them all out of the inbox views — not just the one the ban
  // was issued from (a banned visitor is 403'd, so leftovers would sit in
  // Needs You forever). Returns the closed ids so callers can broadcast each.
  async closeOpenConversationsAsSpam(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<string[]> {
    const rows = await buildBanSweepQuery(
      this.db,
      projectId,
      visitorId,
      visitorEmail,
    );
    return rows.map((r) => r.id);
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
    // Flagged-for-review conversations stay in Needs You until a human acts.
    if (conversation.status === "waiting_agent") return { closed: false, conversation };

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
        if (conv.status === "waiting_agent") return false;
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
    status: "active" | "agent_replied" = "active",
  ): Promise<ConversationRow | null> {
    const now = new Date();
    await this.db
      .update(conversations)
      .set({
        status,
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
    return parseChatState(conversation?.chatState ?? null, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation?.status ?? "active",
      ),
    });
  }

  async saveChatState(
    conversationId: string,
    projectId: string,
    chatState: ConversationChatState,
  ): Promise<void> {
    const conversation = await this.getConversationById(
      conversationId,
      projectId,
    );
    if (!conversation) return;
    const currentState = parseChatState(conversation.chatState, {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    });
    const stateToSave = mergeChatStateForPersistence(currentState, chatState);
    const chatStateCondition =
      conversation.chatState === null
        ? isNull(conversations.chatState)
        : eq(conversations.chatState, conversation.chatState);
    await this.db
      .update(conversations)
      .set({ chatState: JSON.stringify(stateToSave) })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          // Ownership transitions always change status. Comparing the status
          // we read makes this an optimistic write, so an in-flight AI turn
          // cannot overwrite a human takeover or a later explicit handback.
          eq(conversations.status, conversation.status),
          chatStateCondition,
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

  async hasVisitorMessages(conversationId: string): Promise<boolean> {
    const rows = await buildHasVisitorMessagesQuery(this.db, conversationId);
    return rows.length > 0;
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
      createdAt: now, emailedAt: null, deliveredAt: null, readAt: null,
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
      deliveredAt: null,
      readAt: null,
    };
  }

  async addVisitorMessageWithFirstTurn(
    data: Omit<NewMessageRow, "id" | "createdAt" | "role">,
  ): Promise<{ message: MessageRow; isFirstVisitorTurn: boolean }> {
    const id = crypto.randomUUID();
    const now = new Date();
    const insertQuery = this.db.insert(messages).values({
      id,
      createdAt: now,
      role: "visitor",
      ...data,
    });
    const activityQuery = this.db
      .update(conversations)
      .set({ updatedAt: now, lastActivityAt: now })
      .where(eq(conversations.id, data.conversationId));
    const countQuery = buildVisitorMessageCountQuery(
      this.db,
      data.conversationId,
    );
    const [, , countRows] = await this.db.batch([
      insertQuery,
      activityQuery,
      countQuery,
    ]);
    const visitorMessageCount = countRows[0]?.count ?? 0;
    const message: MessageRow = {
      id,
      conversationId: data.conversationId,
      role: "visitor",
      content: data.content,
      imageUrl: data.imageUrl ?? null,
      sources: data.sources ?? null,
      senderName: data.senderName ?? null,
      senderAvatar: data.senderAvatar ?? null,
      userId: data.userId ?? null,
      createdAt: now,
      emailedAt: null,
      deliveredAt: null,
      readAt: null,
    };
    return {
      message,
      isFirstVisitorTurn: visitorMessageCount === 1,
    };
  }

  async addAgentMessageAndTakeOwnership(
    data: Omit<NewMessageRow, "id" | "createdAt" | "role">,
    projectId: string,
  ): Promise<MessageRow | null> {
    const conversation = await this.getConversationById(
      data.conversationId,
      projectId,
    );
    if (!conversation) return null;

    const id = crypto.randomUUID();
    const now = new Date();
    const takeoverQuery = buildHumanTakeoverQuery(
      this.db,
      data.conversationId,
      projectId,
      now,
    );
    const insertQuery = this.db.insert(messages).values({
      id,
      createdAt: now,
      role: "agent",
      ...data,
    });
    await this.db.batch([takeoverQuery, insertQuery]);

    return {
      id,
      conversationId: data.conversationId,
      role: "agent",
      content: data.content,
      imageUrl: data.imageUrl ?? null,
      sources: data.sources ?? null,
      senderName: data.senderName ?? null,
      senderAvatar: data.senderAvatar ?? null,
      userId: data.userId ?? null,
      createdAt: now,
      emailedAt: null,
      deliveredAt: null,
      readAt: null,
    };
  }

  async addBotMessageIfOwnershipMatches(
    data: Omit<NewMessageRow, "id" | "createdAt" | "role">,
    projectId: string,
    expected: {
      status: ConversationRow["status"];
      chatState: string | null;
    },
  ): Promise<MessageRow | null> {
    const id = crypto.randomUUID();
    const now = new Date();
    const rows = await buildConditionalBotMessageQuery(this.db, {
      id,
      conversationId: data.conversationId,
      projectId,
      content: data.content,
      sources: data.sources ?? null,
      senderName: data.senderName ?? null,
      createdAt: now,
      expectedStatus: expected.status,
      expectedChatState: expected.chatState,
    });
    const botMessage = rows[0] ?? null;
    if (!botMessage) return null;

    await this.db
      .update(conversations)
      .set({ lastActivityAt: now })
      .where(
        and(
          eq(conversations.id, data.conversationId),
          eq(conversations.projectId, projectId),
        ),
      );
    return botMessage;
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

  // Mark all outbound (agent/bot) messages in the conversation up to and
  // including `cutoff` that aren't already delivered. Returns the ids that
  // were newly marked (empty when there's nothing to do — keeps re-acks silent).
  async markMessagesDelivered(
    conversationId: string,
    cutoff: Date,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.role, ["agent", "bot"]),
          isNull(messages.deliveredAt),
          lte(messages.createdAt, cutoff),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    await this.db
      .update(messages)
      .set({ deliveredAt: new Date() })
      .where(inArray(messages.id, ids));
    return ids;
  }

  // Mark outbound messages up to `cutoff` as read. Read implies delivered, so
  // any of those still missing `deliveredAt` get it backfilled. Returns the
  // ids that were newly marked read.
  async markMessagesRead(
    conversationId: string,
    cutoff: Date,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.role, ["agent", "bot"]),
          isNull(messages.readAt),
          lte(messages.createdAt, cutoff),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const now = new Date();
    await this.db
      .update(messages)
      .set({ readAt: now })
      .where(inArray(messages.id, ids));
    await this.db
      .update(messages)
      .set({ deliveredAt: now })
      .where(and(inArray(messages.id, ids), isNull(messages.deliveredAt)));
    return ids;
  }

  // Resolve a widget-supplied "newest message id" to its createdAt (guarding
  // that it belongs to this conversation) and mark delivered up to it.
  async markDeliveredUpTo(
    conversationId: string,
    upToMessageId: string,
  ): Promise<string[]> {
    const m = await this.getMessageById(upToMessageId);
    if (!m || m.conversationId !== conversationId) return [];
    return this.markMessagesDelivered(conversationId, m.createdAt);
  }

  async markReadUpTo(
    conversationId: string,
    upToMessageId: string,
  ): Promise<string[]> {
    const m = await this.getMessageById(upToMessageId);
    if (!m || m.conversationId !== conversationId) return [];
    return this.markMessagesRead(conversationId, m.createdAt);
  }

  // See buildInboxCountsQuery for the bucket semantics and why it's extracted.
  async getInboxCounts(projectId: string): Promise<Record<InboxFilter, number>> {
    const rows = await buildInboxCountsQuery(this.db, projectId, new Date());
    const r = rows[0];
    return {
      "needs-you": r?.needsYou ?? 0,
      all: r?.all ?? 0,
      snoozed: r?.snoozed ?? 0,
      resolved: r?.resolved ?? 0,
      archived: r?.archived ?? 0,
      flagged: r?.flagged ?? 0,
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
