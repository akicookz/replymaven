import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation, Message } from "@/lib/inbox/types";
import { parseSystemKind } from "@/lib/inbox/system-events";
import MessageBubble from "./MessageBubble";
import SystemPill from "./SystemPill";
import ReviewSummaryCard from "./ReviewSummaryCard";

interface ChatThreadProps {
  messages: Message[];
  conversation: Conversation;
  /** True while the thread is loading for the first time → show bubble skeletons. */
  loading?: boolean;
  onDeleteMessage: (messageId: string) => void;
  /** Lowercased in-conversation search query (empty when not searching). */
  searchQuery?: string;
  /** The id of the currently-focused search match (scrolled into view). */
  activeMatchId?: string | null;
  /** The message id targeted by a `?msg=` deep link — pulses the review-summary card. */
  highlightMessageId?: string | null;
}

// Placeholder bubbles shown while the conversation detail loads. Mirrors the
// MessageBubble layout (label + tail-cut bubble), alternating sides.
const SKELETON_BUBBLES: { side: "left" | "right"; w: string; h: string }[] = [
  { side: "left", w: "62%", h: "h-16" },
  { side: "right", w: "48%", h: "h-11" },
  { side: "left", w: "40%", h: "h-9" },
  { side: "right", w: "55%", h: "h-14" },
  { side: "left", w: "50%", h: "h-11" },
];

function ChatThreadSkeleton() {
  return (
    <div aria-hidden className="animate-in fade-in duration-200">
      {SKELETON_BUBBLES.map((b, i) => {
        const isLeft = b.side === "left";
        return (
          <div
            key={i}
            className={cn(
              "mb-3 flex flex-col",
              isLeft ? "items-start" : "items-end",
            )}
          >
            <Skeleton className="h-2.5 w-14 mb-1.5 rounded" />
            <Skeleton
              className={cn(
                b.h,
                "rounded-[20px]",
                isLeft ? "rounded-bl-[6px]" : "rounded-br-[6px]",
              )}
              style={{ width: b.w }}
            />
          </div>
        );
      })}
    </div>
  );
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

// Consecutive same-sender messages within this window collapse into one
// group: the name + timestamp header renders once, on the first message.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function ChatThread({
  messages,
  conversation,
  loading,
  onDeleteMessage,
  searchQuery,
  activeMatchId,
  highlightMessageId,
}: ChatThreadProps) {
  const q = searchQuery ?? "";
  return (
    <div className="min-h-full">
      {/* Full-bleed with the same 30px inset as the header/composer so bubbles
          align to the pane edges (not a centered narrow column). */}
      <div className="px-4 md:px-[30px] pt-4 pb-[10px]">
        {loading && messages.length === 0 && <ChatThreadSkeleton />}
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const showDivider = !prev || !isSameDay(prev.createdAt, message.createdAt);
          // Back-to-back messages from the same sender (no reply or date break
          // in between) share one header — name + timestamp shown once.
          const groupedWithPrev =
            !showDivider &&
            !!prev &&
            message.role !== "system" &&
            prev.role === message.role &&
            (prev.senderName ?? null) === (message.senderName ?? null) &&
            new Date(message.createdAt).getTime() -
              new Date(prev.createdAt).getTime() <=
              GROUP_WINDOW_MS;
          const isMatch =
            q.length > 0 &&
            message.role !== "system" &&
            message.content.toLowerCase().includes(q);
          const isActiveMatch = isMatch && message.id === activeMatchId;

          return (
            <div key={message.id} data-msg-id={message.id}>
              {showDivider && (
                <div className="flex justify-center my-4">
                  <span className="text-[11px] font-semibold text-ink-8 tracking-wide uppercase">
                    {dateDividerLabel(message.createdAt)}
                  </span>
                </div>
              )}
              {message.role === "system" ? (
                parseSystemKind(message.sources) === "review_summary" ? (
                  <ReviewSummaryCard
                    message={message}
                    highlight={message.id === highlightMessageId}
                  />
                ) : (
                  <SystemPill message={message} />
                )
              ) : (
                <MessageBubble
                  message={message}
                  conversation={conversation}
                  onDelete={onDeleteMessage}
                  isMatch={isMatch}
                  isActiveMatch={isActiveMatch}
                  showHeader={!groupedWithPrev}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
