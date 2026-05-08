// ─── WebSocket event contract (worker <-> widget <-> dashboard) ──────────────

export type ConversationStatus =
  | "active"
  | "waiting_agent"
  | "agent_replied"
  | "closed";

export interface MessagePayload {
  id: string;
  role: "visitor" | "bot" | "agent";
  content: string;
  imageUrl: string | null;
  sources: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  createdAt: number;
}

export type ServerEvent =
  | { type: "message:new"; conversationId: string; message: MessagePayload }
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
  | { type: "pong"; t: number };

export type ClientEvent =
  | { type: "ping"; t: number }
  | { type: "resume"; lastMessageId: string | null };

export type WsEvent = ServerEvent | ClientEvent;
