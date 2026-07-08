import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox/types";
import ReadingHeader from "./ReadingHeader";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import ConversationSearchDialog from "./ConversationSearchDialog";

// Props contract — orchestrator (Conversations.tsx) passes these; all props
// are additive from the Task-7 stub. Tasks 10/11 receive the subset they need.
interface ReadingPaneProps {
  conversation: Conversation;
  messages: Message[];
  /** True while the conversation detail (messages) is loading for the first time. */
  messagesLoading?: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (
    content?: string,
    opts?: { imageUrls?: string[]; asEmail?: boolean },
  ) => void;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
  onFlagSpam: (convId: string) => void;
  onPriority: (convId: string, priority: "low" | "medium" | "high") => void;
  onFocus: () => void;
  /** Block the visitor associated with this conversation. */
  onBlock: (convId: string) => void;
  /** Assign (or unassign with null) this conversation to a teammate. */
  onAssign: (convId: string, assigneeId: string | null) => void;
  /** Delete a sent agent message by id. */
  onDeleteMessage: (messageId: string) => void;
  /** Mobile: return to the conversation list (clears the selection). */
  onBack?: () => void;
  /** Turn the composer's instruction into a tone-matched reply (Shift+Tab). */
  onCompose: () => void;
  /** True while a compose request is in flight. */
  composing: boolean;
  /** The message id targeted by a `?msg=` deep link — pulses the review-summary card. */
  highlightMessageId?: string | null;
}

export default function ReadingPane({
  conversation,
  messages,
  messagesLoading,
  draft,
  setDraft,
  onSend,
  onResolve,
  onSnooze,
  onFlagSpam,
  onPriority,
  onFocus,
  onBlock,
  onAssign,
  onDeleteMessage,
  onBack,
  onCompose,
  composing,
  highlightMessageId,
}: ReadingPaneProps) {
  // The thread is its own scroll container now (header above / composer below
  // are flex siblings, never overlapping the thread). This both fixes messages
  // landing behind the composer and lets us pin the latest message into view.
  const scrollRef = useRef<HTMLDivElement>(null);
  const convIdRef = useRef<string | null>(null);
  const pendingJumpRef = useRef(true);
  const prevLenRef = useRef(0);

  // In-conversation search: opened from a single toolbar icon into a modal.
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  const query = search.trim().toLowerCase();
  const matchMessages = query
    ? messages.filter(
        (m) => m.role !== "system" && m.content.toLowerCase().includes(query),
      )
    : [];
  const matchIds = matchMessages.map((m) => m.id);
  // Clamp the active index whenever the match set changes.
  const safeActive = matchIds.length ? Math.min(activeMatch, matchIds.length - 1) : 0;
  const activeMatchId = matchIds[safeActive] ?? null;

  // Reset the active match when the query changes.
  useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  // Clear search when switching conversations.
  useEffect(() => {
    setSearch("");
    setSearchOpen(false);
    setActiveMatch(0);
  }, [conversation.id]);

  // Scroll the active search match into view as the user steps through them.
  useEffect(() => {
    if (!activeMatchId) return;
    const el = scrollRef.current?.querySelector(
      `[data-msg-id="${activeMatchId}"]`,
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchId]);

  // Pin the thread to the latest message on open, and keep it pinned when a new
  // message arrives while the agent is already near the bottom (so live/sent
  // messages land in view instead of below the fold). A search jump suppresses
  // the auto-pin so stepping through matches isn't yanked back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (convIdRef.current !== conversation.id) {
      convIdRef.current = conversation.id;
      pendingJumpRef.current = true;
      prevLenRef.current = 0;
    }
    if (query) {
      prevLenRef.current = messages.length;
      return;
    }
    if (pendingJumpRef.current) {
      if (messages.length > 0) {
        el.scrollTop = el.scrollHeight;
        pendingJumpRef.current = false;
      }
      prevLenRef.current = messages.length;
      return;
    }
    if (messages.length > prevLenRef.current) {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (nearBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
    prevLenRef.current = messages.length;
  }, [conversation.id, messages.length, query]);

  // Deep-link (?msg=): scroll the target message into view once it's
  // rendered. Placed after the auto-pin effect above (and keyed on
  // messages.length) so this scroll wins once the target conversation's
  // messages have actually landed. The scroll is one-shot per conversation
  // view: scrolledForRef records the conversation it fired for, and is only
  // set AFTER the target element is found — so the effect retries while
  // messages are still loading, but later length bumps (optimistic sends,
  // live visitor messages) can't yank the view back up to the summary while
  // the highlight styling is still active.
  const scrolledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightMessageId) return;
    if (scrolledForRef.current === conversation.id) return;
    const el = scrollRef.current?.querySelector(
      `[data-msg-id="${highlightMessageId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    scrolledForRef.current = conversation.id;
  }, [highlightMessageId, messages.length, conversation.id]);

  // Desktop inline search: cycle through matches.
  function stepMatch(delta: number) {
    if (matchIds.length === 0) return;
    setActiveMatch((i) => {
      const len = matchIds.length;
      return (((i + delta) % len) + len) % len;
    });
  }

  // Mobile modal: jump to a chosen result.
  function handlePickMatch(messageId: string) {
    const idx = matchIds.indexOf(messageId);
    if (idx >= 0) setActiveMatch(idx);
    setSearchOpen(false);
  }

  return (
    <div className="glass-reading flex-1 min-w-0 flex flex-col h-full overflow-hidden">
      {/* Header: toolbar row + user bar (fixed; thread scrolls below it) */}
      <ReadingHeader
        conversation={conversation}
        onResolve={onResolve}
        onSnooze={onSnooze}
        onFlagSpam={onFlagSpam}
        onPriority={onPriority}
        onBlock={onBlock}
        onAssign={onAssign}
        onFocus={onFocus}
        onBack={onBack}
        search={search}
        onSearchChange={setSearch}
        matchCount={matchIds.length}
        matchIndex={matchIds.length ? safeActive + 1 : 0}
        onMatchNext={() => stepMatch(1)}
        onMatchPrev={() => stepMatch(-1)}
        onOpenSearch={() => setSearchOpen(true)}
        searchActive={query.length > 0}
      />

      {/* Chat thread — the only scroll region in the pane */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <ChatThread
          messages={messages}
          conversation={conversation}
          loading={messagesLoading}
          onDeleteMessage={onDeleteMessage}
          searchQuery={query}
          activeMatchId={activeMatchId}
          highlightMessageId={highlightMessageId}
        />
      </div>

      {/* Composer — flex sibling below the thread (no longer overlaps it) */}
      <Composer
        draft={draft}
        setDraft={setDraft}
        onSend={onSend}
        onResolve={onResolve}
        onCompose={onCompose}
        composing={composing}
        convId={conversation.id}
      />

      {/* Search-conversation modal (opened from the toolbar search icon) */}
      <ConversationSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={search}
        onQueryChange={setSearch}
        results={matchMessages}
        onPick={handlePickMatch}
      />
    </div>
  );
}
