import type { DrizzleD1Database } from "drizzle-orm/d1";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import type {
  MavenConversationListQuery,
  MavenConversationListResult,
  MavenConversationSummary,
} from "../../shared/sidechat-agent";
import type { AppEnv } from "../types";
import { D1PublicConversationStore } from "./d1-public-conversation-store";
import type {
  AppendPublicBotInput,
  AppendPublicHumanInput,
  AppendPublicSystemInput,
  AppendPublicVisitorInput,
  AppendVisitorResult,
  CreatePublicConversationInput,
  DeletePublicMessageResult,
  PublicChatChildState,
  PublicContactUpdateInput,
  PublicConversationAction,
  PublicConversationActionInput,
  PublicConversationCounts,
  PublicConversationListQuery,
  PublicConversationListResult,
  PublicCustomerLinkInput,
  PublicDeliveryUpdateInput,
  PublicEmailUpdateInput,
  PublicInboxCounts,
  PublicMessageAttachmentSource,
  PublicMessagePage,
  PublicMessagesBeforeInput,
  PublicPresenceUpdateInput,
  PublicConversationStore,
} from "./public-conversation-store";

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
  getInboxCounts(): Promise<PublicInboxCounts>;
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
}

function newMessage(
  input: NewMessageInput,
  author: PublicMessageRecord["author"],
  options: { systemKind?: string | null; id?: string } = {},
): PublicMessageRecord {
  return {
    id: options.id ?? crypto.randomUUID(),
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
  };
}

export class AgentPublicConversationStore {
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
    const summaries = await this.readAllSummaries(projectId);
    const match = summaries.find((summary) =>
      summary.visitorId === visitorId &&
      summary.status !== "closed" &&
      summary.archivedAt === null
    );
    return match ? this.get(projectId, match.conversationId) : null;
  }

  async getLastByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord | null> {
    const summaries = await this.readAllSummaries(projectId);
    const match = summaries.find((summary) => summary.visitorId === visitorId);
    return match ? this.get(projectId, match.conversationId) : null;
  }

  async getRecentByVisitorEmail(
    projectId: string,
    email: string,
  ): Promise<PublicConversationRecord | null> {
    const normalized = email.trim().toLowerCase();
    const summaries = await this.readAllSummaries(projectId);
    const match = summaries.find((summary) =>
      summary.visitorEmail?.trim().toLowerCase() === normalized
    );
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
    const summaries = await this.readAllSummaries(projectId);
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
    return (await this.readAllSummaries(input.projectId))
      .filter((summary) => summary.updatedAt > input.since)
      .slice(0, limit)
      .map((summary) => summaryToConversation(summary, input.projectId));
  }

  async listNeedsReview(
    projectId: string,
    since: number,
  ): Promise<PublicConversationRecord[]> {
    return (await this.readAllSummaries(projectId))
      .filter((summary) =>
        summary.updatedAt >= since &&
        summary.metadata.needsReview === true
      )
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async listAgentMode(projectId: string): Promise<PublicConversationRecord[]> {
    return (await this.readAllSummaries(projectId))
      .filter((summary) =>
        summary.status === "waiting_agent" ||
        summary.status === "agent_replied"
      )
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async getInboxCounts(projectId: string): Promise<PublicInboxCounts> {
    const parent = await getPublicParent(
      this.context.env.MAVEN_PROJECT_AGENT,
      projectId,
    );
    return parent.getInboxCounts();
  }

  async listByCustomer(
    projectId: string,
    customerId: string,
  ): Promise<PublicConversationRecord[]> {
    return (await this.readAllSummaries(projectId))
      .filter((summary) => summary.customerId === customerId)
      .map((summary) => summaryToConversation(summary, projectId));
  }

  async getConversationCountsByCustomer(
    projectId: string,
    customerIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map(customerIds.map((customerId) => [customerId, 0]));
    for (const summary of await this.readAllSummaries(projectId)) {
      if (summary.customerId && counts.has(summary.customerId)) {
        counts.set(summary.customerId, (counts.get(summary.customerId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async listByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord[]> {
    return (await this.readAllSummaries(projectId))
      .filter((summary) => summary.visitorId === visitorId)
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
    const updatedIds: string[] = [];
    const skippedIds: string[] = [];
    for (const conversationId of conversationIds) {
      const updated = await this.applyAction({ projectId, conversationId, action });
      (updated ? updatedIds : skippedIds).push(conversationId);
    }
    return { updatedIds, skippedIds };
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

  async updateCustomer(
    input: PublicCustomerLinkInput,
  ): Promise<PublicConversationRecord | null> {
    const child = await this.resolveChild(input.projectId, input.conversationId);
    return child ? child.updateCustomer(input) : null;
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

  async listMessageAttachments(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageAttachmentSource[]> {
    const child = await this.resolveChild(projectId, conversationId);
    return child ? child.getAttachmentManifest() : [];
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
    if (!projectId || !conversationId) {
      throw new Error("Agent message reads require project and conversation IDs");
    }
    return this.getMessage(projectId, conversationId, messageId);
  }

  async addPublicVisitorMessageWithFirstTurn(
    input: { conversationId: string; content: string; imageUrl?: string | null },
    projectId: string,
  ): Promise<AppendVisitorResult | null> {
    return this.appendVisitor({
      projectId,
      conversationId: input.conversationId,
      content: input.content,
      imageUrls: input.imageUrl ? [input.imageUrl] : [],
    });
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
}
