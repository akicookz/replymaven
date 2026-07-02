import { Mail, Trash2 } from "lucide-react";
import { deriveMessageStatus } from "@/lib/inbox/message-status";
import type { Conversation, Message } from "@/lib/inbox/types";
import { cn, renderMarkdown } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
  conversation: Conversation;
  onDelete: (messageId: string) => void;
  /** This message matches the active in-conversation search query. */
  isMatch?: boolean;
  /** This message is the currently-focused search match. */
  isActiveMatch?: boolean;
  /** False when this message is grouped with the previous one from the same
   *  sender — the name + timestamp header renders once per group. */
  showHeader?: boolean;
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
  isMatch,
  isActiveMatch,
  showHeader = true,
}: MessageBubbleProps) {
  const isReceived = message.role === "visitor";
  const isBot = message.role === "bot";
  const isAgent = message.role === "agent";

  // Search highlight: ring the matching bubble, brighter for the active match.
  const matchClass = isActiveMatch
    ? "ring-2 ring-amber-400/80"
    : isMatch
      ? "ring-1 ring-amber-400/40"
      : "";

  const senderLabel = isReceived
    ? (message.senderName ?? conversation.visitorName ?? "Visitor")
    : isBot
      ? "Maven · AI"
      : (message.senderName ?? "Agent");

  const labelColorClass = isReceived
    ? "text-ink-5"
    : isBot
      ? "text-brand-label"
      : "text-brand-label-human";

  const html = renderMarkdown(message.content);

  // Grouped messages tuck up under the previous bubble (net ~4px gap).
  const rootSpacing = showHeader ? "mb-3" : "-mt-2 mb-3";

  if (isReceived) {
    return (
      <div className={cn("flex flex-col items-start", rootSpacing)}>
        {showHeader && (
          <div className={`flex items-baseline gap-2 mb-1 ${labelColorClass}`}>
            <span className="text-xs leading-normal font-semibold">{senderLabel}</span>
            <span className="text-[11px] text-ink-8">{formatTime(message.createdAt)}</span>
          </div>
        )}
        <div className={cn("max-w-9/10 sm:max-w-3/4 px-3.5 py-2.5 text-[14.5px] leading-normal bg-bubble-received text-ink-2 rounded-bubble rounded-bl-[6px]", matchClass)}>
          {message.imageUrl && (
            <img
              src={message.imageUrl}
              alt="attachment"
              className="block max-w-full max-h-70 rounded-lg object-contain"
            />
          )}
          {message.content && (
            <div
              className={`prose-chat${message.imageUrl ? " mt-1.5" : ""}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    );
  }

  const status = deriveMessageStatus(message);
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
  const renderStatus = (withLeadingDot: boolean) =>
    status && (
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

  // Sent bubble (bot or agent)
  return (
    <div className={cn("flex flex-col items-end", rootSpacing)}>
      {showHeader && (
        <div className={`flex items-baseline gap-2 mb-1 ${labelColorClass}`}>
          <span className="text-[12px] font-semibold">{senderLabel}</span>
          <span className="text-[11px] text-ink-8">{formatTime(message.createdAt)}</span>
          {renderStatus(true)}
        </div>
      )}
      <div className="relative group max-w-9/10 sm:max-w-3/4">
        <div className={cn("px-3.5 py-2.5 text-[14.5px] leading-normal bg-bubble-sent text-white rounded-bubble rounded-br-[6px]", matchClass)}>
          {message.imageUrl && (
            <img
              src={message.imageUrl}
              alt="attachment"
              className="block max-w-full max-h-70 rounded-lg object-contain"
            />
          )}
          {message.content && (
            <div
              className={`prose-chat${message.imageUrl ? " mt-1.5" : ""}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        {isAgent && (
          <button
            onClick={() => onDelete(message.id)}
            className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-ink-7 hover:text-red-400"
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
