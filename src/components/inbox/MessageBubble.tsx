import { Mail, Trash2 } from "lucide-react";
import { deriveMessageStatus } from "@/lib/inbox/message-status";
import {
  deriveMessageActions,
  deriveMessagePresentation,
  type ChatPerspective,
} from "@/lib/inbox/sidechat";
import type { Conversation, Message } from "@/lib/inbox/types";
import { cn, renderMarkdown } from "@/lib/utils";
import {
  parseMessageImageUrls,
  shouldShowMessageContent,
} from "../../../shared/message-images";
import MessageImages from "./MessageImages";

interface MessageBubbleProps {
  message: Message;
  conversation: Conversation;
  onDelete?: (messageId: string) => void;
  readOnly?: boolean;
  /** This message matches the active in-conversation search query. */
  isMatch?: boolean;
  /** This message is the currently-focused search match. */
  isActiveMatch?: boolean;
  /** False when this message is grouped with the previous one from the same
   *  sender — the name + timestamp header renders once per group. */
  showHeader?: boolean;
  perspective?: ChatPerspective;
  onAddToReply?: (draft: string) => void;
  onApprovalAction?: (messageId: string, mode: "always" | "once") => void;
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({
  message,
  conversation,
  onDelete,
  readOnly = false,
  isMatch,
  isActiveMatch,
  showHeader = true,
  perspective = "public",
  onAddToReply,
  onApprovalAction,
}: MessageBubbleProps) {
  const presentation = deriveMessagePresentation(
    perspective,
    message.role,
    message.senderName ?? null,
    conversation.visitorName,
  );
  const { isReceived, senderLabel } = presentation;
  const isBot = message.role === "bot";
  const isAgent = message.role === "agent";

  // Search highlight: ring the matching bubble, brighter for the active match.
  const matchClass = isActiveMatch
    ? "ring-2 ring-amber-400/80"
    : isMatch
      ? "ring-1 ring-amber-400/40"
      : "";

  const labelColorClass = isReceived
    ? "text-ink-5"
    : isBot
      ? "text-brand-label"
      : "text-brand-label-human";

  const html = renderMarkdown(message.content);
  const imageCount = parseMessageImageUrls(message.imageUrl).length;
  const showContent = shouldShowMessageContent(message.content);

  // Grouped messages tuck up under the previous bubble (net ~4px gap).
  const rootSpacing = showHeader ? "mb-3" : "-mt-2 mb-3";
  const actions = deriveMessageActions(
    perspective,
    message.presentationAction,
    readOnly,
  );
  const status = !isReceived && perspective === "public"
    ? deriveMessageStatus(message)
    : null;
  const statusTooltip = [
    message.deliveredAt ? `Delivered ${formatTime(message.deliveredAt)}` : null,
    message.readAt ? `Seen ${formatTime(message.readAt)}` : null,
    message.emailedAt ? `Emailed ${formatTime(message.emailedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Delivery status — rendered inline in the header row (name · time · Seen);
  // falls back to a row under the bubble for grouped messages that have no
  // header of their own.
  function renderStatus(withLeadingDot: boolean) {
    return status && (
      <span
        className="text-[11px] text-ink-8 flex items-baseline gap-1"
        title={statusTooltip || undefined}
      >
        {withLeadingDot && <span aria-hidden="true">·</span>}
        <span
          className={
            status.status === "seen"
              ? "text-brand-label-human font-medium"
              : undefined
          }
        >
          {status.label}
        </span>
        {status.emailed && (
          <>
            <span aria-hidden="true">·</span>
            <Mail size={11} className="self-center" />
            <span>Emailed</span>
          </>
        )}
      </span>
    );
  }

  function renderMessageActions() {
    const draft = message.presentationAction?.type === "add_to_reply"
      ? message.presentationAction.draft
      : message.content;
    if (actions.addToReply && onAddToReply) {
      return (
        <div className="mt-1 flex min-h-10 items-center">
          <button
            type="button"
            className="min-h-10 shrink-0 whitespace-nowrap text-[12px] font-semibold text-brand-label underline-offset-4 hover:underline motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
            onClick={() => onAddToReply(draft)}
          >
            Add to reply
          </button>
        </div>
      );
    }
    if (actions.approveAlways && actions.approveOnce && onApprovalAction) {
      return (
        <div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            className="min-h-10 shrink-0 whitespace-nowrap text-[12px] font-medium text-ink-5 hover:text-ink-2 motion-safe:transition-[color,scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
            onClick={() => onApprovalAction(message.id, "always")}
          >
            Always allow
          </button>
          <button
            type="button"
            className="flex min-h-10 shrink-0 items-center whitespace-nowrap text-[12px] font-semibold motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
            onClick={() => onApprovalAction(message.id, "once")}
          >
            <span className="rounded-[8px] bg-bubble-sent px-2.5 py-1.5 text-white">
              Allow once
            </span>
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        isReceived ? "items-start" : "items-end",
        rootSpacing,
      )}
    >
      {showHeader && (
        <div className={`flex items-baseline gap-2 mb-1 ${labelColorClass}`}>
          <span className="text-xs leading-normal font-semibold">{senderLabel}</span>
          <span className="text-[11px] text-ink-8">{formatTime(message.createdAt)}</span>
          {renderStatus(true)}
        </div>
      )}
      <div className="relative group max-w-9/10 sm:max-w-3/4">
        <div
          className={cn(
            "px-3.5 py-2.5 text-[14.5px] leading-normal rounded-bubble",
            isReceived
              ? "bg-bubble-received text-ink-2 rounded-bl-[6px]"
              : "bg-bubble-sent text-white rounded-br-[6px]",
            matchClass,
          )}
        >
          <MessageImages imageUrl={message.imageUrl} />
          {showContent && (
            <div
              className={`prose-chat${imageCount ? " mt-1.5" : ""}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {renderMessageActions()}
        </div>
        {!isReceived &&
          perspective === "public" &&
          isAgent &&
          !readOnly &&
          onDelete && (
          <button
            onClick={() => onDelete(message.id)}
            className="absolute -left-10 top-1/2 flex size-10 shrink-0 -translate-y-1/2 items-center justify-center rounded opacity-0 text-ink-7 group-hover:opacity-100 hover:text-red-400 focus-visible:opacity-100 motion-safe:transition-[opacity,color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.96]"
            aria-label="Delete message"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {!showHeader && status && (
        <div className="mt-1 flex items-center">{renderStatus(false)}</div>
      )}
    </div>
  );
}
