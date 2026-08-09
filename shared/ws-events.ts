// ─── WebSocket event contract (worker <-> widget <-> dashboard) ──────────────

export type ConversationStatus =
  | "active"
  | "waiting_agent"
  | "agent_replied"
  | "closed";

export interface MessagePayload {
  id: string;
  role: "visitor" | "bot" | "agent" | "system";
  content: string;
  imageUrl: string | null;
  sources: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: number;
}

export type SidechatStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "ready"
  | "failed";

export interface ReplyDraftSidechatMessageMetadata {
  draft: string;
}

export type SafeSidechatMessageMetadata = ReplyDraftSidechatMessageMetadata;

export interface SidechatMessagePayload {
  id: string;
  role: "agent" | "bot";
  content: string;
  kind: "text" | "reply_draft" | "approval";
  metadata: SafeSidechatMessageMetadata | null;
  senderName: string | null;
  createdAt: number;
}

export type SidechatServerEvent =
  | {
      type: "sidechat:message";
      conversationId: string;
      message: SidechatMessagePayload;
    }
  | {
      type: "sidechat:delta";
      conversationId: string;
      runId: string;
      delta: string;
    }
  | {
      type: "sidechat:activity";
      conversationId: string;
      runId: string;
      label: string;
      phase: "start" | "finish";
    }
  | {
      type: "sidechat:status";
      conversationId: string;
      status: SidechatStatus;
      runId: string | null;
    };

export type ServerEvent =
  | { type: "message:new"; conversationId: string; message: MessagePayload }
  | {
      type: "message:deleted";
      conversationId: string;
      messageId: string;
    }
  | {
      type: "status:change";
      conversationId: string;
      status: ConversationStatus;
      updatedAt: number;
    }
  | {
      type: "conversation:closed";
      conversationId: string;
      reason: string | null;
    }
  | {
      type: "conversation:archived";
      conversationId: string;
      archivedAt: number;
    }
  | {
      type: "conversation:updated";
      conversationId: string;
      updatedAt: number;
    }
  | {
      type: "customer:updated";
      projectId: string;
      customerIds: string[];
      updatedAt: number;
    }
  | {
      type: "message:status";
      conversationId: string;
      status: "delivered" | "read";
      messageIds: string[];
      at: number;
    }
  | { type: "pong"; t: number }
  | SidechatServerEvent;

export type ClientEvent =
  | { type: "ping"; t: number }
  | {
      type: "resume";
      lastPublicMessageId: string | null;
      lastSidechatMessageId: string | null;
    }
  | { type: "resume"; lastMessageId: string | null }
  | { type: "delivered"; upToMessageId: string }
  | { type: "read"; upToMessageId: string };

export type WsEvent = ServerEvent | ClientEvent;

export function isSidechatServerEvent(
  event: ServerEvent,
): event is SidechatServerEvent {
  return event.type.startsWith("sidechat:");
}
