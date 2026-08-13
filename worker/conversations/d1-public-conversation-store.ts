import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { parseMessageImageUrls, serializeMessageImageUrls } from "../../shared/message-images";
import { getLocalUploadKey } from "../../shared/upload-ownership";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import {
  conversations,
  messages,
  toolExecutions,
  type ConversationRow,
  type MessageRow,
} from "../db";
import { ChatService } from "../services/chat-service";
import type {
  AppendPublicHumanInput,
  AppendPublicBotInput,
  AppendPublicSystemInput,
  AppendPublicVisitorInput,
  AppendVisitorResult,
  CreatePublicConversationInput,
  DeletePublicMessageResult,
  LegacyPublicConversationCreateInput,
  LegacyPublicMessageInput,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationActionInput,
  PublicConversationAction,
  PublicBulkConversationActionResult,
  PublicConversationCounts,
  PublicConversationListQuery,
  PublicConversationListResult,
  PublicConversationStore,
  PublicConversationUpdatesQuery,
  PublicCustomerLinkInput,
  PublicCustomerMutationInput,
  PublicCustomerMutationResult,
  PublicDeliveryUpdateInput,
  PublicEmailUpdateInput,
  PublicExternalActionLease,
  PublicExternalActionLeaseInput,
  PublicInboxCounts,
  PublicConversationAnalytics,
  PublicMessageAttachmentSource,
  PublicRetentionClaim,
  PublicUsageConversationQuery,
  PublicUsageConversationResult,
  PublicLastMessagePreview,
  PublicLegacyEscalationMetadataUpdate,
  PublicMessagePage,
  PublicMessagesBeforeInput,
  PublicOwnershipTransitionInput,
  PublicOwnershipTransitionResult,
  PublicPresenceUpdateInput,
  PublicTeamRequestClaimInput,
  PublicTeamRequestClaimResult,
  PublicTeamRequestAcceptance,
  PublicTeamRequestSummaryInput,
} from "./public-conversation-store";

function toMillis(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

export function buildClaimExpiredArchivesQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationIds: string[],
  retentionCutoff: Date,
  staleClaimCutoff: Date,
  claimAt: Date,
) {
  return db
    .update(conversations)
    .set({ purgeStartedAt: claimAt })
    .where(
      and(
        inArray(conversations.id, conversationIds),
        lte(conversations.archivedAt, retentionCutoff),
        or(
          isNull(conversations.purgeStartedAt),
          lte(conversations.purgeStartedAt, staleClaimCutoff),
        ),
      ),
    )
    .returning({
      id: conversations.id,
      projectId: conversations.projectId,
      purgeStartedAt: conversations.purgeStartedAt,
    });
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isPublicSourceReference(value: unknown): value is PublicSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.title === "string" &&
    (source.url === null || typeof source.url === "string") &&
    (source.type === "webpage" || source.type === "pdf" || source.type === "faq")
  );
}

function parseMessageSources(raw: string | null): PublicSourceReference[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPublicSourceReference) : [];
  } catch {
    return [];
  }
}

function parseSystemKind(raw: string | null): string | null {
  const parsed = parseJsonRecord(raw);
  return typeof parsed.systemKind === "string" ? parsed.systemKind : null;
}

export function mapD1ConversationRow(
  row: ConversationRow,
): PublicConversationRecord {
  const chatState = parseJsonRecord(row.chatState);
  const rawOwnershipRevision = chatState.ownershipRevision;
  const ownershipRevision =
    typeof rawOwnershipRevision === "number" &&
    Number.isFinite(rawOwnershipRevision)
      ? Math.max(0, Math.floor(rawOwnershipRevision))
      : 0;

  return {
    id: row.id,
    projectId: row.projectId,
    customerId: row.customerId,
    visitorId: row.visitorId,
    visitorName: row.visitorName,
    visitorEmail: row.visitorEmail,
    status: row.status,
    closeReason: row.closeReason,
    telegramThreadId: row.telegramThreadId,
    metadata: parseJsonRecord(row.metadata),
    chatState,
    lastActivityAt: row.lastActivityAt?.getTime() ?? row.createdAt.getTime(),
    visitorLastSeenAt: toMillis(row.visitorLastSeenAt),
    visitorPresence: row.visitorPresence ?? "active",
    visitorLastOnlineAt: toMillis(row.visitorLastOnlineAt),
    snoozedUntil: toMillis(row.snoozedUntil),
    archivedAt: toMillis(row.archivedAt),
    purgeStartedAt: toMillis(row.purgeStartedAt),
    externalActionStartedAt: toMillis(row.externalActionStartedAt),
    priority: row.priority ?? "medium",
    assigneeId: row.assigneeId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ownershipRevision,
  };
}

export function mapD1MessageRow(row: MessageRow): PublicMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: row.role,
    content: row.content,
    imageUrls: parseMessageImageUrls(row.imageUrl),
    sources: parseMessageSources(row.sources),
    senderName: row.senderName,
    senderAvatar: row.senderAvatar,
    userId: row.userId,
    systemKind: parseSystemKind(row.sources),
    createdAt: row.createdAt.getTime(),
    deliveredAt: toMillis(row.deliveredAt),
    readAt: toMillis(row.readAt),
    emailedAt: toMillis(row.emailedAt),
  };
}

function serializeSources(sources: PublicSourceReference[] | undefined): string | null {
  return sources && sources.length > 0 ? JSON.stringify(sources) : null;
}

export class D1PublicConversationStore implements PublicConversationStore {
  private readonly chatService: ChatService;

  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {
    this.chatService = new ChatService(db);
  }

  private async belongsToProject(
    projectId: string,
    conversationId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.chatService.getConversationById(conversationId, projectId),
    );
  }

  async create(input: CreatePublicConversationInput): Promise<PublicConversationRecord> {
    const row = await this.chatService.createConversation({
      projectId: input.projectId,
      customerId: input.customerId ?? null,
      visitorId: input.visitorId,
      visitorName: input.visitorName ?? null,
      visitorEmail: input.visitorEmail ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      status: "active",
      closeReason: null,
      telegramThreadId: null,
      chatState: null,
      lastActivityAt: new Date(),
      visitorLastSeenAt: null,
      visitorPresence: "active",
      visitorLastOnlineAt: null,
      snoozedUntil: null,
      archivedAt: null,
      purgeStartedAt: null,
      externalActionStartedAt: null,
      priority: "medium",
      assigneeId: null,
    });
    return mapD1ConversationRow(row);
  }

  async get(projectId: string, conversationId: string): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.getConversationById(conversationId, projectId);
    return row ? mapD1ConversationRow(row) : null;
  }

  async getOperational(projectId: string, conversationId: string): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.getOperationalConversationById(
      conversationId,
      projectId,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async getActiveByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.getActiveConversationByVisitor(projectId, visitorId);
    return row ? mapD1ConversationRow(row) : null;
  }

  async getLastByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.getLastConversationByVisitor(projectId, visitorId);
    return row ? mapD1ConversationRow(row) : null;
  }

  async getRecentByVisitorEmail(projectId: string, email: string): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.getRecentConversationByVisitorEmail(projectId, email);
    return row ? mapD1ConversationRow(row) : null;
  }

  async list(query: PublicConversationListQuery): Promise<PublicConversationListResult> {
    const rows = await this.chatService.getConversationsByProject(
      query.projectId,
      query.limit,
      query.offset,
      query.status,
      query.search,
      query.inboxFilter,
    );
    return { conversations: rows.map(mapD1ConversationRow) };
  }

  async getConversationCounts(projectId: string): Promise<PublicConversationCounts> {
    return this.chatService.getConversationCounts(projectId);
  }

  async bulkApplyActions(
    projectId: string,
    conversationIds: string[],
    action: PublicConversationAction,
  ): Promise<PublicBulkConversationActionResult> {
    return this.chatService.bulkUpdateConversations(
      projectId,
      conversationIds,
      action,
    );
  }

  async listUpdates(query: PublicConversationUpdatesQuery): Promise<PublicConversationRecord[]> {
    const rows = await this.chatService.getConversationUpdatesSince(
      query.projectId,
      new Date(query.since),
      query.limit,
    );
    const records = await Promise.all(
      rows.map((row) => this.get(query.projectId, row.id)),
    );
    return records.filter((record): record is PublicConversationRecord => record !== null);
  }

  async listNeedsReview(projectId: string, since: number): Promise<PublicConversationRecord[]> {
    return (await this.chatService.getNeedsReviewSince(projectId, since)).map(mapD1ConversationRow);
  }

  async listAgentMode(projectId: string): Promise<PublicConversationRecord[]> {
    return (await this.chatService.getAgentModeConversations(projectId)).map(mapD1ConversationRow);
  }

  async listByCustomer(projectId: string, customerId: string): Promise<PublicConversationRecord[]> {
    return (await this.chatService.getConversationsByCustomer(projectId, customerId)).map(mapD1ConversationRow);
  }

  async getConversationCountsByCustomer(
    projectId: string,
    customerIds: string[],
  ): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db
      .select({ customerId: conversations.customerId, count: count() })
      .from(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          inArray(conversations.customerId, customerIds),
        ),
      )
      .groupBy(conversations.customerId);
    return new Map(
      rows.flatMap((row) =>
        row.customerId ? [[row.customerId, row.count] as const] : [],
      ),
    );
  }

  async listByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord[]> {
    return (await this.chatService.getConversationsByVisitor(projectId, visitorId)).map(mapD1ConversationRow);
  }

  async getInboxCounts(projectId: string): Promise<PublicInboxCounts> {
    return this.chatService.getInboxCounts(projectId);
  }

  async getLastMessagePreviews(
    conversationIds: string[],
  ): Promise<Map<string, PublicLastMessagePreview>> {
    const rows = await this.chatService.getLastPublicMessagesByConversationIds(
      conversationIds,
    );
    return new Map(
      [...rows].map(([conversationId, row]) => [
        conversationId,
        {
          id: row.id,
          author: row.role,
          content: row.content,
          senderName: row.senderName,
          emailedAt: toMillis(row.emailedAt),
          createdAt: row.createdAt.getTime(),
        },
      ]),
    );
  }

  async getMessages(projectId: string, conversationId: string): Promise<PublicMessageRecord[]> {
    if (!(await this.belongsToProject(projectId, conversationId))) return [];
    return (await this.chatService.getPublicMessages(conversationId)).map(mapD1MessageRow);
  }

  async getRecentMessages(projectId: string, conversationId: string, limit: number): Promise<PublicMessagePage> {
    if (!(await this.belongsToProject(projectId, conversationId))) {
      return { messages: [], hasMore: false };
    }
    const page = await this.chatService.getRecentPublicMessages(conversationId, limit);
    return { messages: page.messages.map(mapD1MessageRow), hasMore: page.hasMore };
  }

  async getMessagesBefore(input: PublicMessagesBeforeInput): Promise<PublicMessagePage> {
    if (!(await this.belongsToProject(input.projectId, input.conversationId))) {
      return { messages: [], hasMore: false };
    }
    const page = await this.chatService.getPublicMessagesBefore(
      input.conversationId,
      new Date(input.beforeCreatedAt),
      input.limit,
    );
    return { messages: page.messages.map(mapD1MessageRow), hasMore: page.hasMore };
  }

  async getMessagesSince(projectId: string, conversationId: string, since: number): Promise<PublicMessageRecord[]> {
    if (!(await this.belongsToProject(projectId, conversationId))) return [];
    return (await this.chatService.getPublicMessagesSince(conversationId, since)).map(mapD1MessageRow);
  }

  async getMessage(projectId: string, conversationId: string, messageId: string): Promise<PublicMessageRecord | null> {
    const conversation = await this.chatService.getConversationById(conversationId, projectId);
    if (!conversation) return null;
    const message = await this.chatService.getPublicMessageById(messageId);
    return message?.conversationId === conversationId ? mapD1MessageRow(message) : null;
  }

  async hasVisitorMessages(projectId: string, conversationId: string): Promise<boolean> {
    if (!(await this.belongsToProject(projectId, conversationId))) return false;
    return this.chatService.hasPublicVisitorMessages(conversationId);
  }

  async getLatestEmailedHumanMessage(projectId: string, conversationId: string): Promise<PublicMessageRecord | null> {
    if (!(await this.belongsToProject(projectId, conversationId))) return null;
    const row = await this.chatService.getLatestEmailedPublicAgentMessage(conversationId);
    return row ? mapD1MessageRow(row) : null;
  }

  async appendVisitor(input: AppendPublicVisitorInput): Promise<AppendVisitorResult | null> {
    const result = await this.chatService.addPublicVisitorMessageWithFirstTurn(
      {
        conversationId: input.conversationId,
        content: input.content,
        imageUrl: serializeMessageImageUrls(input.imageUrls ?? []),
        sources: serializeSources(input.sources),
        senderName: input.senderName ?? null,
        senderAvatar: input.senderAvatar ?? null,
        userId: input.userId ?? null,
        emailedAt: null,
        deliveredAt: null,
        readAt: null,
      },
      input.projectId,
    );
    return result
      ? { message: mapD1MessageRow(result.message), isFirstVisitorTurn: result.isFirstVisitorTurn }
      : null;
  }

  async appendHuman(input: AppendPublicHumanInput): Promise<PublicMessageRecord> {
    const row = await this.chatService.addPublicAgentMessageAndTakeOwnership(
      {
        conversationId: input.conversationId,
        content: input.content,
        imageUrl: serializeMessageImageUrls(input.imageUrls ?? []),
        sources: serializeSources(input.sources),
        senderName: input.senderName ?? null,
        senderAvatar: input.senderAvatar ?? null,
        userId: input.userId ?? null,
        emailedAt: null,
        deliveredAt: null,
        readAt: null,
      },
      input.projectId,
    );
    if (!row) throw new Error("Conversation is not available for a human reply");
    return mapD1MessageRow(row);
  }

  async appendBot(input: AppendPublicBotInput): Promise<PublicMessageRecord | null> {
    const row = await this.chatService.addPublicBotMessageIfOwnershipMatches(
      {
        conversationId: input.conversationId,
        content: input.content,
        imageUrl: serializeMessageImageUrls(input.imageUrls ?? []),
        sources: serializeSources(input.sources),
        senderName: input.senderName ?? null,
        senderAvatar: input.senderAvatar ?? null,
        userId: input.userId ?? null,
        emailedAt: null,
        deliveredAt: null,
        readAt: null,
      },
      input.projectId,
      input.expected,
    );
    return row ? mapD1MessageRow(row) : null;
  }

  async appendSystem(input: AppendPublicSystemInput): Promise<PublicMessageRecord> {
    if (!(await this.belongsToProject(input.projectId, input.conversationId))) {
      throw new Error("Conversation is not available for a system event");
    }
    const row = await this.chatService.addPublicSystemMessage(
      input.conversationId,
      input.kind,
      input.content,
      input.idempotencyKey,
    );
    if (!row) throw new Error("Conversation is not available for a system event");
    return mapD1MessageRow(row);
  }

  async deleteHumanMessage(projectId: string, conversationId: string, messageId: string): Promise<DeletePublicMessageResult> {
    if (!(await this.belongsToProject(projectId, conversationId))) {
      return { deleted: false, reason: "not_found" };
    }
    const result = await this.chatService.deletePublicAgentMessage(conversationId, messageId);
    const response: DeletePublicMessageResult = {
      deleted: result.deleted,
      reason: result.reason,
    };
    if (result.row) response.message = mapD1MessageRow(result.row);
    return response;
  }

  async applyAction(input: PublicConversationActionInput): Promise<PublicConversationRecord | null> {
    const result = await this.chatService.bulkUpdateConversations(
      input.projectId,
      [input.conversationId],
      input.action,
    );
    return result.updatedIds.length > 0
      ? this.get(input.projectId, input.conversationId)
      : null;
  }

  async transitionOwnership(input: PublicOwnershipTransitionInput): Promise<PublicOwnershipTransitionResult> {
    const status = await this.chatService.transitionChatOwnership(
      input.conversationId,
      input.projectId,
      input.event,
    );
    return {
      status,
      conversation: await this.get(input.projectId, input.conversationId),
    };
  }

  async takeHumanOwnership(
    projectId: string,
    conversationId: string,
  ): Promise<{
    status: PublicConversationRecord["status"];
    chatState: string | null;
  } | null> {
    return this.chatService.takeHumanOwnership(conversationId, projectId);
  }

  async resolveByAi(projectId: string, conversationId: string): Promise<boolean> {
    return this.chatService.resolveConversationByAi(conversationId, projectId);
  }

  async setStatus(
    projectId: string,
    conversationId: string,
    status: PublicConversationRecord["status"],
    closeReason?: PublicConversationRecord["closeReason"],
  ): Promise<PublicConversationRecord | null> {
    await this.chatService.updateConversationStatus(
      conversationId,
      projectId,
      status,
      closeReason ?? undefined,
    );
    return this.get(projectId, conversationId);
  }

  async reopen(
    projectId: string,
    conversationId: string,
    status: "active" | "agent_replied" = "active",
  ): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.reopenConversation(
      conversationId,
      projectId,
      status,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async checkAndCloseStale(
    projectId: string,
    conversationId: string,
    autoCloseMinutes: number,
  ): Promise<{ closed: boolean; conversation: PublicConversationRecord | null }> {
    const result = await this.chatService.checkAndCloseStale(
      conversationId,
      projectId,
      autoCloseMinutes,
    );
    return {
      closed: result.closed,
      conversation: result.conversation
        ? mapD1ConversationRow(result.conversation)
        : null,
    };
  }

  async checkAndCloseStaleForProject(
    projectId: string,
    conversationRecords: PublicConversationRecord[],
    autoCloseMinutes: number,
  ): Promise<string[]> {
    const rows = await Promise.all(
      conversationRecords.map((conversation) =>
        this.chatService.getConversationById(conversation.id, projectId),
      ),
    );
    return this.chatService.checkAndCloseStaleForProject(
      rows.filter((row): row is ConversationRow => row !== null),
      autoCloseMinutes,
    );
  }

  async prepareContactSupportOwnership(
    projectId: string,
    conversationId: string,
  ): Promise<"waiting_agent" | "agent_replied" | null> {
    return this.chatService.prepareContactSupportOwnership(
      conversationId,
      projectId,
    );
  }

  async closeOpenAsSpam(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<string[]> {
    return this.chatService.closeOpenConversationsAsSpam(
      projectId,
      visitorId,
      visitorEmail,
    );
  }

  async claimTeamRequest(input: PublicTeamRequestClaimInput): Promise<PublicTeamRequestClaimResult> {
    return this.chatService.claimNewTeamRequest(
      input.conversationId,
      input.projectId,
      input.summary,
    );
  }

  async getTeamRequestAcceptance(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicTeamRequestAcceptance | null> {
    return this.chatService.getNewTeamRequestAcceptance(
      conversationId,
      projectId,
      acceptanceToken,
    );
  }

  async claimTeamRequestNotification(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<boolean> {
    return this.chatService.claimNewTeamRequestNotification(
      conversationId,
      projectId,
      acceptanceToken,
    );
  }

  async addTeamRequestSummary(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicMessageRecord | null> {
    const row = await this.chatService.addNewTeamRequestSummary(
      conversationId,
      projectId,
      acceptanceToken,
    );
    return row ? mapD1MessageRow(row) : null;
  }

  async completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean> {
    return this.chatService.completeNewTeamRequestSummary(
      input.conversationId,
      input.projectId,
      input.acceptanceToken,
    );
  }

  async updateLegacyEscalationMetadata(
    projectId: string,
    conversationId: string,
    update: PublicLegacyEscalationMetadataUpdate,
  ): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateLegacyEscalationMetadata(
      conversationId,
      projectId,
      update,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async persistTeamRequestTelegramThreadId(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
    threadId: string,
  ): Promise<boolean> {
    return this.chatService.persistNewTeamRequestTelegramThreadId(
      conversationId,
      projectId,
      acceptanceToken,
      threadId,
    );
  }

  async updateTelegramThreadId(
    projectId: string,
    conversationId: string,
    threadId: string,
  ): Promise<void> {
    await this.chatService.updateTelegramThreadId(
      conversationId,
      projectId,
      threadId,
    );
  }

  async acquireExternalAction(input: PublicExternalActionLeaseInput): Promise<PublicExternalActionLease | null> {
    const lease = await this.chatService.acquireExternalActionLease(
      input.conversationId,
      input.projectId,
      input.ownership,
      input.now === undefined ? undefined : new Date(input.now),
    );
    if (!lease) return null;
    return {
      projectId: input.projectId,
      conversationId: input.conversationId,
      leaseId: `${input.conversationId}:${lease.acquiredAt.getTime()}`,
      ownershipRevision: lease.ownershipRevision,
      acquiredAt: lease.acquiredAt.getTime(),
    };
  }

  async releaseExternalAction(input: PublicExternalActionLease): Promise<void> {
    await this.chatService.releaseExternalActionLease(
      input.conversationId,
      input.projectId,
      new Date(input.acquiredAt),
    );
  }

  async markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]> {
    if (!(await this.belongsToProject(input.projectId, input.conversationId))) {
      return [];
    }
    return input.kind === "read"
      ? this.chatService.markPublicReadUpTo(input.conversationId, input.upToMessageId)
      : this.chatService.markPublicDeliveredUpTo(input.conversationId, input.upToMessageId);
  }

  async markEmailed(input: PublicEmailUpdateInput): Promise<boolean> {
    const message = await this.getMessage(input.projectId, input.conversationId, input.messageId);
    if (!message) return false;
    await this.chatService.markPublicMessageAsEmailed(input.conversationId, input.messageId);
    return true;
  }

  async updatePresence(input: PublicPresenceUpdateInput): Promise<PublicChatChildState | null> {
    const row = await this.chatService.updateVisitorLastSeen(
      input.conversationId,
      input.projectId,
      input.presence,
    );
    if (!row) return null;
    const record = mapD1ConversationRow(row);
    return {
      status: record.status,
      visitorPresence: record.visitorPresence,
      visitorLastOnlineAt: record.visitorLastOnlineAt,
      archived: record.archivedAt !== null,
      revision: record.ownershipRevision,
    };
  }

  async updateEmail(
    projectId: string,
    conversationId: string,
    email: string,
  ): Promise<void> {
    await this.chatService.updateConversationEmail(
      conversationId,
      projectId,
      email,
    );
  }

  async updateContact(input: PublicContactUpdateInput): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateConversation(
      input.conversationId,
      input.projectId,
      {
        visitorName: input.visitorName,
        visitorEmail: input.visitorEmail,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      },
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async updatePendingTeamRequestContact(
    projectId: string,
    conversationId: string,
    ownership: { status: string; chatState: string | null },
    update: {
      visitorName?: string;
      visitorEmail?: string;
      awaitingContactFields: Array<"name" | "email">;
      contactDeclined?: boolean;
    },
  ): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updatePendingTeamRequestContact(
      conversationId,
      projectId,
      ownership,
      update,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async getChatState(projectId: string, conversationId: string) {
    return this.chatService.getChatState(conversationId, projectId);
  }

  async saveChatState(
    projectId: string,
    conversationId: string,
    chatState: Awaited<ReturnType<ChatService["getChatState"]>>,
  ): Promise<void> {
    await this.chatService.saveChatState(
      conversationId,
      projectId,
      chatState,
    );
  }

  async updateCustomer(input: PublicCustomerLinkInput): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateConversationCustomer(
      input.conversationId,
      input.projectId,
      input.customerId,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async applyCustomerMutation(
    input: PublicCustomerMutationInput,
  ): Promise<PublicCustomerMutationResult> {
    const updatedIds: string[] = [];
    for (const update of input.updates) {
      const conversation = await this.updateCustomer({
        projectId: input.projectId,
        conversationId: update.conversationId,
        customerId: update.customerId,
      });
      if (!conversation) continue;
      if (
        update.visitorName !== undefined ||
        update.visitorEmail !== undefined
      ) {
        await this.updateContact({
          projectId: input.projectId,
          conversationId: update.conversationId,
          ...(update.visitorName === undefined
            ? {}
            : { visitorName: update.visitorName }),
          ...(update.visitorEmail === undefined
            ? {}
            : { visitorEmail: update.visitorEmail }),
        });
      }
      updatedIds.push(update.conversationId);
    }
    return { status: "completed", updatedIds };
  }

  async getAnalytics(
    projectIds: string[],
    since: number,
  ): Promise<PublicConversationAnalytics> {
    if (projectIds.length === 0) {
      return {
        totalConversations: 0,
        activeConversations: 0,
        totalMessages: 0,
        conversationsByDay: [],
        conversationsByStatus: [],
        recentConversations: [],
      };
    }

    const projectFilter = inArray(conversations.projectId, projectIds);
    const [conversationCounts, messageCounts, conversationsByDay, conversationsByStatus, recentRows] =
      await Promise.all([
        this.db
          .select({
            total: count(),
            active: sql<number>`SUM(CASE WHEN ${conversations.status} IN ('active', 'waiting_agent') THEN 1 ELSE 0 END)`,
          })
          .from(conversations)
          .where(projectFilter),
        this.db
          .select({ total: count() })
          .from(messages)
          .innerJoin(
            conversations,
            eq(messages.conversationId, conversations.id),
          )
          .where(projectFilter),
        this.db
          .select({
            day: sql<string>`date(${conversations.createdAt}, 'unixepoch')`.as("day"),
            count: count(),
          })
          .from(conversations)
          .where(
            and(
              projectFilter,
              sql`${conversations.createdAt} >= ${Math.floor(since / 1000)}`,
            ),
          )
          .groupBy(sql`date(${conversations.createdAt}, 'unixepoch')`)
          .orderBy(sql`date(${conversations.createdAt}, 'unixepoch')`),
        this.db
          .select({ status: conversations.status, count: count() })
          .from(conversations)
          .where(projectFilter)
          .groupBy(conversations.status),
        this.db
          .select()
          .from(conversations)
          .where(projectFilter)
          .orderBy(
            desc(
              sql`case
                when ${conversations.visitorLastSeenAt} is not null
                  and ${conversations.visitorLastSeenAt} > ${conversations.updatedAt}
                then ${conversations.visitorLastSeenAt}
                else ${conversations.updatedAt}
              end`,
            ),
            desc(conversations.updatedAt),
          )
          .limit(5),
      ]);

    return {
      totalConversations: conversationCounts[0]?.total ?? 0,
      activeConversations: conversationCounts[0]?.active ?? 0,
      totalMessages: messageCounts[0]?.total ?? 0,
      conversationsByDay,
      conversationsByStatus,
      recentConversations: recentRows.map(mapD1ConversationRow),
    };
  }

  async queryUsageConversations(
    query: PublicUsageConversationQuery,
  ): Promise<PublicUsageConversationResult> {
    if (query.projectIds.length === 0) {
      return { rows: [], total: 0, metaKeys: [] };
    }

    const conditions = [
      inArray(conversations.projectId, query.projectIds),
      sql`${conversations.createdAt} >= ${Math.floor(query.periodStart / 1000)}`,
      sql`${conversations.createdAt} < ${Math.floor(query.periodEnd / 1000)}`,
    ];
    if (query.status) {
      conditions.push(
        eq(
          conversations.status,
          query.status as PublicConversationRecord["status"],
        ),
      );
    }
    if (query.metaKey && query.metaValue) {
      const escapedValue = query.metaValue
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      conditions.push(
        sql`json_extract(${conversations.metadata}, '$.' || ${query.metaKey}) LIKE ${`%${escapedValue}%`} ESCAPE '\\'`,
      );
    }
    const whereClause = and(...conditions)!;
    const orderExpression =
      query.sortBy === "botMessages"
        ? query.sortOrder === "asc"
          ? asc(sql`bot_count`)
          : desc(sql`bot_count`)
        : query.sortOrder === "asc"
          ? asc(conversations.createdAt)
          : desc(conversations.createdAt);

    const [rows, countRows, metadataRows] = await Promise.all([
      this.db
        .select({
          id: conversations.id,
          projectId: conversations.projectId,
          visitorName: conversations.visitorName,
          visitorEmail: conversations.visitorEmail,
          status: conversations.status,
          metadata: conversations.metadata,
          createdAt: conversations.createdAt,
          botCount: sql<number>`count(case when ${messages.role} = 'bot' then 1 end)`.as("bot_count"),
        })
        .from(conversations)
        .leftJoin(messages, eq(messages.conversationId, conversations.id))
        .where(whereClause)
        .groupBy(conversations.id)
        .orderBy(orderExpression)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(distinct ${conversations.id})` })
        .from(conversations)
        .where(whereClause),
      this.db
        .select({ metadata: conversations.metadata })
        .from(conversations)
        .where(
          and(
            inArray(conversations.projectId, query.projectIds),
            sql`${conversations.createdAt} >= ${Math.floor(query.periodStart / 1000)}`,
            sql`${conversations.createdAt} < ${Math.floor(query.periodEnd / 1000)}`,
            isNotNull(conversations.metadata),
          ),
        )
        .limit(200),
    ]);

    const metaKeys = new Set<string>();
    for (const row of metadataRows) {
      for (const key of Object.keys(parseJsonRecord(row.metadata))) {
        metaKeys.add(key);
      }
    }

    return {
      rows: rows.map((row) => ({
        conversation: {
          id: row.id,
          projectId: row.projectId,
          customerId: null,
          visitorId: "",
          visitorName: row.visitorName,
          visitorEmail: row.visitorEmail,
          status: row.status,
          closeReason: null,
          telegramThreadId: null,
          metadata: parseJsonRecord(row.metadata),
          chatState: {},
          lastActivityAt: row.createdAt.getTime(),
          visitorLastSeenAt: null,
          visitorPresence: "active",
          visitorLastOnlineAt: null,
          snoozedUntil: null,
          archivedAt: null,
          purgeStartedAt: null,
          externalActionStartedAt: null,
          priority: "medium",
          assigneeId: null,
          createdAt: row.createdAt.getTime(),
          updatedAt: row.createdAt.getTime(),
          ownershipRevision: 0,
        },
        botMessageCount: row.botCount ?? 0,
      })),
      total: countRows[0]?.count ?? 0,
      metaKeys: [...metaKeys].sort(),
    };
  }

  async claimExpiredArchives(
    retentionCutoff: number,
    staleClaimCutoff: number,
    claimAt: number,
    limit: number,
  ): Promise<PublicRetentionClaim[]> {
    const retentionCutoffDate = new Date(retentionCutoff);
    const staleClaimCutoffDate = new Date(staleClaimCutoff);
    const claimAtDate = new Date(claimAt);
    const candidates = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          lte(conversations.archivedAt, retentionCutoffDate),
          or(
            isNull(conversations.purgeStartedAt),
            lte(conversations.purgeStartedAt, staleClaimCutoffDate),
          ),
        ),
      )
      .orderBy(asc(conversations.archivedAt))
      .limit(limit);
    if (candidates.length === 0) return [];

    const rows = await this.db
      .update(conversations)
      .set({ purgeStartedAt: claimAtDate })
      .where(
        and(
          inArray(
            conversations.id,
            candidates.map((candidate) => candidate.id),
          ),
          lte(conversations.archivedAt, retentionCutoffDate),
          or(
            isNull(conversations.purgeStartedAt),
            lte(conversations.purgeStartedAt, staleClaimCutoffDate),
          ),
        ),
      )
      .returning({
        id: conversations.id,
        projectId: conversations.projectId,
        purgeStartedAt: conversations.purgeStartedAt,
      });

    return rows.flatMap((row) =>
      row.purgeStartedAt
        ? [{
            id: row.id,
            projectId: row.projectId,
            purgeStartedAt: row.purgeStartedAt.getTime(),
          }]
        : [],
    );
  }

  async listMessageAttachments(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageAttachmentSource[]> {
    const rows = await this.db
      .select({
        author: messages.role,
        userId: messages.userId,
        imageUrl: messages.imageUrl,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.id, conversationId),
        ),
      );
    return rows.map((row) => ({
      author: row.author,
      userId: row.userId,
      imageUrls: parseMessageImageUrls(row.imageUrl),
    }));
  }

  async isUploadKeyReferencedElsewhere(
    key: string,
    conversationId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ imageUrl: messages.imageUrl })
      .from(messages)
      .where(
        and(
          ne(messages.conversationId, conversationId),
          sql`instr(${messages.imageUrl}, ${key}) > 0`,
        ),
      );
    return rows.some((row) =>
      parseMessageImageUrls(row.imageUrl).some((imageUrl) =>
        getLocalUploadKey(imageUrl) === key,
      ),
    );
  }

  async deleteRetentionClaim(
    projectId: string,
    conversationId: string,
    purgeStartedAt: number,
  ): Promise<boolean> {
    await this.db
      .delete(toolExecutions)
      .where(eq(toolExecutions.conversationId, conversationId));
    const rows = await this.db
      .delete(conversations)
      .where(
        and(
          eq(conversations.projectId, projectId),
          eq(conversations.id, conversationId),
          eq(conversations.purgeStartedAt, new Date(purgeStartedAt)),
        ),
      )
      .returning({ id: conversations.id });
    return rows.length === 1;
  }

  async getConversationById(
    conversationId: string,
    projectId: string,
  ): Promise<PublicConversationRecord | null> {
    return this.get(projectId, conversationId);
  }

  async getOperationalConversationById(
    conversationId: string,
    projectId: string,
  ): Promise<PublicConversationRecord | null> {
    return this.getOperational(projectId, conversationId);
  }

  async getActiveConversationByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord | null> {
    return this.getActiveByVisitor(projectId, visitorId);
  }

  async getLastConversationByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord | null> {
    return this.getLastByVisitor(projectId, visitorId);
  }

  async getRecentConversationByVisitorEmail(
    projectId: string,
    email: string,
  ): Promise<PublicConversationRecord | null> {
    return this.getRecentByVisitorEmail(projectId, email);
  }

  async createConversation(
    input: LegacyPublicConversationCreateInput,
  ): Promise<PublicConversationRecord> {
    return this.create({
      ...input,
      metadata: parseJsonRecord(input.metadata ?? null),
    });
  }

  async getConversationsByProject(
    projectId: string,
    limit?: number,
    offset?: number,
    status?: "open" | "closed" | "all",
    search?: string,
    inboxFilter?: import("./public-conversation-store").PublicInboxFilter,
  ): Promise<PublicConversationRecord[]> {
    return (await this.list({
      projectId,
      limit,
      offset,
      status,
      search,
      inboxFilter,
    })).conversations;
  }

  async getConversationUpdatesSince(
    projectId: string,
    since: Date,
    limit?: number,
  ): Promise<PublicConversationRecord[]> {
    return this.listUpdates({ projectId, since: since.getTime(), limit });
  }

  async getNeedsReviewSince(
    projectId: string,
    since: number,
  ): Promise<PublicConversationRecord[]> {
    return this.listNeedsReview(projectId, since);
  }

  async getAgentModeConversations(
    projectId: string,
  ): Promise<PublicConversationRecord[]> {
    return this.listAgentMode(projectId);
  }

  async getLastPublicMessagesByConversationIds(
    conversationIds: string[],
  ): Promise<Map<string, PublicLastMessagePreview>> {
    return this.getLastMessagePreviews(conversationIds);
  }

  async getPublicMessages(
    conversationId: string,
    projectId?: string,
  ): Promise<PublicMessageRecord[]> {
    if (projectId) return this.getMessages(projectId, conversationId);
    return (await this.chatService.getPublicMessages(conversationId)).map(
      mapD1MessageRow,
    );
  }

  async getRecentPublicMessages(
    conversationId: string,
    limit = 30,
    projectId?: string,
  ): Promise<PublicMessagePage> {
    if (projectId) return this.getRecentMessages(projectId, conversationId, limit);
    const page = await this.chatService.getRecentPublicMessages(
      conversationId,
      limit,
    );
    return { messages: page.messages.map(mapD1MessageRow), hasMore: page.hasMore };
  }

  async getPublicMessagesBefore(
    conversationId: string,
    beforeCreatedAt: Date,
    limit = 30,
    projectId?: string,
  ): Promise<PublicMessagePage> {
    if (projectId) {
      return this.getMessagesBefore({
        projectId,
        conversationId,
        beforeCreatedAt: beforeCreatedAt.getTime(),
        limit,
      });
    }
    const page = await this.chatService.getPublicMessagesBefore(
      conversationId,
      beforeCreatedAt,
      limit,
    );
    return { messages: page.messages.map(mapD1MessageRow), hasMore: page.hasMore };
  }

  async getPublicMessagesSince(
    conversationId: string,
    since: number,
    projectId?: string,
  ): Promise<PublicMessageRecord[]> {
    if (projectId) return this.getMessagesSince(projectId, conversationId, since);
    return (await this.chatService.getPublicMessagesSince(conversationId, since)).map(
      mapD1MessageRow,
    );
  }

  async getPublicMessageById(
    messageId: string,
    projectId?: string,
    conversationId?: string,
  ): Promise<PublicMessageRecord | null> {
    if (projectId && conversationId) {
      return this.getMessage(projectId, conversationId, messageId);
    }
    const row = await this.chatService.getPublicMessageById(messageId);
    return row ? mapD1MessageRow(row) : null;
  }

  async addPublicVisitorMessageWithFirstTurn(
    input: LegacyPublicMessageInput,
    projectId: string,
  ): Promise<AppendVisitorResult | null> {
    return this.appendVisitor({
      projectId,
      conversationId: input.conversationId,
      content: input.content,
      imageUrls: parseMessageImageUrls(input.imageUrl),
      sources: parseMessageSources(input.sources ?? null),
      senderName: input.senderName,
      senderAvatar: input.senderAvatar,
      userId: input.userId,
    });
  }

  async addPublicAgentMessageAndTakeOwnership(
    input: LegacyPublicMessageInput,
    projectId: string,
  ): Promise<PublicMessageRecord | null> {
    try {
      return await this.appendHuman({
        projectId,
        conversationId: input.conversationId,
        content: input.content,
        imageUrls: parseMessageImageUrls(input.imageUrl),
        sources: parseMessageSources(input.sources ?? null),
        senderName: input.senderName,
        senderAvatar: input.senderAvatar,
        userId: input.userId,
      });
    } catch {
      return null;
    }
  }

  async addPublicBotMessageIfOwnershipMatches(
    input: LegacyPublicMessageInput,
    projectId: string,
    expected: {
      status: PublicConversationRecord["status"];
      chatState: string | null;
    },
  ): Promise<PublicMessageRecord | null> {
    return this.appendBot({
      projectId,
      conversationId: input.conversationId,
      content: input.content,
      imageUrls: parseMessageImageUrls(input.imageUrl),
      sources: parseMessageSources(input.sources ?? null),
      senderName: input.senderName,
      senderAvatar: input.senderAvatar,
      userId: input.userId,
      expected,
    });
  }

  async addPublicSystemMessage(
    conversationId: string,
    kind: AppendPublicSystemInput["kind"],
    content: string,
    idempotencyKey?: string,
    projectId?: string,
  ): Promise<PublicMessageRecord | null> {
    if (projectId && !(await this.belongsToProject(projectId, conversationId))) {
      return null;
    }
    const row = await this.chatService.addPublicSystemMessage(
      conversationId,
      kind,
      content,
      idempotencyKey,
    );
    return row ? mapD1MessageRow(row) : null;
  }

  async addPublicMessage(
    input: LegacyPublicMessageInput & { role: "visitor" | "agent" },
    projectId: string,
  ): Promise<PublicMessageRecord | null> {
    const row = await this.chatService.addPublicMessage(input, projectId);
    return row ? mapD1MessageRow(row) : null;
  }

  async getLatestEmailedPublicAgentMessage(
    conversationId: string,
    projectId?: string,
  ): Promise<PublicMessageRecord | null> {
    if (projectId) return this.getLatestEmailedHumanMessage(projectId, conversationId);
    const row = await this.chatService.getLatestEmailedPublicAgentMessage(
      conversationId,
    );
    return row ? mapD1MessageRow(row) : null;
  }

  async markPublicMessageAsEmailed(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<void> {
    if (projectId && !(await this.belongsToProject(projectId, conversationId))) {
      return;
    }
    await this.chatService.markPublicMessageAsEmailed(conversationId, messageId);
  }

  async markPublicDeliveredUpTo(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<string[]> {
    if (projectId) {
      return this.markDelivery({
        projectId,
        conversationId,
        upToMessageId: messageId,
        kind: "delivered",
      });
    }
    return this.chatService.markPublicDeliveredUpTo(conversationId, messageId);
  }

  async markPublicReadUpTo(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<string[]> {
    if (projectId) {
      return this.markDelivery({
        projectId,
        conversationId,
        upToMessageId: messageId,
        kind: "read",
      });
    }
    return this.chatService.markPublicReadUpTo(conversationId, messageId);
  }

  async deletePublicAgentMessage(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<DeletePublicMessageResult> {
    if (projectId) return this.deleteHumanMessage(projectId, conversationId, messageId);
    const result = await this.chatService.deletePublicAgentMessage(
      conversationId,
      messageId,
    );
    return {
      deleted: result.deleted,
      reason: result.reason,
      ...(result.row ? { message: mapD1MessageRow(result.row) } : {}),
    };
  }

  async updateConversationStatus(
    conversationId: string,
    projectId: string,
    status: PublicConversationRecord["status"],
    closeReason?: PublicConversationRecord["closeReason"],
  ): Promise<void> {
    await this.chatService.updateConversationStatus(
      conversationId,
      projectId,
      status,
      closeReason ?? undefined,
    );
  }

  async reopenConversation(
    conversationId: string,
    projectId: string,
    status: "active" | "agent_replied" = "active",
  ): Promise<PublicConversationRecord | null> {
    return this.reopen(projectId, conversationId, status);
  }

  async transitionChatOwnership(
    conversationId: string,
    projectId: string,
    event: import("../chat-runtime/types").ChatOwnershipEvent,
  ): Promise<PublicConversationRecord["status"] | null> {
    return (await this.transitionOwnership({ projectId, conversationId, event })).status;
  }

  async updateConversation(
    conversationId: string,
    projectId: string,
    input: { visitorName?: string; visitorEmail?: string; metadata?: string },
  ): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateConversation(
      conversationId,
      projectId,
      input,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async updateConversationEmail(
    conversationId: string,
    projectId: string,
    email: string,
  ): Promise<void> {
    await this.updateEmail(projectId, conversationId, email);
  }

  async updateVisitorLastSeen(
    conversationId: string,
    projectId: string,
    presence: "active" | "background" = "active",
  ): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateVisitorLastSeen(
      conversationId,
      projectId,
      presence,
    );
    return row ? mapD1ConversationRow(row) : null;
  }

  async resolveConversationByAi(
    conversationId: string,
    projectId: string,
  ): Promise<boolean> {
    return this.resolveByAi(projectId, conversationId);
  }

  async closeOpenConversationsAsSpam(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<string[]> {
    return this.closeOpenAsSpam(projectId, visitorId, visitorEmail);
  }

  async bulkUpdateConversations(
    projectId: string,
    conversationIds: string[],
    action: PublicConversationAction,
    now?: Date,
  ): Promise<PublicBulkConversationActionResult> {
    return this.chatService.bulkUpdateConversations(
      projectId,
      conversationIds,
      action,
      now,
    );
  }

  async setSnooze(
    conversationId: string,
    projectId: string,
    until: Date | null,
  ): Promise<void> {
    await this.chatService.setSnooze(conversationId, projectId, until);
  }

  async setPriority(
    conversationId: string,
    projectId: string,
    priority: "low" | "medium" | "high",
  ): Promise<void> {
    await this.chatService.setPriority(conversationId, projectId, priority);
  }

  async setAssignee(
    conversationId: string,
    projectId: string,
    assigneeId: string | null,
  ): Promise<void> {
    await this.chatService.setAssignee(conversationId, projectId, assigneeId);
  }
}
