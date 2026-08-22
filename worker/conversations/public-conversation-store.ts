import type {
  PublicConversationRecord,
  PublicConversationStatus,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import type {
  ChatOwnershipEvent,
  ChatOwnershipSnapshot,
  ConversationChatState,
} from "../chat-runtime/types";

export const PUBLIC_INBOX_FILTERS = [
  "needs-you",
  "inbox",
  "snoozed",
  "resolved",
  "archived",
  "flagged",
] as const;

export type PublicInboxFilter = (typeof PUBLIC_INBOX_FILTERS)[number];

export function parsePublicInboxFilter(
  value: string | undefined,
): PublicInboxFilter | undefined {
  if (value === "all") return "inbox";
  if (
    value != null &&
    (PUBLIC_INBOX_FILTERS as readonly string[]).includes(value)
  ) {
    return value as PublicInboxFilter;
  }
  return undefined;
}

export type PublicConversationAction =
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "resolve" }
  | { action: "snooze"; until: number | null }
  | { action: "assign"; assigneeId: string | null }
  | { action: "priority"; priority: "low" | "medium" | "high" }
  | { action: "flag_spam" };

export interface CreatePublicConversationInput {
  projectId: string;
  customerId?: string | null;
  visitorId: string;
  visitorName?: string | null;
  visitorEmail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PublicConversationListQuery {
  projectId: string;
  limit?: number;
  offset?: number;
  status?: "open" | "closed" | "all";
  search?: string;
  inboxFilter?: PublicInboxFilter;
}

export interface PublicConversationListResult {
  conversations: PublicConversationRecord[];
}

export interface PublicBulkConversationActionResult {
  updatedIds: string[];
  skippedIds: string[];
}

export type PublicInboxCounts = Record<PublicInboxFilter, number>;

export interface PublicMessagesBeforeInput {
  projectId: string;
  conversationId: string;
  beforeCreatedAt: number;
  limit?: number;
}

export interface PublicMessagePage {
  messages: PublicMessageRecord[];
  hasMore: boolean;
}

interface AppendPublicMessageFields {
  projectId: string;
  conversationId: string;
  content: string;
  imageUrls?: string[];
  sources?: PublicSourceReference[];
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  id?: string;
  idempotencyKey?: string | null;
  origin?: "widget" | "dashboard" | "telegram" | "email" | "mcp" | null;
  externalReplyTo?: string | null;
}

export type AppendPublicVisitorInput = AppendPublicMessageFields;

export interface AppendVisitorResult {
  message: PublicMessageRecord;
  isFirstVisitorTurn: boolean;
}

export type AppendPublicHumanInput = AppendPublicMessageFields;

export interface AppendPublicSystemInput {
  projectId: string;
  conversationId: string;
  kind:
    | "flagged"
    | "joined"
    | "snoozed"
    | "snooze_ended"
    | "drafted"
    | "review_summary"
    | "assigned";
  content: string;
  idempotencyKey?: string;
}

export interface DeletePublicMessageResult {
  deleted: boolean;
  reason?: "not_found" | "not_agent";
  message?: PublicMessageRecord;
}

export interface PublicConversationActionInput {
  projectId: string;
  conversationId: string;
  action: PublicConversationAction;
}

export interface PublicOwnershipTransitionInput {
  projectId: string;
  conversationId: string;
  event: ChatOwnershipEvent;
}

export interface PublicOwnershipTransitionResult {
  status: PublicConversationStatus | null;
  conversation: PublicConversationRecord | null;
}

export interface PublicTeamRequestClaimInput {
  projectId: string;
  conversationId: string;
  summary: string;
}

export type PublicTeamRequestClaimResult =
  | { status: "claimed" }
  | { status: "already_requested" }
  | { status: "contact_required"; requiredFields: Array<"name" | "email"> }
  | { status: "unavailable" };

export interface PublicTeamRequestSummaryInput {
  projectId: string;
  conversationId: string;
  acceptanceToken: string;
}

export interface PublicTeamRequestAcceptance {
  acceptanceToken: string;
  acceptedAt: string;
  notificationState: string;
  summary: string;
  summaryMessageId: string;
  summaryPending: boolean;
}

export interface PublicLegacyEscalationMetadataUpdate {
  expectedMavenAcceptanceToken: string | null;
  summary: string;
  summaryMessageId: string;
  escalatedAt?: string;
  summaryPending?: boolean;
}

export interface PublicLastMessagePreview {
  id: string;
  author: PublicMessageRecord["author"];
  content: string;
  senderName: string | null;
  emailedAt: number | null;
  createdAt: number;
}

export interface AppendPublicBotInput extends AppendPublicMessageFields {
  expected: {
    status: PublicConversationStatus;
    chatState: string | null;
  };
}

export interface PublicExternalActionLeaseInput {
  projectId: string;
  conversationId: string;
  ownership?: { status: string; chatState: string | null };
  now?: number;
}

export interface PublicExternalActionLease {
  projectId: string;
  conversationId: string;
  leaseId: string;
  ownershipRevision: number;
  acquiredAt: number;
}

export interface PublicDeliveryUpdateInput {
  projectId: string;
  conversationId: string;
  upToMessageId: string;
  kind: "delivered" | "read";
}

export interface PublicEmailUpdateInput {
  projectId: string;
  conversationId: string;
  messageId: string;
}

export interface PublicPresenceUpdateInput {
  projectId: string;
  conversationId: string;
  presence: "active" | "background";
}

export interface PublicChatChildState {
  status: PublicConversationStatus;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  archived: boolean;
  revision: number;
}

export interface PublicContactUpdateInput {
  projectId: string;
  conversationId: string;
  visitorName?: string;
  visitorEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface PublicCustomerLinkInput {
  projectId: string;
  conversationId: string;
  customerId: string | null;
}

export interface PublicCustomerMutationUpdate {
  conversationId: string;
  customerId: string | null;
  visitorName?: string;
  visitorEmail?: string;
}

export interface PublicCustomerMutationInput {
  projectId: string;
  mutationId: string;
  updates: PublicCustomerMutationUpdate[];
}

export interface PublicCustomerMutationResult {
  status: "completed" | "pending";
  updatedIds: string[];
}

export interface PublicConversationAnalytics {
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  conversationsByDay: Array<{ day: string; count: number }>;
  conversationsByStatus: Array<{
    status: PublicConversationStatus;
    count: number;
  }>;
  recentConversations: PublicConversationRecord[];
}

export interface PublicUsageConversationQuery {
  projectIds: string[];
  periodStart: number;
  periodEnd: number;
  limit: number;
  offset: number;
  sortBy: "botMessages" | "createdAt";
  sortOrder: "asc" | "desc";
  status?: string;
  metaKey?: string;
  metaValue?: string;
}

export interface PublicUsageConversationRow {
  conversation: PublicConversationRecord;
  botMessageCount: number;
}

export interface PublicUsageConversationResult {
  rows: PublicUsageConversationRow[];
  total: number;
  metaKeys: string[];
}

export interface PublicRetentionClaim {
  id: string;
  projectId: string;
  purgeStartedAt: number;
}

export interface PublicMessageAttachmentSource {
  author: PublicMessageRecord["author"];
  userId: string | null;
  imageUrls: string[];
}

export interface LegacyPublicConversationCreateInput {
  projectId: string;
  customerId?: string | null;
  visitorId: string;
  visitorName?: string | null;
  visitorEmail?: string | null;
  metadata?: string | null;
}

export interface LegacyPublicMessageInput {
  conversationId: string;
  content: string;
  imageUrl?: string | null;
  sources?: string | null;
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  emailedAt?: Date | null;
  deliveredAt?: Date | null;
  readAt?: Date | null;
  idempotencyKey?: string | null;
  origin?: "widget" | "dashboard" | "telegram" | "email" | "mcp" | null;
  externalReplyTo?: string | null;
}

export interface PublicConversationStore {
  create(input: CreatePublicConversationInput): Promise<PublicConversationRecord>;
  get(projectId: string, conversationId: string): Promise<PublicConversationRecord | null>;
  getOperational(projectId: string, conversationId: string): Promise<PublicConversationRecord | null>;
  getActiveByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getLastByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getRecentByVisitorEmail(projectId: string, email: string): Promise<PublicConversationRecord | null>;
  list(query: PublicConversationListQuery): Promise<PublicConversationListResult>;
  bulkApplyActions(projectId: string, conversationIds: string[], action: PublicConversationAction): Promise<PublicBulkConversationActionResult>;
  listNeedsReview(projectId: string, since: number): Promise<PublicConversationRecord[]>;
  listAgentMode(projectId: string): Promise<PublicConversationRecord[]>;
  listByCustomer(projectId: string, customerId: string): Promise<PublicConversationRecord[]>;
  getConversationCountsByCustomer(projectId: string, customerIds: string[]): Promise<Map<string, number>>;
  listByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord[]>;
  getInboxCounts(projectId: string): Promise<PublicInboxCounts>;
  getMessages(projectId: string, conversationId: string): Promise<PublicMessageRecord[]>;
  getRecentMessages(projectId: string, conversationId: string, limit: number): Promise<PublicMessagePage>;
  getMessagesBefore(input: PublicMessagesBeforeInput): Promise<PublicMessagePage>;
  getMessagesSince(projectId: string, conversationId: string, since: number): Promise<PublicMessageRecord[]>;
  getMessage(projectId: string, conversationId: string, messageId: string): Promise<PublicMessageRecord | null>;
  hasVisitorMessages(projectId: string, conversationId: string): Promise<boolean>;
  getLatestEmailedHumanMessage(projectId: string, conversationId: string): Promise<PublicMessageRecord | null>;
  appendVisitor(input: AppendPublicVisitorInput): Promise<AppendVisitorResult | null>;
  appendHuman(input: AppendPublicHumanInput): Promise<PublicMessageRecord>;
  appendBot(input: AppendPublicBotInput): Promise<PublicMessageRecord | null>;
  appendSystem(input: AppendPublicSystemInput): Promise<PublicMessageRecord>;
  deleteHumanMessage(projectId: string, conversationId: string, messageId: string): Promise<DeletePublicMessageResult>;
  applyAction(input: PublicConversationActionInput): Promise<PublicConversationRecord | null>;
  transitionOwnership(input: PublicOwnershipTransitionInput): Promise<PublicOwnershipTransitionResult>;
  takeHumanOwnership(projectId: string, conversationId: string): Promise<{ status: PublicConversationStatus; chatState: string | null } | null>;
  resolveByAi(projectId: string, conversationId: string): Promise<boolean>;
  setStatus(projectId: string, conversationId: string, status: PublicConversationStatus, closeReason?: PublicConversationRecord["closeReason"]): Promise<PublicConversationRecord | null>;
  reopen(projectId: string, conversationId: string, status?: "active" | "agent_replied"): Promise<PublicConversationRecord | null>;
  prepareContactSupportOwnership(projectId: string, conversationId: string): Promise<"waiting_agent" | "agent_replied" | null>;
  closeOpenAsSpam(projectId: string, visitorId: string, visitorEmail?: string | null): Promise<string[]>;
  claimTeamRequest(input: PublicTeamRequestClaimInput): Promise<PublicTeamRequestClaimResult>;
  getTeamRequestAcceptance(projectId: string, conversationId: string, acceptanceToken: string): Promise<PublicTeamRequestAcceptance | null>;
  claimTeamRequestNotification(projectId: string, conversationId: string, acceptanceToken: string): Promise<boolean>;
  addTeamRequestSummary(projectId: string, conversationId: string, acceptanceToken: string): Promise<PublicMessageRecord | null>;
  completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean>;
  updateLegacyEscalationMetadata(projectId: string, conversationId: string, update: PublicLegacyEscalationMetadataUpdate): Promise<PublicConversationRecord | null>;
  persistTeamRequestTelegramThreadId(projectId: string, conversationId: string, acceptanceToken: string, threadId: string): Promise<boolean>;
  updateTelegramThreadId(projectId: string, conversationId: string, threadId: string): Promise<void>;
  acquireExternalAction(input: PublicExternalActionLeaseInput): Promise<PublicExternalActionLease | null>;
  releaseExternalAction(input: PublicExternalActionLease): Promise<void>;
  markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]>;
  markEmailed(input: PublicEmailUpdateInput): Promise<boolean>;
  updatePresence(input: PublicPresenceUpdateInput): Promise<PublicChatChildState | null>;
  updateEmail(projectId: string, conversationId: string, email: string): Promise<void>;
  updateContact(input: PublicContactUpdateInput): Promise<PublicConversationRecord | null>;
  updatePendingTeamRequestContact(projectId: string, conversationId: string, ownership: ChatOwnershipSnapshot, update: { visitorName?: string; visitorEmail?: string; awaitingContactFields: Array<"name" | "email">; contactDeclined?: boolean }): Promise<PublicConversationRecord | null>;
  getChatState(projectId: string, conversationId: string): Promise<ConversationChatState>;
  saveChatState(projectId: string, conversationId: string, chatState: ConversationChatState): Promise<void>;
  updateCustomer(input: PublicCustomerLinkInput): Promise<PublicConversationRecord | null>;
  applyCustomerMutation(input: PublicCustomerMutationInput): Promise<PublicCustomerMutationResult>;
  getAnalytics(projectIds: string[], since: number): Promise<PublicConversationAnalytics>;
  queryUsageConversations(query: PublicUsageConversationQuery): Promise<PublicUsageConversationResult>;
  claimExpiredArchives(retentionCutoff: number, staleClaimCutoff: number, claimAt: number, limit: number): Promise<PublicRetentionClaim[]>;
  listMessageAttachments(projectId: string, conversationId: string): Promise<PublicMessageAttachmentSource[]>;
  isUploadKeyReferencedElsewhere(key: string, conversationId: string): Promise<boolean>;
  deleteRetentionClaim(projectId: string, conversationId: string, purgeStartedAt: number): Promise<boolean>;

  // Temporary compatibility names keep the behavior-preserving cutover small.
  // They return storage-neutral records and disappear with the legacy runtime.
  getConversationById(conversationId: string, projectId: string): Promise<PublicConversationRecord | null>;
  getOperationalConversationById(conversationId: string, projectId: string): Promise<PublicConversationRecord | null>;
  getActiveConversationByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getLastConversationByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getRecentConversationByVisitorEmail(projectId: string, email: string): Promise<PublicConversationRecord | null>;
  createConversation(input: LegacyPublicConversationCreateInput): Promise<PublicConversationRecord>;
  getNeedsReviewSince(projectId: string, since: number): Promise<PublicConversationRecord[]>;
  getAgentModeConversations(projectId: string): Promise<PublicConversationRecord[]>;
  getPublicMessages(conversationId: string, projectId?: string): Promise<PublicMessageRecord[]>;
  getRecentPublicMessages(conversationId: string, limit?: number, projectId?: string): Promise<PublicMessagePage>;
  getPublicMessagesBefore(conversationId: string, beforeCreatedAt: Date, limit?: number, projectId?: string): Promise<PublicMessagePage>;
  getPublicMessagesSince(conversationId: string, since: number, projectId?: string): Promise<PublicMessageRecord[]>;
  getPublicMessageById(messageId: string, projectId?: string, conversationId?: string): Promise<PublicMessageRecord | null>;
  addPublicVisitorMessageWithFirstTurn(input: LegacyPublicMessageInput, projectId: string): Promise<AppendVisitorResult | null>;
  addPublicAgentMessageAndTakeOwnership(input: LegacyPublicMessageInput, projectId: string): Promise<PublicMessageRecord | null>;
  addPublicBotMessageIfOwnershipMatches(input: LegacyPublicMessageInput, projectId: string, expected: { status: PublicConversationStatus; chatState: string | null }): Promise<PublicMessageRecord | null>;
  addPublicSystemMessage(conversationId: string, kind: AppendPublicSystemInput["kind"], content: string, idempotencyKey?: string, projectId?: string): Promise<PublicMessageRecord | null>;
  addPublicMessage(input: LegacyPublicMessageInput & { role: "visitor" | "agent" }, projectId: string): Promise<PublicMessageRecord | null>;
  getLatestEmailedPublicAgentMessage(conversationId: string, projectId?: string): Promise<PublicMessageRecord | null>;
  markPublicMessageAsEmailed(conversationId: string, messageId: string, projectId?: string): Promise<void>;
  markPublicDeliveredUpTo(conversationId: string, messageId: string, projectId?: string): Promise<string[]>;
  markPublicReadUpTo(conversationId: string, messageId: string, projectId?: string): Promise<string[]>;
  deletePublicAgentMessage(conversationId: string, messageId: string, projectId?: string): Promise<DeletePublicMessageResult>;
  updateConversationStatus(conversationId: string, projectId: string, status: PublicConversationStatus, closeReason?: PublicConversationRecord["closeReason"]): Promise<void>;
  reopenConversation(conversationId: string, projectId: string, status?: "active" | "agent_replied"): Promise<PublicConversationRecord | null>;
  transitionChatOwnership(conversationId: string, projectId: string, event: ChatOwnershipEvent): Promise<PublicConversationStatus | null>;
  updateConversation(conversationId: string, projectId: string, input: { visitorName?: string; visitorEmail?: string; metadata?: string }): Promise<PublicConversationRecord | null>;
  updateConversationEmail(conversationId: string, projectId: string, email: string): Promise<void>;
  updateVisitorLastSeen(conversationId: string, projectId: string, presence?: "active" | "background"): Promise<PublicConversationRecord | null>;
  resolveConversationByAi(conversationId: string, projectId: string): Promise<boolean>;
  closeOpenConversationsAsSpam(projectId: string, visitorId: string, visitorEmail?: string | null): Promise<string[]>;
  bulkUpdateConversations(projectId: string, conversationIds: string[], action: PublicConversationAction, now?: Date): Promise<PublicBulkConversationActionResult>;
  setSnooze(conversationId: string, projectId: string, until: Date | null): Promise<void>;
  setPriority(conversationId: string, projectId: string, priority: "low" | "medium" | "high"): Promise<void>;
  setAssignee(conversationId: string, projectId: string, assigneeId: string | null): Promise<void>;
}
