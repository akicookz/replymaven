import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  compareMessagePositions,
  type MessagePayload,
  type ServerEvent,
  type StableMessagePosition,
} from "../../shared/ws-events";
import { isImagePlaceholderContent } from "../../shared/message-images";
import { invalidateCustomerProjectQueries } from "./customers";

export interface ConversationDetailMessage
  extends Omit<MessagePayload, "createdAt"> {
  createdAt: string;
  toolExecutions?: unknown[];
  emailedAt?: string | null;
  userId?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}

interface ConversationDetailData {
  conversation: {
    id: string;
    status: string;
    closeReason: string | null;
    lastActivityAt?: string | null;
    updatedAt: string;
    [key: string]: unknown;
  };
  messages: ConversationDetailMessage[];
  [key: string]: unknown;
}

export type MessageResumeCursor = StableMessagePosition;

export interface ConversationRealtimeMessageState {
  messages: ConversationDetailMessage[];
  cursor: MessageResumeCursor | null;
}

export function createConversationResumeEvent(
  cursor: MessageResumeCursor | null,
): { type: "resume"; lastMessageId: string | null } {
  return { type: "resume", lastMessageId: cursor?.id ?? null };
}

type ConversationMessageEvent = Extract<ServerEvent, { type: "message:new" }>;

export function reduceConversationMessageEvent(
  state: ConversationRealtimeMessageState,
  event: ServerEvent,
): ConversationRealtimeMessageState {
  if (event.type !== "message:new") return state;

  const incoming = event.message;
  const incomingMessage = toIsoMessage(incoming);
  const optimisticIndex = state.messages.findIndex(
    (message) =>
      (
        message as ConversationDetailMessage & {
          _optimistic?: boolean;
        }
      )._optimistic &&
      message.role === incoming.role &&
      (message.content === incoming.content ||
        (!message.content && isImagePlaceholderContent(incoming.content))) &&
      Boolean(message.imageUrl) === Boolean(incoming.imageUrl),
  );
  const nextMessages = [...state.messages];
  const existingIndex = nextMessages.findIndex(
    (message) => message.id === incoming.id,
  );
  if (optimisticIndex >= 0) {
    nextMessages[optimisticIndex] = incomingMessage;
  } else if (existingIndex >= 0) {
    nextMessages[existingIndex] = {
      ...nextMessages[existingIndex],
      ...incomingMessage,
    };
  } else {
    nextMessages.push(incomingMessage);
  }
  nextMessages.sort(compareCachedMessages);
  return {
    messages: nextMessages,
    cursor: advanceCursor(state.cursor, incoming),
  };
}

function buildWsUrl(projectId: string, conversationId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/ws`;
}

function toIsoMessage(message: MessagePayload): ConversationDetailMessage {
  return {
    ...message,
    createdAt: new Date(message.createdAt).toISOString(),
    toolExecutions: [],
  };
}

function latestMessageCursor(
  messages: Array<{ id: string; createdAt: string }> | undefined,
): MessageResumeCursor | null {
  let latest: MessageResumeCursor | null = null;
  for (const message of messages ?? []) {
    latest = advanceCursor(latest, cachedMessagePosition(message));
  }
  return latest;
}

function cachedMessagePosition(message: {
  id: string;
  createdAt: string;
}): StableMessagePosition {
  return {
    id: message.id,
    createdAt: Date.parse(message.createdAt),
  };
}

function compareCachedMessages(
  left: { id: string; createdAt: string },
  right: { id: string; createdAt: string },
): number {
  return compareMessagePositions(
    cachedMessagePosition(left),
    cachedMessagePosition(right),
  );
}

function advanceCursor(
  current: MessageResumeCursor | null,
  candidate: StableMessagePosition,
): MessageResumeCursor {
  if (!current || compareMessagePositions(candidate, current) > 0) {
    return { id: candidate.id, createdAt: candidate.createdAt };
  }
  return current;
}

export function useConversationWs(
  projectId: string | undefined,
  conversationId: string | null,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId || !conversationId) return;
    const activeProjectId = projectId;
    let cursor = latestMessageCursor(
      queryClient.getQueryData<ConversationDetailData>([
        "conversation-detail",
        conversationId,
      ])?.messages,
    );
    const socket = new ReconnectingWebSocket(
      () => buildWsUrl(projectId, conversationId),
    );

    function handleOpen(): void {
      socket.send(JSON.stringify(createConversationResumeEvent(cursor)));
    }

    function handleMessage(ev: MessageEvent<string>): void {
      let parsed: ServerEvent | null = null;
      try {
        parsed = JSON.parse(ev.data) as ServerEvent;
      } catch {
        return;
      }
      if (!parsed) return;

      if (parsed.type === "message:new") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            const next = reduceConversationMessageEvent(
              { messages: old.messages, cursor },
              parsed as ConversationMessageEvent,
            );
            cursor = next.cursor;
            return { ...old, messages: next.messages };
          },
        );
      } else if (parsed.type === "message:deleted") {
        const deletedId = parsed.messageId;
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                messages: old.messages.filter((message) =>
                  message.id !== deletedId
                ),
              }
            : old,
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      } else if (parsed.type === "status:change") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                conversation: { ...old.conversation, status: parsed.status },
              }
            : old,
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      } else if (parsed.type === "conversation:closed") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                conversation: {
                  ...old.conversation,
                  status: "closed",
                  closeReason: parsed.reason,
                },
              }
            : old,
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      } else if (parsed.type === "conversation:archived") {
        const archivedAt = new Date(parsed.archivedAt).toISOString();
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                conversation: { ...old.conversation, archivedAt },
              }
            : old,
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      } else if (parsed.type === "conversation:updated") {
        queryClient.invalidateQueries({
          queryKey: ["conversation-detail", conversationId],
        });
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
        void invalidateCustomerProjectQueries(queryClient, activeProjectId);
      } else if (parsed.type === "message:status") {
        const ids = new Set(parsed.messageIds);
        const at = new Date(parsed.at).toISOString();
        const markRead = parsed.status === "read";
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                messages: old.messages.map((message) => {
                  if (!ids.has(message.id)) return message;
                  return markRead
                    ? {
                        ...message,
                        readAt: at,
                        deliveredAt: message.deliveredAt ?? at,
                      }
                    : {
                        ...message,
                        deliveredAt: message.deliveredAt ?? at,
                      };
                }),
              }
            : old,
        );
      }
    }

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [projectId, conversationId, queryClient]);
}
