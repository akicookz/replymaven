import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  type MessagePayload,
  type ServerEvent,
  type SidechatMessagePayload,
  type SidechatStatus,
} from "../../shared/ws-events";
import { isImagePlaceholderContent } from "../../shared/message-images";
import { invalidateCustomerProjectQueries } from "./customers";

interface ConversationDetailMessage extends MessagePayload {
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
    sidechatStatus?: SidechatStatus;
    sidechatRunId?: string | null;
    lastActivityAt?: string | null;
    updatedAt: string;
    [key: string]: unknown;
  };
  messages: ConversationDetailMessage[];
  [key: string]: unknown;
}

interface ConversationsCacheData {
  conversations: Array<{
    id: string;
    sidechatStatus?: SidechatStatus;
    sidechatRunId?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface SidechatCacheMessage
  extends Omit<SidechatMessagePayload, "createdAt"> {
  createdAt: string;
}

interface SidechatCacheData {
  messages: SidechatCacheMessage[];
  hasMore: boolean;
  [key: string]: unknown;
}

export interface SidechatEphemeralRun {
  delta: string;
  activity: {
    label: string;
    phase: "start" | "finish";
  } | null;
}

export type SidechatEphemeralStore = ReadonlyMap<
  string,
  SidechatEphemeralRun
>;

const MAX_EPHEMERAL_RUNS = 8;
const MAX_EPHEMERAL_DELTA_LENGTH = 50_000;
const MAX_EPHEMERAL_LABEL_LENGTH = 500;

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

function toSidechatCacheMessage(
  message: SidechatMessagePayload,
): SidechatCacheMessage {
  return {
    ...message,
    createdAt: new Date(message.createdAt).toISOString(),
  };
}

function latestPublicMessageId(
  detail: ConversationDetailData | undefined,
): string | null {
  return detail?.messages.at(-1)?.id ?? null;
}

function latestSidechatMessageId(
  sidechat: SidechatCacheData | undefined,
): string | null {
  return sidechat?.messages.at(-1)?.id ?? null;
}

function nextEphemeralStore(
  old: SidechatEphemeralStore | undefined,
  runId: string,
  update: (current: SidechatEphemeralRun) => SidechatEphemeralRun,
): SidechatEphemeralStore {
  const next = new Map(old);
  const current = next.get(runId) ?? { delta: "", activity: null };
  next.delete(runId);
  next.set(runId, update(current));
  while (next.size > MAX_EPHEMERAL_RUNS) {
    const oldestRunId = next.keys().next().value;
    if (typeof oldestRunId !== "string") break;
    next.delete(oldestRunId);
  }
  return next;
}

export function useConversationWs(
  projectId: string | undefined,
  conversationId: string | null,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId || !conversationId) return;
    const activeProjectId = projectId;

    let lastSeenPublicMessageId = latestPublicMessageId(
      queryClient.getQueryData<ConversationDetailData>([
        "conversation-detail",
        conversationId,
      ]),
    );
    let lastSeenSidechatMessageId = latestSidechatMessageId(
      queryClient.getQueryData<SidechatCacheData>([
        "sidechat",
        projectId,
        conversationId,
      ]),
    );

    const socket = new ReconnectingWebSocket(
      () => buildWsUrl(projectId, conversationId),
    );

    function handleOpen(): void {
      socket.send(
        JSON.stringify({
          type: "resume",
          lastPublicMessageId: lastSeenPublicMessageId,
          lastSidechatMessageId: lastSeenSidechatMessageId,
        }),
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
        lastSeenPublicMessageId = incoming.id;
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            const optimisticIdx = old.messages.findIndex(
              (m) =>
                (m as ConversationDetailMessage & { _optimistic?: boolean })
                  ._optimistic &&
                m.role === incoming.role &&
                // Image-only sends go up with empty content; the server
                // stores a "Sent an image"/"Sent images" placeholder.
                (m.content === incoming.content ||
                  (!m.content &&
                    isImagePlaceholderContent(incoming.content))) &&
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
      } else if (parsed.type === "message:deleted") {
        const deletedId = parsed.messageId;
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.filter((m) => m.id !== deletedId),
            };
          },
        );
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
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
      } else if (parsed.type === "conversation:archived") {
        const archivedAt = new Date(parsed.archivedAt).toISOString();
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversation: { ...old.conversation, archivedAt },
            };
          },
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
        const idSet = new Set(parsed.messageIds);
        const iso = new Date(parsed.at).toISOString();
        const markRead = parsed.status === "read";
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              messages: old.messages.map((m) => {
                if (!idSet.has(m.id)) return m;
                if (markRead) {
                  return {
                    ...m,
                    readAt: iso,
                    deliveredAt: m.deliveredAt ?? iso,
                  } as ConversationDetailMessage;
                }
                return {
                  ...m,
                  deliveredAt: m.deliveredAt ?? iso,
                } as ConversationDetailMessage;
              }),
            };
          },
        );
      } else if (parsed.type === "sidechat:message") {
        const incoming = parsed.message;
        lastSeenSidechatMessageId = incoming.id;
        queryClient.setQueryData<SidechatCacheData>(
          ["sidechat", projectId, conversationId],
          (old) => {
            const messages = old?.messages ?? [];
            const incomingMessage = toSidechatCacheMessage(incoming);
            const existingIndex = messages.findIndex(
              (message) => message.id === incoming.id,
            );
            const nextMessages = [...messages];
            if (existingIndex >= 0) {
              nextMessages[existingIndex] = {
                ...nextMessages[existingIndex],
                ...incomingMessage,
              };
            } else {
              nextMessages.push(incomingMessage);
            }
            return {
              ...old,
              messages: nextMessages,
              hasMore: old?.hasMore ?? false,
            };
          },
        );
      } else if (parsed.type === "sidechat:delta") {
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) =>
            nextEphemeralStore(old, parsed.runId, (current) => ({
              ...current,
              delta: `${current.delta}${parsed.delta}`.slice(
                -MAX_EPHEMERAL_DELTA_LENGTH,
              ),
            })),
        );
      } else if (parsed.type === "sidechat:activity") {
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) =>
            nextEphemeralStore(old, parsed.runId, (current) => ({
              ...current,
              activity: {
                label: parsed.label.slice(0, MAX_EPHEMERAL_LABEL_LENGTH),
                phase: parsed.phase,
              },
            })),
        );
      } else if (parsed.type === "sidechat:status") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversation: {
                ...old.conversation,
                sidechatStatus: parsed.status,
                sidechatRunId: parsed.runId,
              },
            };
          },
        );
        queryClient.setQueriesData<ConversationsCacheData>(
          { queryKey: ["conversations", projectId] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversations: old.conversations.map((conversation) =>
                conversation.id === conversationId
                  ? {
                      ...conversation,
                      sidechatStatus: parsed.status,
                      sidechatRunId: parsed.runId,
                    }
                  : conversation,
              ),
            };
          },
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
