import { Search, SlidersHorizontal, MoreHorizontal } from "lucide-react";
import { filterTitle } from "@/lib/inbox/filters";
import type { InboxFilter } from "@/lib/inbox/filters";
import type { Conversation, InboxCounts } from "@/lib/inbox/types";
import ConversationRow from "./ConversationRow";

// Props from Task 7 orchestrator contract — keep these signatures.
// Restorations (search / load-more) added in Task 8.
interface MessageListProps {
  filter: InboxFilter;
  conversations: Conversation[];
  counts: InboxCounts;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
  // --- Restorations (Task 8) ---
  /** Current search input value (controlled by orchestrator). */
  search: string;
  onSearchChange: (q: string) => void;
  /** Whether the server has more conversations beyond the current page. */
  hasMore: boolean;
  onLoadMore: () => void;
}

export default function MessageList({
  filter,
  conversations,
  counts,
  selectedId,
  onSelect,
  onResolve,
  onSnooze,
  search,
  onSearchChange,
  hasMore,
  onLoadMore,
}: MessageListProps) {
  // Unread heuristic: conversation is unread when the last message came from
  // a visitor (awaiting an agent reply). The server has no explicit unread
  // flag on the list endpoint, so we derive this client-side.
  const unreadCount = conversations.filter(
    (c) => c.lastMessage?.role === "visitor",
  ).length;

  const openCount = counts[filter] ?? 0;

  return (
    <div className="glass-list border-r border-hairline w-[372px] shrink-0 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[24px] font-bold tracking-[-0.5px] text-ink-1 leading-tight">
              {filterTitle(filter)}
            </h2>
            <p className="text-[12px] text-ink-7 mt-0.5">
              {openCount} open · {unreadCount} unread
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1 shrink-0">
            <button
              className="glass-button w-7 h-7 rounded-[7px] flex items-center justify-center text-ink-5"
              title="Filter"
            >
              <SlidersHorizontal size={14} />
            </button>
            <button
              className="glass-button w-7 h-7 rounded-[7px] flex items-center justify-center text-ink-5"
              title="More"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Search field */}
        <div className="mt-2 h-[30px] rounded-[8px] glass-button flex items-center gap-2 px-2">
          <Search size={12} className="text-ink-6 shrink-0" />
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-[13px] text-ink-2 placeholder:text-ink-6 outline-none"
          />
          <span className="keycap shrink-0">⌘K</span>
        </div>
      </div>

      {/* ── Conversation rows ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.map((conv) => (
          <ConversationRow
            key={conv.id}
            conversation={conv}
            isSelected={conv.id === selectedId}
            isUnread={conv.lastMessage?.role === "visitor"}
            onSelect={onSelect}
            onResolve={onResolve}
            onSnooze={onSnooze}
          />
        ))}

        {/* Load-more affordance */}
        {hasMore && (
          <button
            onClick={onLoadMore}
            className="glass-button w-full rounded-[8px] h-9 text-[13px] text-ink-5 hover:text-ink-3 transition-colors mt-1"
          >
            Load more
          </button>
        )}

        {/* Empty state */}
        {conversations.length === 0 && (
          <div className="py-10 text-center text-[13px] text-ink-7">
            {search
              ? "No conversations match your search."
              : "No conversations."}
          </div>
        )}
      </div>
    </div>
  );
}
