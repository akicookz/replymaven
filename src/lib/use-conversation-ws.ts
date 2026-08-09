import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  compareMessagePositions,
  type MessagePayload,
  type ServerEvent,
  type SidechatMessagePayload,
  type SidechatStatus,
  type StableMessagePosition,
} from "../../shared/ws-events";
import { isImagePlaceholderContent } from "../../shared/message-images";
import {
  clearSidechatEphemeralRun,
  reconcileSidechatMessages,
} from "./inbox/sidechat";
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

export interface SidechatCacheMessage
  extends Omit<SidechatMessagePayload, "createdAt"> {
  createdAt: string;
  _optimistic?: boolean;
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

export type MessageResumeCursor = StableMessagePosition;

export interface ConversationRealtimeMessageState {
  publicMessages: ConversationDetailMessage[];
  sidechatMessages: SidechatCacheMessage[];
  publicCursor: MessageResumeCursor | null;
  sidechatCursor: MessageResumeCursor | null;
}

type ConversationMessageEvent = Extract<
  ServerEvent,
  { type: "message:new" | "sidechat:message" }
>;

type SidechatEphemeralEvent = Extract<
  ServerEvent,
  { type: "sidechat:delta" | "sidechat:activity" }
>;

type SidechatEphemeralTerminalEvent = Extract<
  ServerEvent,
  { type: "sidechat:message" | "sidechat:status" }
>;

interface SidechatStatusSnapshot {
  status: SidechatStatus;
  runId: string | null;
}

export type SidechatSettledRunStore = ReadonlySet<string>;

export function reduceConversationMessageEvent(
  state: ConversationRealtimeMessageState,
  event: ConversationMessageEvent,
): ConversationRealtimeMessageState {
  if (event.type === "message:new") {
    const incoming = event.message;
    const incomingMessage = toIsoMessage(incoming);
    const optimisticIndex = state.publicMessages.findIndex(
      (message) =>
        (
          message as ConversationDetailMessage & {
            _optimistic?: boolean;
          }
        )._optimistic &&
        message.role === incoming.role &&
        (message.content === incoming.content ||
          (!message.content &&
            isImagePlaceholderContent(incoming.content))) &&
        Boolean(message.imageUrl) === Boolean(incoming.imageUrl),
    );
    const nextMessages = [...state.publicMessages];
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
      ...state,
      publicMessages: nextMessages,
      publicCursor: advanceCursor(state.publicCursor, incoming),
    };
  }

  const incoming = event.message;
  const incomingMessage = toSidechatCacheMessage(incoming);
  const nextMessages = reconcileSidechatMessages(
    state.sidechatMessages,
    incomingMessage,
  );
  return {
    ...state,
    sidechatMessages: nextMessages,
    sidechatCursor: advanceCursor(state.sidechatCursor, incoming),
  };
}

export function reduceSidechatEphemeralEvent(
  old: SidechatEphemeralStore | undefined,
  event: SidechatEphemeralEvent,
): SidechatEphemeralStore {
  if (event.type === "sidechat:delta") {
    return nextEphemeralStore(old, event.runId, (current) => ({
      ...current,
      delta: `${current.delta}${event.delta}`.slice(
        -MAX_EPHEMERAL_DELTA_LENGTH,
      ),
    }));
  }
  return nextEphemeralStore(old, event.runId, (current) => ({
    ...current,
    activity: {
      label: event.label.slice(0, MAX_EPHEMERAL_LABEL_LENGTH),
      phase: event.phase,
    },
  }));
}

export function reduceSidechatEphemeralTerminalEvent(
  old: SidechatEphemeralStore,
  event: SidechatEphemeralTerminalEvent,
): SidechatEphemeralStore {
  if (event.type !== "sidechat:status" || event.status === "working") {
    return old;
  }
  return clearSidechatEphemeralRun(old, event.runId);
}

export function reduceSidechatStatusSnapshot(
  current: SidechatStatusSnapshot,
  incoming: SidechatStatusSnapshot,
): SidechatStatusSnapshot {
  if (incoming.status === "working") return incoming;
  if (!incoming.runId || current.runId !== incoming.runId) return current;
  return { status: incoming.status, runId: null };
}

export function reduceSidechatSettledRunEvent(
  old: SidechatSettledRunStore | undefined,
  event: SidechatEphemeralTerminalEvent,
): SidechatSettledRunStore {
  if (
    event.type !== "sidechat:status" ||
    event.status === "working" ||
    !event.runId
  ) {
    return old ?? new Set();
  }
  const next = new Set(old);
  next.delete(event.runId);
  next.add(event.runId);
  while (next.size > MAX_SETTLED_RUNS) {
    const oldest = next.values().next().value;
    if (typeof oldest !== "string") break;
    next.delete(oldest);
  }
  return next;
}

export function reduceSidechatAcceptedSnapshot(
  current: SidechatStatusSnapshot,
  acceptedRunId: string,
  settledRuns: SidechatSettledRunStore | undefined,
): SidechatStatusSnapshot {
  if (settledRuns?.has(acceptedRunId)) return current;
  return {
    status: "working",
    runId: acceptedRunId,
  };
}

interface SidechatAcceptedConversationSnapshot {
  sidechatStatus?: SidechatStatus;
  sidechatRunId?: string | null;
  sidechatUpdatedAt?: string | null;
}

export function reduceSidechatAcceptedConversation<
  T extends SidechatAcceptedConversationSnapshot,
>(
  current: T,
  acceptedRunId: string,
  settledRuns: SidechatSettledRunStore | undefined,
  acceptedAt?: string,
): T {
  const currentStatus = current.sidechatStatus ?? "idle";
  const currentRunId = current.sidechatRunId ?? null;
  const next = reduceSidechatAcceptedSnapshot(
    { status: currentStatus, runId: currentRunId },
    acceptedRunId,
    settledRuns,
  );
  if (settledRuns?.has(acceptedRunId)) {
    return current;
  }
  return {
    ...current,
    sidechatStatus: next.status,
    sidechatRunId: next.runId,
    ...(acceptedAt === undefined ? {} : { sidechatUpdatedAt: acceptedAt }),
  };
}

const MAX_EPHEMERAL_RUNS = 8;
const MAX_SETTLED_RUNS = 16;
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
    createdAt: new Date(message.createdAt).toISOString(),
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

function latestPublicMessageCursor(
  detail: ConversationDetailData | undefined,
): MessageResumeCursor | null {
  return latestMessageCursor(detail?.messages);
}

function latestSidechatMessageCursor(
  sidechat: SidechatCacheData | undefined,
): MessageResumeCursor | null {
  return latestMessageCursor(sidechat?.messages);
}

function latestMessageCursor(
  messages: Array<{ id: string; createdAt: string }> | undefined,
): MessageResumeCursor | null {
  let latest: MessageResumeCursor | null = null;
  for (const message of messages ?? []) {
    const candidate = cachedMessagePosition(message);
    latest = advanceCursor(latest, candidate);
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

    let publicCursor = latestPublicMessageCursor(
      queryClient.getQueryData<ConversationDetailData>([
        "conversation-detail",
        conversationId,
      ]),
    );
    let sidechatCursor = latestSidechatMessageCursor(
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
          lastPublicMessageId: publicCursor?.id ?? null,
          lastSidechatMessageId: sidechatCursor?.id ?? null,
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
        const sidechatMessages =
          queryClient.getQueryData<SidechatCacheData>([
            "sidechat",
            projectId,
            conversationId,
          ])?.messages ?? [];
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            const next = reduceConversationMessageEvent(
              {
                publicMessages: old.messages,
                sidechatMessages,
                publicCursor,
                sidechatCursor,
              },
              parsed,
            );
            publicCursor = next.publicCursor;
            return { ...old, messages: next.publicMessages };
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
        const publicMessages =
          queryClient.getQueryData<ConversationDetailData>([
            "conversation-detail",
            conversationId,
          ])?.messages ?? [];
        queryClient.setQueryData<SidechatCacheData>(
          ["sidechat", projectId, conversationId],
          (old) => {
            const next = reduceConversationMessageEvent(
              {
                publicMessages,
                sidechatMessages: old?.messages ?? [],
                publicCursor,
                sidechatCursor,
              },
              parsed,
            );
            sidechatCursor = next.sidechatCursor;
            return {
              ...old,
              messages: next.sidechatMessages,
              hasMore: old?.hasMore ?? false,
            };
          },
        );
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) => reduceSidechatEphemeralTerminalEvent(
            old ?? new Map(),
            parsed,
          ),
        );
      } else if (parsed.type === "sidechat:delta") {
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) => reduceSidechatEphemeralEvent(old, parsed),
        );
      } else if (parsed.type === "sidechat:activity") {
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) => reduceSidechatEphemeralEvent(old, parsed),
        );
      } else if (parsed.type === "sidechat:status") {
        queryClient.setQueryData<ConversationDetailData | undefined>(
          ["conversation-detail", conversationId],
          (old) => {
            if (!old) return old;
            const next = reduceSidechatStatusSnapshot(
              {
                status: old.conversation.sidechatStatus ?? "idle",
                runId: old.conversation.sidechatRunId ?? null,
              },
              { status: parsed.status, runId: parsed.runId },
            );
            return {
              ...old,
              conversation: {
                ...old.conversation,
                sidechatStatus: next.status,
                sidechatRunId: next.runId,
              },
            };
          },
        );
        queryClient.setQueryData<SidechatEphemeralStore>(
          ["sidechat-ephemeral", projectId, conversationId],
          (old) => reduceSidechatEphemeralTerminalEvent(
            old ?? new Map(),
            parsed,
          ),
        );
        queryClient.setQueryData<SidechatSettledRunStore>(
          ["sidechat-settled-runs", projectId, conversationId],
          (old) => reduceSidechatSettledRunEvent(old, parsed),
        );
        queryClient.setQueriesData<ConversationsCacheData>(
          { queryKey: ["conversations", projectId] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              conversations: old.conversations.map((conversation) => {
                if (conversation.id !== conversationId) return conversation;
                const next = reduceSidechatStatusSnapshot(
                  {
                    status: conversation.sidechatStatus ?? "idle",
                    runId: conversation.sidechatRunId ?? null,
                  },
                  { status: parsed.status, runId: parsed.runId },
                );
                return {
                  ...conversation,
                  sidechatStatus: next.status,
                  sidechatRunId: next.runId,
                };
              }),
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
