import type {
  PublicConversationRecord,
  PublicConversationStatus,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../shared/maven-conversation";
import type { ChatOwnershipEvent } from "../chat-runtime/types";

export type PublicInboxFilter =
  | "needs-you"
  | "all"
  | "snoozed"
  | "resolved"
  | "archived"
  | "flagged";

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

export interface PublicConversationUpdatesQuery {
  projectId: string;
  since: number;
  limit?: number;
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
    | "review_summary";
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

export interface PublicConversationStore {
  create(input: CreatePublicConversationInput): Promise<PublicConversationRecord>;
  get(projectId: string, conversationId: string): Promise<PublicConversationRecord | null>;
  getActiveByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getLastByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getRecentByVisitorEmail(projectId: string, email: string): Promise<PublicConversationRecord | null>;
  list(query: PublicConversationListQuery): Promise<PublicConversationListResult>;
  listUpdates(query: PublicConversationUpdatesQuery): Promise<PublicConversationRecord[]>;
  listNeedsReview(projectId: string, since: number): Promise<PublicConversationRecord[]>;
  listAgentMode(projectId: string): Promise<PublicConversationRecord[]>;
  listByCustomer(projectId: string, customerId: string): Promise<PublicConversationRecord[]>;
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
  appendSystem(input: AppendPublicSystemInput): Promise<PublicMessageRecord>;
  deleteHumanMessage(projectId: string, conversationId: string, messageId: string): Promise<DeletePublicMessageResult>;
  applyAction(input: PublicConversationActionInput): Promise<PublicConversationRecord | null>;
  transitionOwnership(input: PublicOwnershipTransitionInput): Promise<PublicOwnershipTransitionResult>;
  claimTeamRequest(input: PublicTeamRequestClaimInput): Promise<PublicTeamRequestClaimResult>;
  completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean>;
  acquireExternalAction(input: PublicExternalActionLeaseInput): Promise<PublicExternalActionLease | null>;
  releaseExternalAction(input: PublicExternalActionLease): Promise<void>;
  markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]>;
  markEmailed(input: PublicEmailUpdateInput): Promise<boolean>;
  updatePresence(input: PublicPresenceUpdateInput): Promise<PublicChatChildState | null>;
  updateContact(input: PublicContactUpdateInput): Promise<PublicConversationRecord | null>;
  updateCustomer(input: PublicCustomerLinkInput): Promise<PublicConversationRecord | null>;
}
