import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  type MessagePayload,
  type ServerEvent,
} from "../../shared/ws-events";

interface ConversationDetailMessage extends MessagePayload {
  toolExecutions?: unknown[];
  emailedAt?: string | null;
  userId?: string | null;
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

function buildWsUrl(projectId: string, conversationId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/ws`;
}

function toIsoMessage(message: MessagePayload): ConversationDetailMessage {
  return {
    ...message,
    // Dashboard renders ISO strings; the wire format is epoch ms.
    createdAt: new Date(message.createdAt).toISOString() as unknown as number,
    toolExecutions: [],
  };
}

export function useConversationWs(
  projectId: string | undefined,
  conversationId: string | null,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId || !conversationId) return;

    let lastSeenMessageId: string | null = null;

    const socket = new ReconnectingWebSocket(
      () => buildWsUrl(projectId, conversationId),
    );

    function handleOpen(): void {
      socket.send(
        JSON.stringify({ type: "resume", lastMessageId: lastSeenMessageId }),
      );
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
        const incoming = parsed.message;
        lastSeenMessageId = incoming.id;
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            const optimisticIdx = old.messages.findIndex(
              (m) =>
                (m as ConversationDetailMessage & { _optimistic?: boolean })
                  ._optimistic &&
                m.role === incoming.role &&
                m.content === incoming.content &&
                Boolean(m.imageUrl) === Boolean(incoming.imageUrl),
            );
            const dedupeIdx = old.messages.findIndex(
              (m) => m.id === incoming.id,
            );
            const next = [...old.messages];
            const replacement = toIsoMessage(incoming);
            if (optimisticIdx >= 0) {
              next[optimisticIdx] = replacement;
            } else if (dedupeIdx >= 0) {
              next[dedupeIdx] = { ...next[dedupeIdx], ...replacement };
            } else {
              next.push(replacement);
            }
            return { ...old, messages: next };
          },
        );
      } else if (parsed.type === "status:change") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversation: { ...old.conversation, status: parsed.status },
            };
          },
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      } else if (parsed.type === "conversation:closed") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversation: {
                ...old.conversation,
                status: "closed",
                closeReason: parsed.reason,
              },
            };
          },
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
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
