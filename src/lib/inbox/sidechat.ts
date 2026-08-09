import {
  selectNewerSidechatCoordinationSnapshot,
  type SidechatCoordinationSnapshot,
  type SidechatStatus,
} from "../../../shared/ws-events";
import type { Message, MessageRole, SidechatMessageKind } from "./types";

export type ChatPerspective = "public" | "sidechat";
export type SidechatPaneMode = "desktop" | "compact" | "mobile";
export type ComposerContract = ChatPerspective;
export type ComposerShiftTabIntent = "start_sidechat";

interface ComposerKeyboardInput {
  contract: ComposerContract;
  hasDraft: boolean;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
}

interface MessagePresentation {
  isReceived: boolean;
  senderLabel: string;
}

interface MessageActions {
  addToReply: boolean;
  approveAlways: boolean;
  approveOnce: boolean;
}

interface PublicDraftAcceptanceInput {
  currentDraft: string;
  submittedDraft: string;
  currentConversationId: string | null;
  submittedConversationId: string;
  accepted: boolean;
}

export interface SidechatOrchestratorState {
  isOpen: boolean;
  conversationId: string | null;
  acceptedRunIds: Readonly<Record<string, string>>;
}

export type SidechatOrchestratorEvent =
  | { type: "open"; conversationId: string }
  | { type: "close" }
  | { type: "select_conversation"; conversationId: string | null }
  | { type: "run_accepted"; conversationId: string; runId: string };

interface SidechatEntryPlanInput {
  sidechatExists: boolean;
  publicDraft: string;
}

export type SidechatEntryPlan =
  | {
      label: "Open sidechat";
      shouldSubmit: false;
      body: null;
      publicDraftSnapshot: null;
    }
  | {
      label: "Start sidechat";
      shouldSubmit: true;
      body: { content?: string };
      publicDraftSnapshot: string;
    };

export interface OptimisticSidechatMessage extends Message {
  role: "agent";
  channel: "sidechat";
  kind: "text";
  metadata: null;
  _optimistic: true;
}

interface CreateOptimisticSidechatMessageInput {
  id: string;
  content: string;
  createdAt: string;
}

interface ReconciliableSidechatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  _optimistic?: boolean;
}

export interface SidechatHistorySnapshot<
  T extends ReconciliableSidechatMessage,
> {
  messages: T[];
  hasMore: boolean;
  nextBefore: string | null;
  historyLoaded: boolean;
  coordination?: SidechatCoordinationSnapshot;
}

export interface SidechatHistoryFetchSnapshot<
  T extends ReconciliableSidechatMessage,
> extends SidechatHistorySnapshot<T> {
  __sidechatHistoryFetch: {
    generation: number;
  };
}

interface EphemeralRunValue {
  delta: string;
  activity: {
    label: string;
    phase: "start" | "finish";
  } | null;
}

interface AddToReplyIntent {
  draft: string;
  draftMode: "replace";
  focusPublicComposer: true;
  caret: "end";
  send: false;
  keepSidechatOpen: true;
}

interface ConversationInteractionState {
  readOnly: boolean;
  showComposer: boolean;
  showMessageActions: boolean;
}

export interface SidechatStatusDot {
  sizeClass: "size-[7px]";
  colorClass: "bg-dot-blue" | "bg-dot-orange" | "bg-dot-green" | "bg-destructive";
  motionClass: "motion-safe:animate-pulse" | "";
  title: string;
}

export function deriveMessagePresentation(
  perspective: ChatPerspective,
  role: MessageRole,
  senderName: string | null,
  visitorName: string | null,
): MessagePresentation {
  const isReceived = perspective === "sidechat"
    ? role === "bot"
    : role === "visitor";
  if (perspective === "sidechat") {
    return {
      isReceived,
      senderLabel: role === "bot" ? "Maven" : "You",
    };
  }
  const senderLabel = role === "visitor"
    ? (senderName ?? visitorName ?? "Visitor")
    : role === "bot"
      ? "Maven · AI"
      : (senderName ?? "Agent");
  return { isReceived, senderLabel };
}

export function createInitialSidechatOrchestratorState(
  conversationId: string | null,
): SidechatOrchestratorState {
  return {
    isOpen: false,
    conversationId,
    acceptedRunIds: {},
  };
}

export function reduceSidechatOrchestratorState(
  state: SidechatOrchestratorState,
  event: SidechatOrchestratorEvent,
): SidechatOrchestratorState {
  switch (event.type) {
    case "open":
      return {
        ...state,
        isOpen: true,
        conversationId: event.conversationId,
      };
    case "close":
      return { ...state, isOpen: false };
    case "select_conversation":
      return {
        ...state,
        isOpen: event.conversationId === null ? false : state.isOpen,
        conversationId: event.conversationId,
      };
    case "run_accepted":
      return {
        ...state,
        acceptedRunIds: {
          ...state.acceptedRunIds,
          [event.conversationId]: event.runId,
        },
      };
  }
}

export function buildSidechatEntryPlan(
  input: SidechatEntryPlanInput,
): SidechatEntryPlan {
  if (input.sidechatExists) {
    return {
      label: "Open sidechat",
      shouldSubmit: false,
      body: null,
      publicDraftSnapshot: null,
    };
  }
  const content = input.publicDraft.trim();
  return {
    label: "Start sidechat",
    shouldSubmit: true,
    body: content ? { content } : {},
    publicDraftSnapshot: input.publicDraft,
  };
}

export function createOptimisticSidechatMessage(
  input: CreateOptimisticSidechatMessageInput,
): OptimisticSidechatMessage {
  return {
    id: input.id,
    role: "agent",
    content: input.content,
    channel: "sidechat",
    kind: "text",
    metadata: null,
    senderName: null,
    createdAt: input.createdAt,
    _optimistic: true,
  };
}

function compareSidechatMessages(
  left: ReconciliableSidechatMessage,
  right: ReconciliableSidechatMessage,
): number {
  const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return left.id.localeCompare(right.id);
}

export function reconcileSidechatMessages<
  T extends ReconciliableSidechatMessage,
>(messages: T[], incoming: T): T[] {
  const exactIndex = messages.findIndex((message) => message.id === incoming.id);
  const optimisticIndex = incoming.role === "agent"
    ? messages.findIndex(
        (message) =>
          message._optimistic === true &&
          message.role === incoming.role &&
          message.content === incoming.content,
      )
    : -1;
  const replaceIndex = exactIndex >= 0 ? exactIndex : optimisticIndex;
  const next = [...messages];
  if (replaceIndex >= 0) next[replaceIndex] = incoming;
  else next.push(incoming);
  next.sort(compareSidechatMessages);
  return next;
}

export function mergeSidechatHistoryMessages<
  T extends ReconciliableSidechatMessage,
>(current: T[], older: T[]): T[] {
  const byId = new Map<string, T>();
  for (const message of older) byId.set(message.id, message);
  for (const message of current) byId.set(message.id, message);
  return [...byId.values()].sort(compareSidechatMessages);
}

export function mergeSidechatHistorySnapshot<
  T extends ReconciliableSidechatMessage,
>(
  current: SidechatHistorySnapshot<T> | undefined,
  incoming: SidechatHistorySnapshot<T>,
): SidechatHistorySnapshot<T> {
  const fetchMarker = (
    incoming as SidechatHistorySnapshot<T> &
      Partial<SidechatHistoryFetchSnapshot<T>>
  ).__sidechatHistoryFetch;
  if (!fetchMarker) return incoming;
  const fetched = {
    messages: incoming.messages,
    hasMore: incoming.hasMore,
    nextBefore: incoming.nextBefore,
    historyLoaded: incoming.historyLoaded,
    ...(incoming.coordination
      ? { coordination: incoming.coordination }
      : {}),
  };
  if (!current) return fetched;
  const incomingIds = new Set(fetched.messages.map((message) => message.id));
  const overlapsIncoming = current.messages.some((message) =>
    incomingIds.has(message.id)
  );
  const earliestCurrent = current.messages.reduce<T | null>(
    (earliest, message) =>
      !earliest || compareSidechatMessages(message, earliest) < 0
        ? message
        : earliest,
    null,
  );
  const earliestIncoming = fetched.messages.reduce<T | null>(
    (earliest, message) =>
      !earliest || compareSidechatMessages(message, earliest) < 0
        ? message
        : earliest,
    null,
  );
  const preserveContiguousEarlierCursor = Boolean(
    current.historyLoaded &&
      overlapsIncoming &&
      earliestCurrent &&
      earliestIncoming &&
      compareSidechatMessages(earliestCurrent, earliestIncoming) < 0,
  );
  return {
    messages: mergeSidechatHistoryMessages(
      current.messages,
      fetched.messages,
    ),
    hasMore: preserveContiguousEarlierCursor
      ? current.hasMore
      : fetched.hasMore,
    nextBefore: preserveContiguousEarlierCursor
      ? current.nextBefore
      : fetched.nextBefore,
    historyLoaded: true,
    ...(current.coordination || fetched.coordination
      ? {
          coordination: fetched.coordination
            ? selectNewerSidechatCoordinationSnapshot(
                current.coordination ?? null,
                fetched.coordination,
              )
            : current.coordination,
        }
      : {}),
  };
}

export function markSidechatHistoryFetchSnapshot<
  T extends ReconciliableSidechatMessage,
>(
  snapshot: SidechatHistorySnapshot<T>,
  generation: number,
): SidechatHistoryFetchSnapshot<T> {
  return {
    ...snapshot,
    __sidechatHistoryFetch: { generation },
  };
}

export function resolveSidechatStartAfterHistory(
  historyReady: boolean,
  messageCount: number,
): "wait" | "open_existing" | "submit" {
  if (!historyReady) return "wait";
  return messageCount > 0 ? "open_existing" : "submit";
}

export function clearSidechatEphemeralRun<T extends EphemeralRunValue>(
  store: ReadonlyMap<string, T>,
  runId: string | null,
): ReadonlyMap<string, T> {
  if (!runId || !store.has(runId)) return store;
  const next = new Map(store);
  next.delete(runId);
  return next;
}

export function deriveComposerShiftTabIntent(
  input: ComposerKeyboardInput,
): ComposerShiftTabIntent | null {
  if (
    input.key !== "Tab" ||
    !input.shiftKey ||
    input.ctrlKey ||
    input.metaKey ||
    input.altKey ||
    input.isComposing ||
    input.repeat
  ) {
    return null;
  }
  if (input.contract === "public") return "start_sidechat";
  return null;
}

export function deriveMessageActions(
  perspective: ChatPerspective,
  kind: SidechatMessageKind,
  readOnly: boolean,
): MessageActions {
  const allowActions = perspective === "sidechat" && !readOnly;
  return {
    addToReply: allowActions && kind === "reply_draft",
    approveAlways: allowActions && kind === "approval",
    approveOnce: allowActions && kind === "approval",
  };
}

export function transitionPublicDraftAfterSidechatAccept(
  input: PublicDraftAcceptanceInput,
): string {
  if (
    input.accepted &&
    input.currentConversationId === input.submittedConversationId &&
    input.currentDraft === input.submittedDraft
  ) {
    return "";
  }
  return input.currentDraft;
}

export function deriveAddToReplyIntent(draft: string): AddToReplyIntent {
  return {
    draft,
    draftMode: "replace",
    focusPublicComposer: true,
    caret: "end",
    send: false,
    keepSidechatOpen: true,
  };
}

export function deriveSidechatPaneMode(viewportWidth: number): SidechatPaneMode {
  if (viewportWidth >= 1536) return "desktop";
  if (viewportWidth >= 768) return "compact";
  return "mobile";
}

export function deriveSidechatBusy(
  status: SidechatStatus,
  submitting: boolean,
  retrying: boolean,
): boolean {
  return status === "working" || submitting || retrying;
}

export function deriveConversationInteractionState(
  archivedAt: string | null | undefined,
): ConversationInteractionState {
  const readOnly = Boolean(archivedAt);
  return {
    readOnly,
    showComposer: !readOnly,
    showMessageActions: !readOnly,
  };
}

export function deriveSidechatStatusDot(
  status: SidechatStatus,
): SidechatStatusDot | null {
  switch (status) {
    case "working":
      return {
        sizeClass: "size-[7px]",
        colorClass: "bg-dot-blue",
        motionClass: "motion-safe:animate-pulse",
        title: "Sidechat working",
      };
    case "waiting_approval":
      return {
        sizeClass: "size-[7px]",
        colorClass: "bg-dot-orange",
        motionClass: "",
        title: "Sidechat waiting for approval",
      };
    case "ready":
      return {
        sizeClass: "size-[7px]",
        colorClass: "bg-dot-green",
        motionClass: "",
        title: "Sidechat reply ready",
      };
    case "failed":
      return {
        sizeClass: "size-[7px]",
        colorClass: "bg-destructive",
        motionClass: "",
        title: "Sidechat failed",
      };
    case "idle":
      return null;
  }
}
