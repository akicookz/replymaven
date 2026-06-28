import type { Conversation, Message } from "@/lib/inbox/types";
import MessageBubble from "./MessageBubble";
import SystemPill from "./SystemPill";

interface ChatThreadProps {
  messages: Message[];
  conversation: Conversation;
  onDeleteMessage: (messageId: string) => void;
}

/** Returns midnight (local) for an ISO date string. */
function dayStart(isoStr: string): number {
  const d = new Date(isoStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isSameDay(a: string, b: string): boolean {
  return dayStart(a) === dayStart(b);
}

function dateDividerLabel(isoStr: string): string {
  const todayMs = dayStart(new Date().toISOString());
  const msgMs = dayStart(isoStr);
  const diffDays = Math.round((todayMs - msgMs) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Date(isoStr).toLocaleDateString([], { weekday: "long" });
}

export default function ChatThread({
  messages,
  conversation,
  onDeleteMessage,
}: ChatThreadProps) {
  return (
    <div className="flex-1 min-h-0">
      <div className="max-w-[760px] mx-auto px-[30px] pt-4 pb-[10px]">
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const showDivider = !prev || !isSameDay(prev.createdAt, message.createdAt);

          return (
            <div key={message.id}>
              {showDivider && (
                <div className="flex justify-center my-4">
                  <span className="text-[11px] font-semibold text-ink-8 tracking-wide uppercase">
                    {dateDividerLabel(message.createdAt)}
                  </span>
                </div>
              )}
              {message.role === "system" ? (
                <SystemPill message={message} />
              ) : (
                <MessageBubble
                  message={message}
                  conversation={conversation}
                  onDelete={onDeleteMessage}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
