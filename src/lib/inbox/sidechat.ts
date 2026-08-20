import type {
  MessagePresentationAction,
  MessageRole,
  SidechatToolTraceState,
  SidechatTraceItem,
} from "./types";
import type {
  MavenProjectState,
  SidechatSummary,
} from "../../../shared/sidechat-agent";

export type ChatPerspective = "public" | "sidechat";
export type SidechatPresentationStatus =
  | "idle"
  | "working"
  | "waiting_approval"
  | "ready"
  | "failed";
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

interface AddToReplyIntent {
  draft: string;
  draftMode: "replace";
  focusPublicComposer: true;
  caret: "end";
  send: false;
  keepSidechatOpen: boolean;
  focusTiming: "immediate" | "after_pane_close";
}

interface ConversationInteractionState {
  readOnly: boolean;
  showComposer: boolean;
  showMessageActions: boolean;
}

export interface SidechatStatusDot {
  sizeClass: "size-[7px]";
  colorClass:
    | "bg-dot-blue"
    | "bg-dot-orange"
    | "bg-dot-green"
    | "bg-destructive";
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
  return {
    isReceived,
    senderLabel: role === "visitor"
      ? (senderName ?? visitorName ?? "Visitor")
      : role === "bot"
        ? "Maven · AI"
        : (senderName ?? "Agent"),
  };
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
  return input.contract === "public" ? "start_sidechat" : null;
}

export function deriveMessageActions(
  perspective: ChatPerspective,
  action: MessagePresentationAction | undefined,
  readOnly: boolean,
): MessageActions {
  const allowActions = perspective === "sidechat" && !readOnly;
  return {
    addToReply: allowActions && action?.type === "add_to_reply",
    approveAlways:
      allowActions &&
      action?.type === "approval" &&
      action.canAlwaysAllow === true,
    approveOnce: allowActions && action?.type === "approval",
  };
}

export function deriveAddToReplyIntent(
  draft: string,
  viewportWidth = 1_536,
): AddToReplyIntent {
  const mobile = viewportWidth < 768;
  return {
    draft,
    draftMode: "replace",
    focusPublicComposer: true,
    caret: "end",
    send: false,
    keepSidechatOpen: !mobile,
    focusTiming: mobile ? "after_pane_close" : "immediate",
  };
}

interface AcceptedPublicDraftInput {
  transferConversationId: string;
  selectedConversationId: string | null;
  capturedText: string;
  currentText: string;
}

interface SidechatEntryInput {
  archived: boolean;
  exists: boolean;
  conversationId: string;
  messageId: string;
  publicDraft: string;
}

interface SidechatEntryPlan {
  open: true;
  transfer: {
    conversationId: string;
    messageId: string;
    textSnapshot: string;
    submitted: false;
  } | null;
}

export function shouldClearAcceptedPublicDraft(
  input: AcceptedPublicDraftInput,
): boolean {
  return input.transferConversationId === input.selectedConversationId &&
    input.capturedText === input.currentText;
}

export function planSidechatEntry(
  input: SidechatEntryInput,
): SidechatEntryPlan | null {
  if (input.archived && !input.exists) return null;
  return {
    open: true,
    transfer: input.exists
      ? null
      : {
          conversationId: input.conversationId,
          messageId: input.messageId,
          textSnapshot: input.publicDraft,
          submitted: false,
        },
  };
}

export function mergeSidechatSummaryStatuses(
  seeded: SidechatSummary[],
  live: MavenProjectState | undefined,
): Record<string, SidechatPresentationStatus> {
  const latest: Record<string, SidechatSummary> = {};
  for (const summary of seeded) {
    const current = latest[summary.conversationId];
    if (!current || summary.updatedAt >= current.updatedAt) {
      latest[summary.conversationId] = summary;
    }
  }
  for (const summary of Object.values(live?.sidechats ?? {})) {
    const current = latest[summary.conversationId];
    if (!current || summary.updatedAt >= current.updatedAt) {
      latest[summary.conversationId] = summary;
    }
  }
  const statuses: Record<string, SidechatPresentationStatus> = {};
  for (const summary of Object.values(latest)) {
    statuses[summary.conversationId] = summary.status;
  }
  return statuses;
}

// "approval-responded" is running: the approved tool executes at the start of
// the continuation turn and only then transitions to an output state.
export function isSidechatToolRunning(state: SidechatToolTraceState): boolean {
  return state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-responded";
}

export type SidechatCompletedToolKind = "docs" | "other";

export function readLastCompletedSidechatToolKind(
  trace: SidechatTraceItem[] | undefined,
): SidechatCompletedToolKind | null {
  if (!trace) return null;
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const item = trace[index];
    if (item?.type !== "tool") continue;
    if (
      item.state !== "output-available" &&
      item.state !== "output-error" &&
      item.state !== "output-denied"
    ) {
      continue;
    }
    if (
      item.tool.source.name === "Docs" &&
      item.tool.displayName === "Search"
    ) {
      return "docs";
    }
    return "other";
  }
  return null;
}

interface SidechatWorkingTailInput {
  busy: boolean;
  status: "submitted" | "streaming" | "ready" | "error";
  hasError: boolean;
  hasRunningTool: boolean;
  hasStreamingReasoning: boolean;
  hasVisibleAnswer: boolean;
  lastCompletedToolKind: SidechatCompletedToolKind | null;
}

interface SidechatWorkingTail {
  showWorking: boolean;
  showError: boolean;
  workingLabel: string;
}

function sidechatWorkingLabel(
  lastCompletedToolKind: SidechatCompletedToolKind | null,
): string {
  if (lastCompletedToolKind === "docs") return "Reading the docs…";
  if (lastCompletedToolKind === "other") return "Reading the results…";
  return "Reading the conversation…";
}

// A completed tool row is not the same as a finished turn. Keep a plain
// phase line after a tool returns until reasoning, text, a draft, or an
// error arrives. Never repeat the tool row (icon + source · name).
export function deriveSidechatWorkingTail(
  input: SidechatWorkingTailInput,
): SidechatWorkingTail {
  const showError = input.status === "error" && input.hasError;
  const showWorking = input.busy &&
    !input.hasRunningTool &&
    !input.hasStreamingReasoning &&
    !input.hasVisibleAnswer &&
    !showError;
  return {
    showWorking,
    showError,
    workingLabel: sidechatWorkingLabel(input.lastCompletedToolKind),
  };
}

interface SidechatPresentationInput {
  uiStatus: "submitted" | "streaming" | "ready" | "error";
  rawStatus: "submitted" | "streaming" | "ready" | "error";
  summaryStatus: SidechatPresentationStatus;
  hasApproval: boolean;
  hasReplyDraft: boolean;
}

interface SidechatPresentation {
  status: "submitted" | "streaming" | "ready" | "error";
  presentationStatus: SidechatPresentationStatus;
  serverFailure: boolean;
}

// A continuation that dies server-side never sends the client an error frame,
// so the chat status can sit on "streaming" forever. The project summary does
// flip to "failed"; fold it in as a fallback error signal. An optimistic send
// (rawStatus "submitted") or a visible approval card wins over a stale
// failure.
export function deriveSidechatPresentation(
  input: SidechatPresentationInput,
): SidechatPresentation {
  const serverFailure = input.summaryStatus === "failed" &&
    !input.hasApproval &&
    input.rawStatus !== "submitted" &&
    input.uiStatus !== "error";
  const status = serverFailure ? "error" : input.uiStatus;
  const presentationStatus: SidechatPresentationStatus = status === "error"
    ? "failed"
    : status === "streaming" || status === "submitted"
      ? "working"
      : input.hasApproval
        ? "waiting_approval"
        : input.hasReplyDraft
          ? "ready"
          : "idle";
  return { status, presentationStatus, serverFailure };
}

export function deriveSidechatPaneMode(viewportWidth: number): SidechatPaneMode {
  if (viewportWidth >= 1536) return "desktop";
  if (viewportWidth >= 768) return "compact";
  return "mobile";
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
  status: SidechatPresentationStatus,
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
