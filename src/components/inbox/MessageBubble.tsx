import { Trash2 } from "lucide-react";
import type { Conversation, Message } from "@/lib/inbox/types";
import { renderMarkdown } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
  conversation: Conversation;
  onDelete: (messageId: string) => void;
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
}: MessageBubbleProps) {
  const isReceived = message.role === "visitor";
  const isBot = message.role === "bot";
  const isAgent = message.role === "agent";

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

  if (isReceived) {
    return (
      <div className="flex flex-col items-start mb-3">
        <div className={`flex items-baseline gap-2 mb-1 ${labelColorClass}`}>
          <span className="text-[12px] font-semibold">{senderLabel}</span>
          <span className="text-[11px] text-ink-8">{formatTime(message.createdAt)}</span>
        </div>
        <div className="max-w-[74%] px-[14px] py-[10px] text-[14.5px] leading-[1.5] bg-bubble-received text-ink-2 rounded-[20px_20px_20px_6px]">
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    );
  }

  // Sent bubble (bot or agent)
  return (
    <div className="flex flex-col items-end mb-3">
      <div className={`flex items-baseline gap-2 mb-1 ${labelColorClass}`}>
        <span className="text-[12px] font-semibold">{senderLabel}</span>
        <span className="text-[11px] text-ink-8">{formatTime(message.createdAt)}</span>
      </div>
      <div className="relative group max-w-[74%]">
        <div className="px-[14px] py-[10px] text-[14.5px] leading-[1.5] bg-bubble-sent text-white rounded-[20px_20px_6px_20px]">
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{ __html: html }}
          />
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
    </div>
  );
}
