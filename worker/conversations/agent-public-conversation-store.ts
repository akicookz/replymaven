import type { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { parseMessageImageUrls } from "../../shared/message-images";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import type {
  MavenConversationListQuery,
  MavenConversationListResult,
  MavenConversationSummary,
  MavenInboxCounts,
  MavenProjectConversationStats,
  MavenPublicCustomerMutation,
  MavenPublicCustomerMutationResult,
  MavenUsageLogQuery,
  MavenUsageLogResult,
} from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";
import { projects, toolExecutions } from "../db/schema";
import { D1PublicConversationStore } from "./d1-public-conversation-store";
import type {
  AppendPublicBotInput,
  AppendPublicHumanInput,
  AppendPublicSystemInput,
  AppendPublicVisitorInput,
  AppendVisitorResult,
  CreatePublicConversationInput,
  DeletePublicMessageResult,
  LegacyPublicMessageInput,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationAction,
  PublicConversationActionInput,
  PublicConversationAnalytics,
  PublicBulkConversationActionResult,
  PublicConversationCounts,
  PublicConversationListQuery,
  PublicConversationListResult,
  PublicCustomerLinkInput,
  PublicCustomerMutationInput,
  PublicCustomerMutationResult,
  PublicDeliveryUpdateInput,
  PublicEmailUpdateInput,
  PublicInboxCounts,
  PublicLastMessagePreview,
  PublicLegacyEscalationMetadataUpdate,
  PublicMessageAttachmentSource,
  PublicMessagePage,
  PublicMessagesBeforeInput,
  PublicPresenceUpdateInput,
  PublicExternalActionLease,
  PublicExternalActionLeaseInput,
  PublicOwnershipTransitionInput,
  PublicOwnershipTransitionResult,
  PublicRetentionClaim,
  PublicTeamRequestAcceptance,
  PublicTeamRequestClaimInput,
  PublicTeamRequestClaimResult,
  PublicTeamRequestSummaryInput,
  PublicUsageConversationQuery,
  PublicUsageConversationResult,
  PublicConversationStore,
} from "./public-conversation-store";
import type {
  ChatOwnershipEvent,
  ConversationChatState,
} from "../chat-runtime/types";

interface AgentPublicConversationStoreContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
  legacy?: PublicConversationStore;
}

interface PublicChildStub {
  getPublicSnapshot(): Promise<{
    conversation: PublicConversationRecord;
    messages: PublicMessageRecord[];
    revision: number;
  }>;
  getPublicMessages(): Promise<PublicMessageRecord[]>;
  importLegacyPublicConversation(input: {
    conversation: PublicConversationRecord;
    messages: PublicMessageRecord[];
    checksum: string;
  }): Promise<{
    status: "imported" | "noop" | "conflict";
    revision: number;
  }>;
  updateContact(
    input: PublicContactUpdateInput,
  ): Promise<PublicConversationRecord | null>;
  createPublicConversation(
    conversation: PublicConversationRecord,
  ): Promise<PublicConversationRecord>;
  appendVisitorMessage(message: PublicMessageRecord): Promise<PublicMessageRecord>;
  appendHumanMessage(message: PublicMessageRecord): Promise<PublicMessageRecord>;
  appendBotMessage(message: PublicMessageRecord): Promise<PublicMessageRecord>;
  appendSystemMessage(message: PublicMessageRecord): Promise<PublicMessageRecord>;
  deleteHumanMessage(messageId: string): Promise<DeletePublicMessageResult>;
  applyConversationAction(
    action: PublicConversationAction,
  ): Promise<PublicConversationRecord | null>;
  markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]>;
  markEmailed(input: PublicEmailUpdateInput): Promise<boolean>;
  updatePresence(
    input: PublicPresenceUpdateInput,
  ): Promise<PublicChatChildState | null>;
  updateCustomer(
    input: PublicCustomerLinkInput,
  ): Promise<PublicConversationRecord | null>;
  getAttachmentManifest(): Promise<PublicMessageAttachmentSource[]>;
  setPublicStatus(input: {
    projectId: string;
    conversationId: string;
    status: PublicConversationRecord["status"];
    closeReason?: PublicConversationRecord["closeReason"];
  }): Promise<PublicConversationRecord | null>;
  transitionPublicOwnership(
    event: ChatOwnershipEvent,
  ): Promise<PublicOwnershipTransitionResult>;
  takePublicHumanOwnership(): Promise<{
    status: PublicConversationRecord["status"];
    chatState: string | null;
  } | null>;
  resolvePublicByAi(): Promise<boolean>;
  checkAndClosePublicStale(autoCloseMinutes: number): Promise<{
    closed: boolean;
    conversation: PublicConversationRecord | null;
  }>;
  preparePublicContactSupportOwnership(): Promise<
    "waiting_agent" | "agent_replied" | null
  >;
  claimTeamRequest(
    input: PublicTeamRequestClaimInput,
  ): Promise<PublicTeamRequestClaimResult>;
  getTeamRequestAcceptance(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicTeamRequestAcceptance | null>;
  claimTeamRequestNotification(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<boolean>;
  addTeamRequestSummary(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicMessageRecord | null>;
  completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean>;
  updateLegacyEscalationMetadata(
    projectId: string,
    conversationId: string,
    update: PublicLegacyEscalationMetadataUpdate,
  ): Promise<PublicConversationRecord | null>;
  persistTeamRequestTelegramThreadId(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
    threadId: string,
  ): Promise<boolean>;
  updatePublicTelegramThreadId(threadId: string): Promise<void>;
  acquireExternalAction(
    input: PublicExternalActionLeaseInput,
  ): Promise<PublicExternalActionLease | null>;
  releaseExternalAction(input: PublicExternalActionLease): Promise<void>;
  updatePendingTeamRequestContact(
    projectId: string,
    conversationId: string,
    ownership: { status: string; chatState: string | null },
    update: {
      visitorName?: string;
      visitorEmail?: string;
      awaitingContactFields: Array<"name" | "email">;
      contactDeclined?: boolean;
    },
  ): Promise<PublicConversationRecord | null>;
  getPublicChatState(): Promise<ConversationChatState>;
  savePublicChatState(chatState: ConversationChatState): Promise<void>;
  hasPublicUploadKey(key: string): Promise<boolean>;
}

interface PublicParentStub {
  registerPublicConversation(
    conversationId: string,
  ): Promise<{ childName: `pub_${string}`; created: boolean }>;
  getConversationSummary(
    conversationId: string,
  ): Promise<MavenConversationSummary | null>;
  listConversations(
    query: MavenConversationListQuery,
  ): Promise<MavenConversationListResult>;
  getDashboardConversationPage(
    query: MavenConversationListQuery,
  ): Promise<{
    conversations: MavenConversationSummary[];
    nextCursor: string | null;
    counts: MavenInboxCounts;
  }>;
  getInboxCounts(): Promise<PublicInboxCounts>;
  listAllPublicConversationSummaries(): Promise<MavenConversationSummary[]>;
  listByCustomer(customerId: string): Promise<MavenConversationSummary[]>;
  listByVisitor(visitorId: string): Promise<MavenConversationSummary[]>;
  getConversationCountsByCustomer(
    customerIds: string[],
  ): Promise<Array<{ customerId: string; count: number }>>;
  getProjectStats(since: number): Promise<MavenProjectConversationStats>;
  getUsageLog(query: MavenUsageLogQuery): Promise<MavenUsageLogResult>;
  applyPublicCustomerMutation(
    input: MavenPublicCustomerMutation,
  ): Promise<MavenPublicCustomerMutationResult>;
  bulkApplyPublicActions(input: {
    conversationIds: string[];
    action: PublicConversationAction;
  }): Promise<PublicBulkConversationActionResult>;
  closePublicConversationsAsSpam(input: {
    visitorId: string;
    visitorEmail?: string | null;
  }): Promise<string[]>;
  reconcilePublicAutoCloseSchedules(
    autoCloseMinutes: number | null,
  ): Promise<void>;
  claimExpiredPublicArchives(input: {
    retentionCutoff: number;
    staleClaimCutoff: number;
    claimAt: number;
    limit: number;
  }): Promise<PublicRetentionClaim[]>;
  hasPublicUploadKeyElsewhere(input: {
    key: string;
    excludedConversationId: string;
  }): Promise<boolean>;
  deleteClaimedPublicConversation(input: {
    conversationId: string;
    purgeStartedAt: number;
  }): Promise<boolean>;
}

async function getPublicParent(
  namespace: AppEnv["MAVEN_PROJECT_AGENT"],
  projectId: string,
): Promise<PublicParentStub> {
  const { getAgentByName } = await import("agents");
  return await getAgentByName(namespace, projectId) as unknown as PublicParentStub;
}

async function getPublicSubAgent(
  parent: PublicParentStub,
  name: string,
): Promise<PublicChildStub> {
  const { getSubAgentByName } = await import("agents");
  const { MavenChatAgent } = await import(
    "../agents/maven/maven-chat-agent"
  );
  const getChild = getSubAgentByName as unknown as (
    parentStub: unknown,
    childClass: typeof MavenChatAgent,
    childName: string,
  ) => Promise<PublicChildStub>;
  return getChild(parent, MavenChatAgent, name);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(inputs[index]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), inputs.length) },
      runWorker,
    ),
  );
  return results;
}

function isPublicSourceReference(value: unknown): value is PublicSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.title === "string" &&
    (source.url === null || typeof source.url === "string") &&
    (source.type === "webpage" || source.type === "pdf" ||
      source.type === "faq");
}

function parseMessageSources(raw: string | null | undefined): PublicSourceReference[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPublicSourceReference) : [];
  } catch {
    return [];
  }
}

async function importChecksum(
  conversation: PublicConversationRecord,
  messages: PublicMessageRecord[],
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(stableValue({ conversation, messages })),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function summaryToConversation(
  summary: MavenConversationSummary,
  projectId: string,
): PublicConversationRecord {
  return {
    id: summary.conversationId,
    projectId,
    customerId: summary.customerId,
    visitorId: summary.visitorId,
    visitorName: summary.visitorName,
    visitorEmail: summary.visitorEmail,
    status: summary.status,
    closeReason: summary.closeReason,
    telegramThreadId: summary.telegramThreadId,
    metadata: structuredClone(summary.metadata),
    chatState: {},
    lastActivityAt: summary.lastActivityAt,
    visitorLastSeenAt: summary.visitorLastSeenAt,
    visitorPresence: summary.visitorPresence,
    visitorLastOnlineAt: summary.visitorLastOnlineAt,
    snoozedUntil: summary.snoozedUntil,
    archivedAt: summary.archivedAt,
    purgeStartedAt: summary.purgeStartedAt,
    externalActionStartedAt: null,
    priority: summary.priority,
    assigneeId: summary.assigneeId,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ownershipRevision: summary.childRevision,
  };
}

interface NewMessageInput {
  conversationId: string;
  content: string;
  imageUrls?: string[];
  sources?: PublicSourceReference[];
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  idempotencyKey?: string | null;
  origin?: "widget" | "dashboard" | "telegram" | "email" | "mcp" | null;
  externalReplyTo?: string | null;
}

function newMessage(
  input: NewMessageInput,
  author: PublicMessageRecord["author"],
  options: { systemKind?: string | null; id?: string } = {},
): PublicMessageRecord {
  return {
    id: options.id ?? input.idempotencyKey ?? crypto.randomUUID(),
    conversationId: input.conversationId,
    author,
    content: input.content,
    imageUrls: [...(input.imageUrls ?? [])],
    sources: structuredClone(input.sources ?? []),
    senderName: input.senderName ?? null,
    senderAvatar: input.senderAvatar ?? null,
    userId: input.userId ?? null,
    systemKind: options.systemKind ?? null,
    createdAt: Date.now(),
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
    idempotencyKey: input.idempotencyKey ?? null,
    origin: input.origin ?? null,
    externalReplyTo: input.externalReplyTo ?? null,
  };
}

export class AgentPublicConversationStore implements PublicConversationStore {
  private readonly legacy: PublicConversationStore;

  constructor(private readonly context: AgentPublicConversationStoreContext) {
    this.legacy = context.legacy ?? new D1PublicConversationStore(context.db);
  }

  async create(
    input: CreatePublicConversationInput,
  ): Promise<PublicConversationRecord> {
    const now = Date.now();
    const conversation: PublicConversationRecord = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      customerId: input.customerId ?? null,
      visitorId: input.visitorId,
      visitorName: input.visitorName ?? null,
      visitorEmail: input.visitorEmail ?? null,
      status: "active",
      closeReason: null,
      telegramThreadId: null,
      metadata: structuredClone(input.metadata ?? {}),
      chatState: {},
      lastActivityAt: now,
      visitorLastSeenAt: null,
      visitorPresence: "active",
      visitorLastOnlineAt: null,
      snoozedUntil: null,
      archivedAt: null,
      purgeStartedAt: null,
      externalActionStartedAt: null,
      priority: "medium",
      assigneeId: null,
      createdAt: now,
      updatedAt: now,
      ownershipRevision: 0,
    };
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      input.projectId,
    );
    const registration = await parent.registerPublicConversation(
      conversation.id,
    );
    const child = await getPublicSubAgent(parent, registration.childName);
    return child.createPublicConversation(conversation);
  }

  async getOperational(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    const conversation = await this.get(projectId, conversationId);
    return conversation &&
        conversation.archivedAt === null &&
        conversation.purgeStartedAt === null
      ? conversation
      : null;
  }

  async getActiveByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord | null> {
    const summaries = await this.readEverySummary(projectId);
    const match = summaries
      .filter((summary) =>
        summary.visitorId === visitorId &&
        summary.status !== "closed" &&
        summary.archivedAt === null
      )
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt)[0];
    return match ? this.get(projectId, match.conversationId) : null;
  }

  async getLastByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord | null> {
    const summaries = await this.readEverySummary(projectId);
    const match = summaries
      .filter((summary) =>
        summary.visitorId === visitorId && summary.archivedAt === null
      )
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt)[0];
    return match ? this.get(projectId, match.conversationId) : null;
  }

  async getRecentByVisitorEmail(
    projectId: string,
    email: string,
  ): Promise<PublicConversationRecord | null> {
    const normalized = email.trim().toLowerCase();
    const summaries = await this.readEverySummary(projectId);
    const match = summaries
      .filter((summary) =>
        summary.visitorEmail?.trim().toLowerCase() === normalized &&
        summary.archivedAt === null
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return match ? this.get(projectId, match.conversationId) : null;
  }

  async list(
    query: PublicConversationListQuery,
  ): Promise<PublicConversationListResult> {
    const summaries = await this.readAllSummaries(
      query.projectId,
      query.inboxFilter ?? "all",
      query.search,
    );
    const statusFiltered = summaries.filter((summary) =>
      query.status === undefined || query.status === "all" ||
      (query.status === "closed"
        ? summary.status === "closed"
        : summary.status !== "closed")
    );
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, Math.min(100, query.limit ?? 50));
    return {
      conversations: statusFiltered.slice(offset, offset + limit)
        .map((summary) => summaryToConversation(summary, query.projectId)),
    };
  }

  async getConversationCounts(
    projectId: string,
  ): Promise<PublicConversationCounts> {
    const summaries = await this.readEverySummary(projectId);
    const closed = summaries.filter((summary) => summary.status === "closed").length;
    return {
      all: summaries.length,
      open: summaries.length - closed,
      closed,
    };
  }

  async listUpdates(input: {
    projectId: string;
    since: number;
    limit?: number;
  }): Promise<PublicConversationRecord[]> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 100));
    return (await this.readEverySummary(input.projectId))
      .filter((summary) => summary.updatedAt > input.since)
      .slice(0, limit)
      .map((summary) => summaryToConversation(summary, input.projectId));
  }

  async listNeedsReview(
    projectId: string,
    since: number,
  ): Promise<PublicConversationRecord[]> {
    return (await this.readEverySummary(projectId))
      .filter((summary) =>
        summary.updatedAt >= since &&
        summary.metadata.needsReview === true
      )
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async listAgentMode(projectId: string): Promise<PublicConversationRecord[]> {
    return (await this.readEverySummary(projectId))
      .filter((summary) =>
        summary.status === "waiting_agent" ||
        summary.status === "agent_replied"
      )
      .filter((summary) => summary.archivedAt === null)
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async getInboxCounts(projectId: string): Promise<PublicInboxCounts> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return parent.getInboxCounts();
  }

  async getDashboardConversationPage(
    projectId: string,
    query: MavenConversationListQuery,
  ): Promise<{
    conversations: Array<{
      conversation: PublicConversationRecord;
      lastMessage: PublicLastMessagePreview | null;
    }>;
    counts: PublicInboxCounts;
    nextCursor: string | null;
  }> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    const page = await parent.getDashboardConversationPage(query);
    return {
      conversations: page.conversations.map((summary) => ({
        conversation: summaryToConversation(summary, projectId),
        lastMessage: summary.lastMessageId && summary.lastMessageAuthor
          ? {
              id: summary.lastMessageId,
              author: summary.lastMessageAuthor,
              content: summary.lastMessagePreview ?? "",
              senderName: summary.lastMessageSenderName,
              emailedAt: summary.lastMessageEmailedAt,
              createdAt:
                summary.lastMessageCreatedAt ?? summary.lastActivityAt,
            }
          : null,
      })),
      counts: page.counts,
      nextCursor: page.nextCursor,
    };
  }

  async getLastMessagePreviews(
    conversationIds: string[],
  ): Promise<Map<string, PublicLastMessagePreview>> {
    const requested = new Set(conversationIds);
    const previews = new Map<string, PublicLastMessagePreview>();
    const projectRows = await this.context.db
      .select({ id: projects.id })
      .from(projects);
    for (const project of projectRows) {
      const parent = await getPublicParent(
        this.context.env.MAVEN_PROJECT_AGENT,
        project.id,
      );
      for (const summary of await parent.listAllPublicConversationSummaries()) {
        if (
          !requested.has(summary.conversationId) ||
          !summary.lastMessageId ||
          !summary.lastMessageAuthor
        ) continue;
        previews.set(summary.conversationId, {
          id: summary.lastMessageId,
          author: summary.lastMessageAuthor,
          content: summary.lastMessagePreview ?? "",
          senderName: summary.lastMessageSenderName,
          emailedAt: summary.lastMessageEmailedAt,
          createdAt: summary.lastMessageCreatedAt ?? summary.lastActivityAt,
        });
      }
    }
    return previews;
  }

  async listByCustomer(
    projectId: string,
    customerId: string,
  ): Promise<PublicConversationRecord[]> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return (await parent.listByCustomer(customerId))
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async getConversationCountsByCustomer(
    projectId: string,
    customerIds: string[],
  ): Promise<Map<string, number>> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return new Map(
      (await parent.getConversationCountsByCustomer(customerIds))
        .map(({ customerId, count }) => [customerId, count]),
    );
  }

  async listByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord[]> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return (await parent.listByVisitor(visitorId))
      .map((summary) => summaryToConversation(summary, projectId));
  }


  async ensurePublicConversation(
    conversation: PublicConversationRecord,
  ): Promise<{ childName: `pub_${string}` }> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      conversation.projectId,
    );
    const registration = await parent.registerPublicConversation(
      conversation.id,
    );
    const child = await getPublicSubAgent(parent, registration.childName);
    const summary = await parent.getConversationSummary(conversation.id);
    if (summary && summary.visitorId !== "") {
      return { childName: registration.childName as `pub_${string}` };
    }
    const messages = await this.legacy.getMessages(
      conversation.projectId,
      conversation.id,
    );
    await child.importLegacyPublicConversation({
      conversation,
      messages,
      checksum: await importChecksum(conversation, messages),
    });
    return { childName: registration.childName as `pub_${string}` };
  }

  async get(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? (await child.getPublicSnapshot()).conversation : null;
  }

  async getMessages(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageRecord[]> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.getPublicMessages() : [];
  }

  async getRecentMessages(
    projectId: string,
    conversationId: string,
    limit: number,
  ): Promise<PublicMessagePage> {
    const messages = await this.getMessages(projectId, conversationId);
    const bounded = Math.max(1, Math.min(100, limit));
    return {
      messages: messages.slice(-bounded),
      hasMore: messages.length > bounded,
    };
  }

  async getMessagesBefore(
    input: PublicMessagesBeforeInput,
  ): Promise<PublicMessagePage> {
    const all = await this.getMessages(input.projectId, input.conversationId);
    const eligible = all.filter((message) =>
      message.createdAt < input.beforeCreatedAt
    );
    const limit = Math.max(1, Math.min(100, input.limit ?? 50));
    return {
      messages: eligible.slice(-limit),
      hasMore: eligible.length > limit,
    };
  }

  async getMessagesSince(
    projectId: string,
    conversationId: string,
    since: number,
  ): Promise<PublicMessageRecord[]> {
    return (await this.getMessages(projectId, conversationId))
      .filter((message) => message.createdAt >= since);
  }

  async getMessage(
    projectId: string,
    conversationId: string,
    messageId: string,
  ): Promise<PublicMessageRecord | null> {
    return (await this.getMessages(projectId, conversationId))
      .find((message) => message.id === messageId) ?? null;
  }

  async hasVisitorMessages(
    projectId: string,
    conversationId: string,
  ): Promise<boolean> {
    return (await this.getMessages(projectId, conversationId))
      .some((message) => message.author === "visitor");
  }

  async getLatestEmailedHumanMessage(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageRecord | null> {
    return (await this.getMessages(projectId, conversationId))
      .filter((message) =>
        message.author === "agent" && message.emailedAt !== null
      ).at(-1) ?? null;
  }

  async appendVisitor(
    input: AppendPublicVisitorInput,
  ): Promise<AppendVisitorResult | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    if (!child) return null;
    const existing = await child.getPublicMessages();
    const message = await child.appendVisitorMessage(
      newMessage(input, "visitor"),
    );
    return {
      message,
      isFirstVisitorTurn: !existing.some((entry) => entry.author === "visitor"),
    };
  }

  async appendHuman(
    input: AppendPublicHumanInput,
  ): Promise<PublicMessageRecord> {
    const child = await this.requireChild(input.projectId, input.conversationId);
    return child.appendHumanMessage(newMessage(input, "agent"));
  }

  async appendBot(
    input: AppendPublicBotInput,
  ): Promise<PublicMessageRecord | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    if (!child) return null;
    const snapshot = await child.getPublicSnapshot();
    const chatStateMatches = input.expected.chatState === null
      ? Object.keys(snapshot.conversation.chatState).length === 0
      : JSON.stringify(snapshot.conversation.chatState) ===
        input.expected.chatState;
    if (
      snapshot.conversation.status !== input.expected.status ||
      !chatStateMatches
    ) return null;
    return child.appendBotMessage(newMessage(input, "bot"));
  }

  async appendSystem(
    input: AppendPublicSystemInput,
  ): Promise<PublicMessageRecord> {
    const child = await this.requireChild(input.projectId, input.conversationId);
    const id = input.idempotencyKey
      ? `system-${input.kind}-${input.idempotencyKey}`
      : crypto.randomUUID();
    const existing = (await child.getPublicMessages())
      .find((message) => message.id === id);
    if (existing) return existing;
    return child.appendSystemMessage(newMessage(input, "system", {
      id,
      systemKind: input.kind,
    }));
  }

  async deleteHumanMessage(
    projectId: string,
    conversationId: string,
    messageId: string,
  ): Promise<DeletePublicMessageResult> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.deleteHumanMessage(messageId)
      : { deleted: false, reason: "not_found" };
  }

  async applyAction(
    input: PublicConversationActionInput,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.applyConversationAction(input.action) : null;
  }

  async bulkApplyActions(
    projectId: string,
    conversationIds: string[],
    action: PublicConversationAction,
  ): Promise<{ updatedIds: string[]; skippedIds: string[] }> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return parent.bulkApplyPublicActions({ conversationIds, action });
  }

  async transitionOwnership(
    input: PublicOwnershipTransitionInput,
  ): Promise<PublicOwnershipTransitionResult> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child
      ? child.transitionPublicOwnership(input.event)
      : { status: null, conversation: null };
  }

  async takeHumanOwnership(
    projectId: string,
    conversationId: string,
  ): Promise<{
    status: PublicConversationRecord["status"];
    chatState: string | null;
  } | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.takePublicHumanOwnership() : null;
  }

  async resolveByAi(
    projectId: string,
    conversationId: string,
  ): Promise<boolean> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.resolvePublicByAi() : false;
  }

  async claimTeamRequest(
    input: PublicTeamRequestClaimInput,
  ): Promise<PublicTeamRequestClaimResult> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.claimTeamRequest(input) : { status: "unavailable" };
  }

  async getTeamRequestAcceptance(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicTeamRequestAcceptance | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.getTeamRequestAcceptance(
          projectId,
          conversationId,
          acceptanceToken,
        )
      : null;
  }

  async claimTeamRequestNotification(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<boolean> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.claimTeamRequestNotification(
          projectId,
          conversationId,
          acceptanceToken,
        )
      : false;
  }

  async addTeamRequestSummary(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
  ): Promise<PublicMessageRecord | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.addTeamRequestSummary(projectId, conversationId, acceptanceToken)
      : null;
  }

  async completeTeamRequestSummary(
    input: PublicTeamRequestSummaryInput,
  ): Promise<boolean> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.completeTeamRequestSummary(input) : false;
  }

  async updateLegacyEscalationMetadata(
    projectId: string,
    conversationId: string,
    update: PublicLegacyEscalationMetadataUpdate,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.updateLegacyEscalationMetadata(
          projectId,
          conversationId,
          update,
        )
      : null;
  }

  async persistTeamRequestTelegramThreadId(
    projectId: string,
    conversationId: string,
    acceptanceToken: string,
    threadId: string,
  ): Promise<boolean> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.persistTeamRequestTelegramThreadId(
          projectId,
          conversationId,
          acceptanceToken,
          threadId,
        )
      : false;
  }

  async updateTelegramThreadId(
    projectId: string,
    conversationId: string,
    threadId: string,
  ): Promise<void> {
    const child = await this.resolveChild(projectId, conversationId);
    await child?.updatePublicTelegramThreadId(threadId);
  }

  async acquireExternalAction(
    input: PublicExternalActionLeaseInput,
  ): Promise<PublicExternalActionLease | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.acquireExternalAction(input) : null;
  }

  async releaseExternalAction(input: PublicExternalActionLease): Promise<void> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    await child?.releaseExternalAction(input);
  }

  async markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.markDelivery(input) : [];
  }

  async markEmailed(input: PublicEmailUpdateInput): Promise<boolean> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.markEmailed(input) : false;
  }

  async updatePresence(
    input: PublicPresenceUpdateInput,
  ): Promise<PublicChatChildState | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.updatePresence(input) : null;
  }

  async updateContact(
    input: PublicContactUpdateInput,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.updateContact(input) : null;
  }

  async updateEmail(
    projectId: string,
    conversationId: string,
    email: string,
  ): Promise<void> {
    await this.updateContact({
      projectId,
      conversationId,
      visitorEmail: email,
    });
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
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.updatePendingTeamRequestContact(
          projectId,
          conversationId,
          ownership,
          update,
        )
      : null;
  }

  async getChatState(
    projectId: string,
    conversationId: string,
  ): Promise<ConversationChatState> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.getPublicChatState()
      : {
          state: "active",
          aiParticipation: "continuous",
          ownershipRevision: 0,
          askedClarifications: [],
          clarificationAttempts: 0,
          lastBotQuestion: null,
          frustrationScore: 0,
          lastIntent: null,
          pendingHandoffReason: null,
          awaitingContactFields: [],
          awaitingHandoffConfirmation: false,
          contactDeclined: false,
        };
  }

  async saveChatState(
    projectId: string,
    conversationId: string,
    chatState: ConversationChatState,
  ): Promise<void> {
    const child = await this.resolveChild(projectId, conversationId);
    await child?.savePublicChatState(chatState);
  }

  async updateCustomer(
    input: PublicCustomerLinkInput,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.updateCustomer(input) : null;
  }

  async applyCustomerMutation(
    input: PublicCustomerMutationInput,
  ): Promise<PublicCustomerMutationResult> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      input.projectId,
    );
    return parent.applyPublicCustomerMutation({
      mutationId: input.mutationId,
      updates: input.updates,
    });
  }

  async setStatus(
    projectId: string,
    conversationId: string,
    status: PublicConversationRecord["status"],
    closeReason?: PublicConversationRecord["closeReason"],
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.setPublicStatus({
          projectId,
          conversationId,
          status,
          closeReason,
        })
      : null;
  }

  async reopen(
    projectId: string,
    conversationId: string,
    status: "active" | "agent_replied" = "active",
  ): Promise<PublicConversationRecord | null> {
    return this.setStatus(projectId, conversationId, status, null);
  }

  async checkAndCloseStale(
    projectId: string,
    conversationId: string,
    autoCloseMinutes: number,
  ): Promise<{
    closed: boolean;
    conversation: PublicConversationRecord | null;
  }> {
    const child = await this.resolveChild(projectId, conversationId);
    return child
      ? child.checkAndClosePublicStale(autoCloseMinutes)
      : { closed: false, conversation: null };
  }

  async checkAndCloseStaleForProject(
    projectId: string,
    conversationRecords: PublicConversationRecord[],
    autoCloseMinutes: number,
  ): Promise<string[]> {
    const closedIds: string[] = [];
    for (let offset = 0; offset < conversationRecords.length; offset += 25) {
      const batch = conversationRecords.slice(offset, offset + 25);
      const results = await Promise.all(batch.map((conversation) =>
        this.checkAndCloseStale(
          projectId,
          conversation.id,
          autoCloseMinutes,
        )
      ));
      results.forEach((result, index) => {
        if (result.closed) closedIds.push(batch[index]!.id);
      });
    }
    return closedIds;
  }

  async prepareContactSupportOwnership(
    projectId: string,
    conversationId: string,
  ): Promise<"waiting_agent" | "agent_replied" | null> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.preparePublicContactSupportOwnership() : null;
  }

  async closeOpenAsSpam(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<string[]> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return parent.closePublicConversationsAsSpam({
      visitorId,
      visitorEmail,
    });
  }

  async getAnalytics(
    projectIds: string[],
    since: number,
  ): Promise<PublicConversationAnalytics> {
    const pages = await mapWithConcurrency(projectIds, 5, async (projectId) => {
      const parent = await getPublicParent(
        this.context.env.MAVEN_PROJECT_AGENT,
        projectId,
      );
      return { projectId, stats: await parent.getProjectStats(since) };
    });
    const byDay = new Map<string, number>();
    const byStatus = new Map<PublicConversationRecord["status"], number>();
    for (const { stats } of pages) {
      for (const row of stats.conversationsByDay) {
        byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
      }
      for (const row of stats.conversationsByStatus) {
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
      }
    }
    return {
      totalConversations: pages.reduce(
        (total, page) => total + page.stats.totalConversations,
        0,
      ),
      activeConversations: pages.reduce(
        (total, page) => total + page.stats.activeConversations,
        0,
      ),
      totalMessages: pages.reduce(
        (total, page) => total + page.stats.totalMessages,
        0,
      ),
      conversationsByDay: [...byDay]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, count]) => ({ day, count })),
      conversationsByStatus: [...byStatus].map(([status, count]) => ({
        status,
        count,
      })),
      recentConversations: pages.flatMap((page) =>
        page.stats.recentConversations.map((summary) => ({
          projectId: page.projectId,
          summary,
        }))
      )
        .sort((left, right) =>
          Math.max(
            right.summary.visitorLastSeenAt ?? 0,
            right.summary.updatedAt,
          ) - Math.max(
            left.summary.visitorLastSeenAt ?? 0,
            left.summary.updatedAt,
          )
        )
        .slice(0, 5)
        .map(({ projectId, summary }) =>
          summaryToConversation(summary, projectId)
        ),
    };
  }

  async queryUsageConversations(
    query: PublicUsageConversationQuery,
  ): Promise<PublicUsageConversationResult> {
    const parentLimit = Math.max(1, query.offset + query.limit);
    const pages = await mapWithConcurrency(
      query.projectIds,
      5,
      async (projectId) => {
        const parent = await getPublicParent(
          this.context.env.MAVEN_PROJECT_AGENT,
          projectId,
        );
        const result = await parent.getUsageLog({
          periodStart: query.periodStart,
          periodEnd: query.periodEnd,
          limit: parentLimit,
          offset: 0,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.metaKey === undefined
            ? {}
            : { metadataKey: query.metaKey }),
          ...(query.metaValue === undefined
            ? {}
            : { metadataValue: query.metaValue }),
        });
        return { projectId, result };
      },
    );
    const rows = pages.flatMap((page) =>
      page.result.summaries.map((summary) => ({
        projectId: page.projectId,
        summary,
      }))
    );
    rows.sort((left, right) => {
      const leftValue = query.sortBy === "botMessages"
        ? left.summary.botMessageCount
        : left.summary.createdAt;
      const rightValue = query.sortBy === "botMessages"
        ? right.summary.botMessageCount
        : right.summary.createdAt;
      return query.sortOrder === "asc"
        ? leftValue - rightValue ||
          left.summary.conversationId.localeCompare(right.summary.conversationId)
        : rightValue - leftValue ||
          right.summary.conversationId.localeCompare(left.summary.conversationId);
    });
    return {
      rows: rows.slice(query.offset, query.offset + query.limit)
        .map(({ projectId, summary }) => ({
          conversation: summaryToConversation(summary, projectId),
          botMessageCount: summary.botMessageCount,
        })),
      total: pages.reduce((total, page) => total + page.result.total, 0),
      metaKeys: [...new Set(pages.flatMap((page) =>
        page.result.metadataKeys
      ))].sort(),
    };
  }

  async claimExpiredArchives(
    retentionCutoff: number,
    staleClaimCutoff: number,
    claimAt: number,
    limit: number,
  ): Promise<PublicRetentionClaim[]> {
    const claimed: PublicRetentionClaim[] = [];
    const projectRows = await this.context.db
      .select({ id: projects.id })
      .from(projects);
    for (const project of projectRows) {
      if (claimed.length >= limit) break;
      const parent = await getPublicParent(
        this.context.env.MAVEN_PROJECT_AGENT,
        project.id,
      );
      claimed.push(...await parent.claimExpiredPublicArchives({
        retentionCutoff,
        staleClaimCutoff,
        claimAt,
        limit: limit - claimed.length,
      }));
    }
    return claimed;
  }

  async listMessageAttachments(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageAttachmentSource[]> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.getAttachmentManifest() : [];
  }

  async isUploadKeyReferencedElsewhere(
    key: string,
    conversationId: string,
  ): Promise<boolean> {
    const projectRows = await this.context.db
      .select({ id: projects.id })
      .from(projects);
    for (const project of projectRows) {
      const parent = await getPublicParent(
        this.context.env.MAVEN_PROJECT_AGENT,
        project.id,
      );
      if (await parent.hasPublicUploadKeyElsewhere({
        key,
        excludedConversationId: conversationId,
      })) return true;
    }
    return false;
  }

  async deleteRetentionClaim(
    projectId: string,
    conversationId: string,
    purgeStartedAt: number,
  ): Promise<boolean> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    const deleted = await parent.deleteClaimedPublicConversation({
      conversationId,
      purgeStartedAt,
    });
    if (deleted) {
      await this.context.db
        .delete(toolExecutions)
        .where(eq(toolExecutions.conversationId, conversationId));
    }
    return deleted;
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

  async createConversation(input: {
    projectId: string;
    customerId?: string | null;
    visitorId: string;
    visitorName?: string | null;
    visitorEmail?: string | null;
    metadata?: string | null;
  }): Promise<PublicConversationRecord> {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(input.metadata ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
    return this.create({ ...input, metadata });
  }

  async getConversationsByProject(
    projectId: string,
    limit?: number,
    offset?: number,
    status?: "open" | "closed" | "all",
    search?: string,
    inboxFilter?: PublicConversationListQuery["inboxFilter"],
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
    if (!projectId) throw new Error("Agent message reads require a project ID");
    return this.getMessages(projectId, conversationId);
  }

  async getRecentPublicMessages(
    conversationId: string,
    limit = 50,
    projectId?: string,
  ): Promise<PublicMessagePage> {
    if (!projectId) throw new Error("Agent message reads require a project ID");
    return this.getRecentMessages(projectId, conversationId, limit);
  }

  async getPublicMessagesBefore(
    conversationId: string,
    beforeCreatedAt: Date,
    limit = 50,
    projectId?: string,
  ): Promise<PublicMessagePage> {
    if (!projectId) throw new Error("Agent message reads require a project ID");
    return this.getMessagesBefore({
      projectId,
      conversationId,
      beforeCreatedAt: beforeCreatedAt.getTime(),
      limit,
    });
  }

  async getPublicMessagesSince(
    conversationId: string,
    since: number,
    projectId?: string,
  ): Promise<PublicMessageRecord[]> {
    if (!projectId) throw new Error("Agent message reads require a project ID");
    return this.getMessagesSince(projectId, conversationId, since);
  }

  async getPublicMessageById(
    messageId: string,
    projectId?: string,
    conversationId?: string,
  ): Promise<PublicMessageRecord | null> {
    if (!projectId) {
      throw new Error("Agent message reads require a project ID");
    }
    if (conversationId) {
      return this.getMessage(projectId, conversationId, messageId);
    }
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    const summaries = await parent.listAllPublicConversationSummaries();
    for (let offset = 0; offset < summaries.length; offset += 25) {
      const batch = summaries.slice(offset, offset + 25);
      const matches = await Promise.all(batch.map(async (summary) => {
        const child = await getPublicSubAgent(
          parent,
          summary.publicChildName,
        );
        return (await child.getPublicMessages())
          .find((message) => message.id === messageId) ?? null;
      }));
      const match = matches.find(
        (message): message is PublicMessageRecord => message !== null,
      );
      if (match) return match;
    }
    return null;
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
      sources: parseMessageSources(input.sources),
      senderName: input.senderName,
      senderAvatar: input.senderAvatar,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      origin: input.origin,
      externalReplyTo: input.externalReplyTo,
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
        sources: parseMessageSources(input.sources),
        senderName: input.senderName,
        senderAvatar: input.senderAvatar,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        origin: input.origin,
        externalReplyTo: input.externalReplyTo,
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
      sources: parseMessageSources(input.sources),
      senderName: input.senderName,
      senderAvatar: input.senderAvatar,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      origin: input.origin,
      externalReplyTo: input.externalReplyTo,
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
    if (!projectId) {
      throw new Error("Agent message writes require a project ID");
    }
    try {
      return await this.appendSystem({
        projectId,
        conversationId,
        kind,
        content,
        idempotencyKey,
      });
    } catch {
      return null;
    }
  }

  async addPublicMessage(
    input: LegacyPublicMessageInput & { role: "visitor" | "agent" },
    projectId: string,
  ): Promise<PublicMessageRecord | null> {
    if (input.role === "visitor") {
      return (await this.addPublicVisitorMessageWithFirstTurn(
        input,
        projectId,
      ))?.message ?? null;
    }
    return this.addPublicAgentMessageAndTakeOwnership(input, projectId);
  }

  async getLatestEmailedPublicAgentMessage(
    conversationId: string,
    projectId?: string,
  ): Promise<PublicMessageRecord | null> {
    if (!projectId) throw new Error("Agent message reads require a project ID");
    return this.getLatestEmailedHumanMessage(projectId, conversationId);
  }

  async markPublicMessageAsEmailed(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<void> {
    if (!projectId) throw new Error("Agent message writes require a project ID");
    await this.markEmailed({ projectId, conversationId, messageId });
  }

  async markPublicDeliveredUpTo(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<string[]> {
    if (!projectId) throw new Error("Agent message writes require a project ID");
    return this.markDelivery({
      projectId,
      conversationId,
      upToMessageId: messageId,
      kind: "delivered",
    });
  }

  async markPublicReadUpTo(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<string[]> {
    if (!projectId) throw new Error("Agent message writes require a project ID");
    return this.markDelivery({
      projectId,
      conversationId,
      upToMessageId: messageId,
      kind: "read",
    });
  }

  async deletePublicAgentMessage(
    conversationId: string,
    messageId: string,
    projectId?: string,
  ): Promise<DeletePublicMessageResult> {
    if (!projectId) throw new Error("Agent message writes require a project ID");
    return this.deleteHumanMessage(projectId, conversationId, messageId);
  }

  async updateConversationStatus(
    conversationId: string,
    projectId: string,
    status: PublicConversationRecord["status"],
    closeReason?: PublicConversationRecord["closeReason"],
  ): Promise<void> {
    await this.setStatus(projectId, conversationId, status, closeReason);
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
    event: ChatOwnershipEvent,
  ): Promise<PublicConversationRecord["status"] | null> {
    return (await this.transitionOwnership({
      projectId,
      conversationId,
      event,
    })).status;
  }

  async updateConversation(
    conversationId: string,
    projectId: string,
    input: {
      visitorName?: string;
      visitorEmail?: string;
      metadata?: string;
    },
  ): Promise<PublicConversationRecord | null> {
    let metadata: Record<string, unknown> | undefined;
    if (input.metadata !== undefined) {
      try {
        const parsed: unknown = JSON.parse(input.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = {};
      }
    }
    return this.updateContact({
      projectId,
      conversationId,
      visitorName: input.visitorName,
      visitorEmail: input.visitorEmail,
      metadata,
    });
  }

  async updateConversationEmail(
    conversationId: string,
    projectId: string,
    email: string,
  ): Promise<void> {
    return this.updateEmail(projectId, conversationId, email);
  }

  async updateVisitorLastSeen(
    conversationId: string,
    projectId: string,
    presence: "active" | "background" = "active",
  ): Promise<PublicConversationRecord | null> {
    const updated = await this.updatePresence({
      projectId,
      conversationId,
      presence,
    });
    return updated ? this.get(projectId, conversationId) : null;
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
  ): Promise<{ updatedIds: string[]; skippedIds: string[] }> {
    return this.bulkApplyActions(projectId, conversationIds, action);
  }

  async setSnooze(
    conversationId: string,
    projectId: string,
    until: Date | null,
  ): Promise<void> {
    await this.applyAction({
      projectId,
      conversationId,
      action: { action: "snooze", until: until?.getTime() ?? null },
    });
  }

  async setPriority(
    conversationId: string,
    projectId: string,
    priority: "low" | "medium" | "high",
  ): Promise<void> {
    await this.applyAction({
      projectId,
      conversationId,
      action: { action: "priority", priority },
    });
  }

  async setAssignee(
    conversationId: string,
    projectId: string,
    assigneeId: string | null,
  ): Promise<void> {
    await this.applyAction({
      projectId,
      conversationId,
      action: { action: "assign", assigneeId },
    });
  }

  private async resolveChild(
    projectId: string,
    conversationId: string,
  ): Promise<PublicChildStub | null> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    const summary = await parent.getConversationSummary(conversationId);
    const legacyConversation = !summary || summary.visitorId === ""
      ? await this.legacy.get(projectId, conversationId)
      : null;
    if (!summary && !legacyConversation) return null;
    const registration = await parent.registerPublicConversation(conversationId);
    const child = await getPublicSubAgent(parent, registration.childName);
    if (legacyConversation) {
      const messages = await this.legacy.getMessages(projectId, conversationId);
      await child.importLegacyPublicConversation({
        conversation: legacyConversation,
        messages,
        checksum: await importChecksum(legacyConversation, messages),
      });
    }
    return child;
  }

  private async requireChild(
    projectId: string,
    conversationId: string,
  ): Promise<PublicChildStub> {
    const child = await this.resolveChild(projectId, conversationId);
    if (!child) throw new Error("Public conversation not found");
    return child;
  }

  private async readAllSummaries(
    projectId: string,
    filter: PublicConversationListQuery["inboxFilter"] = "all",
    search?: string,
  ): Promise<MavenConversationSummary[]> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    const summaries: MavenConversationSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await parent.listConversations({
        filter,
        sort: "newest",
        search,
        cursor,
        limit: 100,
      });
      summaries.push(...page.conversations);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return summaries;
  }

  private async readEverySummary(
    projectId: string,
  ): Promise<MavenConversationSummary[]> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return parent.listAllPublicConversationSummaries();
  }
}
