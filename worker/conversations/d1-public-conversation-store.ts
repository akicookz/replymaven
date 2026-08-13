import type { DrizzleD1Database } from "drizzle-orm/d1";
import { parseMessageImageUrls, serializeMessageImageUrls } from "../../shared/message-images";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import type { ConversationRow, MessageRow } from "../db";
import { ChatService } from "../services/chat-service";
import type {
  AppendPublicHumanInput,
  AppendPublicSystemInput,
  AppendPublicVisitorInput,
  AppendVisitorResult,
  CreatePublicConversationInput,
  DeletePublicMessageResult,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationActionInput,
  PublicConversationListQuery,
  PublicConversationListResult,
  PublicConversationStore,
  PublicConversationUpdatesQuery,
  PublicCustomerLinkInput,
  PublicDeliveryUpdateInput,
  PublicEmailUpdateInput,
  PublicExternalActionLease,
  PublicExternalActionLeaseInput,
  PublicInboxCounts,
  PublicMessagePage,
  PublicMessagesBeforeInput,
  PublicOwnershipTransitionInput,
  PublicOwnershipTransitionResult,
  PublicPresenceUpdateInput,
  PublicTeamRequestClaimInput,
  PublicTeamRequestClaimResult,
  PublicTeamRequestSummaryInput,
} from "./public-conversation-store";

function toMillis(value: Date | null): number | null {
  return value?.getTime() ?? null;
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
    lastActivityAt: row.lastActivityAt.getTime(),
    visitorLastSeenAt: toMillis(row.visitorLastSeenAt),
    visitorPresence: row.visitorPresence ?? "active",
    visitorLastOnlineAt: toMillis(row.visitorLastOnlineAt),
    snoozedUntil: toMillis(row.snoozedUntil),
    archivedAt: toMillis(row.archivedAt),
    purgeStartedAt: toMillis(row.purgeStartedAt),
    externalActionStartedAt: toMillis(row.externalActionStartedAt),
    priority: row.priority,
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

  constructor(db: DrizzleD1Database<Record<string, unknown>>) {
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

  async listByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord[]> {
    return (await this.chatService.getConversationsByVisitor(projectId, visitorId)).map(mapD1ConversationRow);
  }

  async getInboxCounts(projectId: string): Promise<PublicInboxCounts> {
    return this.chatService.getInboxCounts(projectId);
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

  async claimTeamRequest(input: PublicTeamRequestClaimInput): Promise<PublicTeamRequestClaimResult> {
    return this.chatService.claimNewTeamRequest(
      input.conversationId,
      input.projectId,
      input.summary,
    );
  }

  async completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean> {
    return this.chatService.completeNewTeamRequestSummary(
      input.conversationId,
      input.projectId,
      input.acceptanceToken,
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

  async updateCustomer(input: PublicCustomerLinkInput): Promise<PublicConversationRecord | null> {
    const row = await this.chatService.updateConversationCustomer(
      input.conversationId,
      input.projectId,
      input.customerId,
    );
    return row ? mapD1ConversationRow(row) : null;
  }
}
