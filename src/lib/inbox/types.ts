import type { InboxFilter } from "./filters";
import type {
  SafeSidechatMessageMetadata,
  SidechatStatus,
} from "../../../shared/ws-events";

// Shared inbox data shapes consumed by the Conversations orchestrator and the
// inbox presentational components (MessageList / ReadingPane / FocusView and
// their descendants in Tasks 8–13).

export interface LastMessagePreview {
  id: string;
  role: "visitor" | "bot" | "agent" | "system";
  content: string;
  senderName: string | null;
  emailedAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  customerId: string | null;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  closeReason: string | null;
  priority?: "low" | "medium" | "high" | null;
  snoozedUntil?: string | null;
  archivedAt?: string | null;
  purgeStartedAt?: string | null;
  assigneeId?: string | null;
  /** Whether the visitor is currently banned (populated by the detail endpoint). */
  visitorBlocked?: boolean;
  metadata: string | null;
  visitorLastSeenAt: string | null;
  visitorPresence: string | null;
  visitorLastOnlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string | null;
  lastMessage?: LastMessagePreview | null;
  sidechatStatus?: SidechatStatus;
  sidechatRunId?: string | null;
  sidechatUpdatedAt?: string | null;
}

export type MessageRole = "visitor" | "bot" | "agent" | "system";
export type SidechatMessageKind = "text" | "reply_draft" | "approval";

export interface Message {
  id: string;
  // Dashboard threads include centred `system` event rows (snoozed, flagged,
  // joined, …) in addition to the conversational roles.
  role: MessageRole;
  content: string;
  channel?: "public" | "sidechat";
  kind?: SidechatMessageKind;
  metadata?: SafeSidechatMessageMetadata | null;
  imageUrl?: string | null;
  sources?: string | null;
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  createdAt: string;
  emailedAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export type InboxCounts = Record<InboxFilter, number>;

export type BulkConversationAction =
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "resolve" }
  | { action: "snooze"; until: number | null }
  | { action: "assign"; assigneeId: string | null }
  | { action: "priority"; priority: "low" | "medium" | "high" }
  | { action: "flag_spam" };
