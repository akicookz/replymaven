import type { SidechatStatus } from "../../../shared/ws-events";
import type { MessageRole, SidechatMessageKind } from "./types";

export type ChatPerspective = "public" | "sidechat";
export type SidechatPaneMode = "desktop" | "compact" | "mobile";

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
  accepted: boolean;
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
  if (input.accepted && input.currentDraft === input.submittedDraft) return "";
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
