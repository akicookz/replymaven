import type {
  MessagePresentationAction,
  MessageRole,
} from "./types";

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
  keepSidechatOpen: true;
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
    approveAlways: allowActions && action?.type === "approval",
    approveOnce: allowActions && action?.type === "approval",
  };
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
