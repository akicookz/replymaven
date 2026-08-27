import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatPerspective } from "@/lib/inbox/sidechat";
import { parseSystemKind } from "@/lib/inbox/system-events";
import type { Conversation, Message } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";
import MessageBubble from "./MessageBubble";
import SystemPill from "./SystemPill";

interface ChatThreadProps {
  messages: Message[];
  conversation: Conversation;
  /** True while the thread is loading for the first time → show bubble skeletons. */
  loading?: boolean;
  onDeleteMessage?: (messageId: string) => void;
  onSendEmail?: (messageId: string) => void;
  /** Archived threads are view-only, including historical agent messages. */
  readOnly?: boolean;
  /** Lowercased in-conversation search query (empty when not searching). */
  searchQuery?: string;
  /** The id of the currently-focused search match (scrolled into view). */
  activeMatchId?: string | null;
  /** The message id targeted by a `?msg=` deep link. */
  highlightMessageId?: string | null;
  perspective?: ChatPerspective;
  onAddToReply?: (draft: string) => void;
  onApprovalAction?: (
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once",
  ) => void;
  /** Optional inset override for layouts such as FocusView. */
  contentClassName?: string;
  /** Optional controls/status rendered inside the same transcript flow. */
  head?: ReactNode;
  tail?: ReactNode;
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

export function ChatThreadSkeleton() {
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
const INITIAL_MESSAGE_WINDOW = 25;
const LOAD_MORE_THRESHOLD_PX = 48;
const STICK_TO_BOTTOM_THRESHOLD_PX = 72;

export default function ChatThread({
  messages,
  conversation,
  loading,
  onDeleteMessage,
  onSendEmail,
  readOnly = false,
  searchQuery,
  activeMatchId,
  highlightMessageId,
  perspective = "public",
  onAddToReply,
  onApprovalAction,
  contentClassName,
  head,
  tail,
}: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const previousConversationIdRef = useRef(conversation.id);
  const initializedConversationRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(messages.length);
  const preserveAnchorRef = useRef<{
    height: number;
    top: number;
  } | null>(null);
  const stickToBottomRef = useRef(true);
  const [visibleMessageCount, setVisibleMessageCount] = useState(
    INITIAL_MESSAGE_WINDOW,
  );
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const q = searchQuery ?? "";

  const firstVisibleIndex = Math.max(
    0,
    messages.length - visibleMessageCount,
  );
  const visibleMessages = useMemo(
    () =>
      messages
        .slice(firstVisibleIndex)
        // "joined" pills carry no information; filtering here (not in the
        // pill) keeps date dividers and grouping on the real messages.
        .filter(
          (message) =>
            message.role !== "system" ||
            parseSystemKind(message.sources) !== "joined",
        ),
    [firstVisibleIndex, messages],
  );

  function scrollContainer(): HTMLElement | null {
    return threadRef.current?.parentElement ?? null;
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth"): void {
    const container = scrollContainer();
    if (!container) return;
    stickToBottomRef.current = true;
    setShowScrollToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior });
  }

  useEffect(() => {
    const container = scrollContainer();
    if (!container) return;
    const scroller = container;

    function handleScroll(): void {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const isNearBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
      stickToBottomRef.current = isNearBottom;
      setShowScrollToLatest(!isNearBottom);

      if (
        scroller.scrollTop <= LOAD_MORE_THRESHOLD_PX &&
        visibleMessageCount < messages.length &&
        preserveAnchorRef.current === null
      ) {
        preserveAnchorRef.current = {
          height: scroller.scrollHeight,
          top: scroller.scrollTop,
        };
        setVisibleMessageCount((current) =>
          Math.min(messages.length, current + INITIAL_MESSAGE_WINDOW)
        );
      }
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [messages.length, visibleMessageCount]);

  useLayoutEffect(() => {
    const container = scrollContainer();
    if (!container) return;

    if (
      initializedConversationRef.current !== conversation.id &&
      !loading &&
      messages.length > 0
    ) {
      initializedConversationRef.current = conversation.id;
      previousConversationIdRef.current = conversation.id;
      previousMessageCountRef.current = messages.length;
      stickToBottomRef.current = true;
      setShowScrollToLatest(false);
      container.scrollTop = container.scrollHeight;
      return;
    }

    const conversationChanged =
      previousConversationIdRef.current !== conversation.id;
    if (conversationChanged) {
      previousConversationIdRef.current = conversation.id;
      initializedConversationRef.current = null;
      previousMessageCountRef.current = messages.length;
      preserveAnchorRef.current = null;
      stickToBottomRef.current = true;
      setVisibleMessageCount(INITIAL_MESSAGE_WINDOW);
      setShowScrollToLatest(false);
      container.scrollTop = container.scrollHeight;
      return;
    }

    const preserved = preserveAnchorRef.current;
    if (preserved) {
      container.scrollTop = preserved.top +
        (container.scrollHeight - preserved.height);
      preserveAnchorRef.current = null;
      return;
    }

    const messageCountChanged = previousMessageCountRef.current !== messages.length;
    previousMessageCountRef.current = messages.length;
    if (messageCountChanged && stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [conversation.id, loading, messages.length, visibleMessageCount]);

  useLayoutEffect(() => {
    if (!activeMatchId && !highlightMessageId) return;
    const targetId = activeMatchId ?? highlightMessageId;
    const targetIndex = messages.findIndex((message) => message.id === targetId);
    if (targetIndex < 0 || targetIndex >= firstVisibleIndex) return;
    setVisibleMessageCount(messages.length - targetIndex);
  }, [activeMatchId, firstVisibleIndex, highlightMessageId, messages]);

  useLayoutEffect(() => {
    const container = scrollContainer();
    if (!container || loading || messages.length === 0) return;
    if (previousMessageCountRef.current === 0) {
      stickToBottomRef.current = true;
      container.scrollTop = container.scrollHeight;
    }
    previousMessageCountRef.current = messages.length;
  }, [loading, messages.length]);

  return (
    <div ref={threadRef} data-chat-thread className="relative min-h-full">
      {showScrollToLatest && (
        <div className="pointer-events-none sticky top-[calc(100%-3.25rem)] z-10 flex h-0 justify-center">
          <button
            type="button"
            aria-label="Scroll to latest message"
            className="glass-button pointer-events-auto flex size-10 items-center justify-center rounded-full text-ink-4 shadow-lg motion-safe:transition-[color,background-color,transform] motion-safe:duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0"
            onClick={() => scrollToLatest()}
          >
            <ArrowDown aria-hidden="true" className="size-4" strokeWidth={2} />
          </button>
        </div>
      )}
      {/* Full-bleed with the same 30px inset as the header/composer so bubbles
          align to the pane edges (not a centered narrow column). */}
      <div className={cn("px-4 md:px-[30px] pt-4 pb-[10px]", contentClassName)}>
        {head}
        {loading && messages.length === 0 && <ChatThreadSkeleton />}
        {visibleMessages.map((message, i) => {
          const prev = visibleMessages[i - 1];
          const next = visibleMessages[i + 1];
          const showDivider = !prev || !isSameDay(prev.createdAt, message.createdAt);
          // Back-to-back messages from the same sender share one metadata line
          // beneath the final bubble in the group.
          const groupedWithPrev =
            !showDivider &&
            !!prev &&
            message.role !== "system" &&
            prev.role === message.role &&
            (prev.senderName ?? null) === (message.senderName ?? null) &&
            new Date(message.createdAt).getTime() -
              new Date(prev.createdAt).getTime() <=
              GROUP_WINDOW_MS;
          const groupedWithNext =
            !!next &&
            isSameDay(message.createdAt, next.createdAt) &&
            message.role !== "system" &&
            next.role === message.role &&
            (next.senderName ?? null) === (message.senderName ?? null) &&
            new Date(next.createdAt).getTime() -
              new Date(message.createdAt).getTime() <=
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
                <SystemPill message={message} />
              ) : (
                <MessageBubble
                  message={message}
                  conversation={conversation}
                  onDelete={onDeleteMessage}
                  onSendEmail={onSendEmail}
                  readOnly={readOnly}
                  isMatch={isMatch}
                  isActiveMatch={isActiveMatch}
                  groupedWithPrev={groupedWithPrev}
                  showMetadata={!groupedWithNext}
                  perspective={perspective}
                  onAddToReply={onAddToReply}
                  onApprovalAction={onApprovalAction}
                />
              )}
            </div>
          );
        })}
        {tail}
      </div>
    </div>
  );
}
