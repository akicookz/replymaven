import type { InboxFilter } from "./filters";
import type {
  SidechatToolPresentation,
  SidechatToolSafety,
} from "../../../shared/sidechat-agent";

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
}

export type MessageRole = "visitor" | "bot" | "agent" | "system";
export type MessagePresentationAction =
  | { type: "add_to_reply"; draft: string }
  | {
      type: "approval";
      approvalId: string;
      toolCallId: string;
      canAlwaysAllow: boolean;
      tool?: SidechatToolPresentation & { safety: SidechatToolSafety };
    };

export type SidechatToolTraceState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export type SidechatTraceItem =
  | {
      type: "reasoning";
      id: string;
      text: string;
      state: "streaming" | "done";
    }
  | {
      type: "tool";
      id: string;
      toolCallId: string;
      state: SidechatToolTraceState;
      tool: SidechatToolPresentation & { safety: SidechatToolSafety };
      input?: unknown;
      output?: unknown;
      errorText?: string;
      durationMs?: number;
      approval?: {
        id: string;
        approved?: boolean;
        canAlwaysAllow: boolean;
      };
    };

export interface Message {
  id: string;
  // Dashboard threads include centred `system` event rows (snoozed, flagged,
  // joined, …) in addition to the conversational roles.
  role: MessageRole;
  content: string;
  presentationAction?: MessagePresentationAction;
  sidechatTrace?: SidechatTraceItem[];
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
