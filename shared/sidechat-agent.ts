import type { JSONSchema7 } from "json-schema";

export type SidechatStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "ready"
  | "failed";

export interface SidechatSummary {
  conversationId: string;
  childName: string;
  status: SidechatStatus;
  updatedAt: number;
}

export interface MavenProjectState {
  sidechats: Record<string, SidechatSummary>;
  conversation?: MavenConversationSummary;
  inboxCounts?: MavenInboxCounts;
}

export type MavenConversationFilter =
  | "needs-you"
  | "inbox"
  | "snoozed"
  | "resolved"
  | "archived"
  | "flagged";

export type MavenConversationSort =
  | "newest"
  | "oldest"
  | "priority"
  | "botMessages";

export interface MavenConversationSummary {
  conversationId: string;
  publicChildName: `pub_${string}`;
  sidechatChildName: `sc_${string}` | null;
  sidechatStatus: SidechatStatus | null;
  customerId: string | null;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  telegramThreadId: string | null;
  slackThreadId?: string | null;
  status: "active" | "waiting_agent" | "agent_replied" | "closed";
  closeReason: "resolved" | "ended" | "spam" | "bot_resolved" | null;
  metadata: Record<string, unknown>;
  priority: "low" | "medium" | "high";
  assigneeId: string | null;
  snoozedUntil: number | null;
  archivedAt: number | null;
  purgeStartedAt: number | null;
  retentionScheduleId: string | null;
  visitorLastSeenAt: number | null;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  lastMessageId: string | null;
  lastMessageAuthor: "visitor" | "bot" | "agent" | "system" | null;
  lastMessagePreview: string | null;
  lastMessageSenderName: string | null;
  lastMessageEmailedAt: number | null;
  lastMessageCreatedAt: number | null;
  lastActivityAt: number;
  messageCount: number;
  botMessageCount: number;
  childRevision: number;
  sourceChecksum: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MavenConversationListQuery {
  filter?: MavenConversationFilter;
  status?: "open" | "closed" | "all";
  sort?: MavenConversationSort;
  search?: string;
  cursor?: string;
  offset?: number;
  limit?: number;
  now?: number;
  metadataKey?: string;
  metadataValue?: string;
}

export interface MavenConversationListResult {
  conversations: MavenConversationSummary[];
  nextCursor: string | null;
}

export type MavenInboxCounts = Record<MavenConversationFilter, number>;

export interface MavenConversationDashboardPage
  extends MavenConversationListResult {
  counts: MavenInboxCounts;
}

export interface MavenProjectConversationStats {
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  conversationsByDay: Array<{ day: string; count: number }>;
  conversationsByStatus: Array<{
    status: MavenConversationSummary["status"];
    count: number;
  }>;
  recentConversations: MavenConversationSummary[];
}

export interface MavenUsageLogQuery {
  periodStart: number;
  periodEnd: number;
  limit: number;
  offset: number;
  sortBy: "botMessages" | "createdAt";
  sortOrder: "asc" | "desc";
  status?: string;
  metadataKey?: string;
  metadataValue?: string;
}

export interface MavenUsageLogResult {
  summaries: MavenConversationSummary[];
  total: number;
  metadataKeys: string[];
}

export interface MavenPublicCustomerMutationUpdate {
  conversationId: string;
  customerId: string | null;
  visitorName?: string;
  visitorEmail?: string;
}

export interface MavenPublicCustomerMutation {
  mutationId: string;
  updates: MavenPublicCustomerMutationUpdate[];
}

export interface MavenPublicCustomerMutationResult {
  status: "completed" | "pending";
  updatedIds: string[];
}

export type MavenProjectEvent =
  | {
      type: "conversation-summary";
      summary: MavenConversationSummary;
    }
  | {
      type: "inbox-counts";
      counts: MavenInboxCounts;
    }
  | {
      type: "customer-updated";
      customerId: string;
    };

export interface SidechatSessionResponse {
  parentAgent: "MavenProjectAgent";
  parentName: string;
  childAgent: "MavenChatAgent";
  childName: string;
  token: string;
  expiresAt: number;
  created: boolean;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

interface SidechatClaimBase {
  userId: string;
  effectiveUserId: string;
  projectId: string;
  parentName: string;
  role: "owner" | "admin" | "member";
  iat: number;
  exp: number;
  aud: "replymaven-sidechat";
  v: 1;
}

export interface SidechatParentClaims extends SidechatClaimBase {
  scope: "parent";
}

export interface SidechatChildClaims extends SidechatClaimBase {
  scope: "child";
  conversationId: string;
  childName: string;
  canSubmit: boolean;
  canApproveOnce: boolean;
  canAlwaysAllow: boolean;
}

export type SidechatActorClaims =
  | SidechatParentClaims
  | SidechatChildClaims;

export interface SidechatSummarySessionResponse {
  summaries: SidechatSummary[];
  parentAgent: "MavenProjectAgent";
  parentName: string;
  token: string;
  expiresAt: number;
}

export interface ReplyDraftData {
  type: "data-reply-draft";
  id: string;
  data: {
    text: string;
    createdAt: number;
  };
}

export interface SidechatCustomerContext {
  projectId: string;
  conversationId: string;
  conversationStatus: string;
  archivedAt: number | null;
  customer: {
    id: string;
    name: string | null;
    externalId: string | null;
    email: string | null;
  } | null;
  publicSummary: string | null;
  recentPublicMessages: Array<{
    id: string;
    role: "visitor" | "bot" | "agent" | "system";
    content: string;
    createdAt: number;
  }>;
}

export interface SidechatToolDescriptor {
  connectionId: string;
  toolName: string;
  exposedName: string;
  displayName: string;
  description: string;
  inputSchema: JSONSchema7;
  catalogFingerprint: string;
  audience: "sidechat";
  safety?: "read" | "write" | "destructive";
  access: "read" | "write";
  enabled: boolean;
  alwaysAllowed?: boolean;
  source?: SidechatToolSource;
}

export type SidechatToolSafety = NonNullable<SidechatToolDescriptor["safety"]>;

export interface SidechatToolSource {
  kind: "mcp" | "http";
  name: string;
  icon: string | null;
}

export interface SidechatToolPresentation {
  displayName: string;
  source: SidechatToolSource;
}

export interface SidechatToolApprovalContext {
  safety: SidechatToolSafety;
  tool: SidechatToolPresentation;
}

export interface ExecuteProjectToolRequest {
  childName: string;
  conversationId: string;
  actorUserId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
  safety: SidechatToolSafety;
  access: "read" | "write";
  approvalMode: "none" | "once" | "always";
  input: unknown;
}

export interface PendingSidechatApprovalScope {
  approvalId: string;
  toolCallId: string;
  exposedName: string;
}

export interface ExecuteProjectToolResult {
  status: "completed" | "denied" | "unavailable" | "ambiguous" | "failed";
  output?: unknown;
  safeActivity: string;
  errorCode?: string;
}

export interface AlwaysAllowScope {
  projectId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
}

export interface SidechatToolAuditMetadata {
  projectId: string;
  childName: string;
  conversationId: string;
  connectionId: string;
  toolName: string;
  catalogFingerprint: string;
  access: "read" | "write";
  actorUserId: string | null;
  approvalMode: "none" | "once" | "always";
  status: ExecuteProjectToolResult["status"];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  safeActivity: string;
  errorCode?: string;
}
