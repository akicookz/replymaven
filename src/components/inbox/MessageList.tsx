import { useState } from "react";
import {
  Search,
  SlidersHorizontal,
  MoreHorizontal,
  Check,
  CheckCheck,
  RefreshCw,
  PanelLeftOpen,
} from "lucide-react";
import { filterTitle, INBOX_SORTS } from "@/lib/inbox/filters";
import type { InboxFilter, InboxSort } from "@/lib/inbox/filters";
import type { Conversation, InboxCounts } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";
import { useMobileSidebar } from "@/lib/mobile-sidebar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
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
  /** True while the conversation list query is in flight (first load). */
  isLoading: boolean;
  // --- Sort & filter + overflow actions (header controls) ---
  /** Read/unread predicate (factors in the client-side read overlay). */
  isUnread: (c: Conversation) => boolean;
  sort: InboxSort;
  onSortChange: (s: InboxSort) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  /** Extra classes for the root (used to hide the list on mobile when a
   *  conversation is open). */
  className?: string;
}

// Filter-appropriate noun for the "N <noun> · M unread" subtitle.
const FILTER_NOUN: Record<InboxFilter, string> = {
  "needs-you": "open",
  all: "total",
  snoozed: "snoozed",
  resolved: "resolved",
  flagged: "flagged",
};

// Placeholder row shown while the list loads (first page or a filter/search
// switch). Mirrors ConversationRow's geometry; widths vary a little per row so
// the stack doesn't look mechanical.
function ConversationRowSkeleton({ index }: { index: number }) {
  const nameW = ["46%", "38%", "52%", "42%"][index % 4];
  const previewW = ["90%", "72%", "84%", "66%"][index % 4];
  return (
    <div className="px-[10px] pt-[9px] pb-[11px] flex items-start">
      <div className="w-[9px] shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 rounded" style={{ width: nameW }} />
          <Skeleton className="h-2.5 w-7 rounded shrink-0" />
        </div>
        <Skeleton className="h-3 w-2/5 rounded mt-[5px]" />
        <Skeleton className="h-2.5 rounded mt-[6px]" style={{ width: previewW }} />
      </div>
    </div>
  );
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
  isLoading,
  isUnread,
  sort,
  onSortChange,
  unreadOnly,
  onUnreadOnlyChange,
  onMarkAllRead,
  onRefresh,
  className,
}: MessageListProps) {
  // Controlled so the overflow actions can close the menu after firing.
  const [moreOpen, setMoreOpen] = useState(false);
  // The inbox renders full-bleed (no PageHeader), so it has to surface its own
  // entry point to the app's dashboard sidebar on mobile.
  const { openSidebar } = useMobileSidebar();

  // Unread is derived client-side (no server flag); the predicate also folds in
  // the local "mark as read" overlay.
  const unreadCount = conversations.filter(isUnread).length;

  const openCount = counts[filter] ?? 0;

  return (
    <div
      className={cn(
        "glass-list border-r border-hairline w-full md:w-[372px] md:shrink-0 flex flex-col min-h-0",
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile: open the app's dashboard sidebar (nav). Hidden on desktop
                where the sidebar is always docked beside the inbox. */}
            <button
              onClick={openSidebar}
              className="glass-button w-8 h-8 rounded-[8px] flex md:hidden items-center justify-center text-ink-4 hover:text-ink-1 transition-colors shrink-0"
              aria-label="Open navigation menu"
              title="Open sidebar"
            >
              <PanelLeftOpen size={18} />
            </button>
            <div className="min-w-0">
              <h2 className="text-[24px] font-bold tracking-[-0.5px] text-ink-1 leading-tight">
                {filterTitle(filter)}
              </h2>
              <p className="text-[12px] text-ink-7 mt-0.5">
                {openCount} {FILTER_NOUN[filter]} · {unreadCount} unread
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-1 shrink-0">
            {/* Sort & filter */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "glass-button w-7 h-7 rounded-[7px] flex items-center justify-center transition-colors",
                    unreadOnly ? "text-[--brand]" : "text-ink-5 hover:text-ink-2",
                  )}
                  title="Sort & filter"
                  aria-label="Sort & filter"
                >
                  <SlidersHorizontal size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1.5">
                <p className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-7">
                  Sort by
                </p>
                {INBOX_SORTS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => onSortChange(opt.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-ink-3 hover:bg-glass-button hover:text-ink-1 transition-colors"
                  >
                    <span className="flex-1 text-left">{opt.label}</span>
                    {sort === opt.id && (
                      <Check size={14} className="text-[--brand] shrink-0" />
                    )}
                  </button>
                ))}
                <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-7">
                  Filter
                </p>
                <button
                  onClick={() => onUnreadOnlyChange(!unreadOnly)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-ink-3 hover:bg-glass-button hover:text-ink-1 transition-colors"
                >
                  <span className="flex-1 text-left">Unread only</span>
                  {unreadOnly && (
                    <Check size={14} className="text-[--brand] shrink-0" />
                  )}
                </button>
              </PopoverContent>
            </Popover>

            {/* Overflow actions */}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  className="glass-button w-7 h-7 rounded-[7px] flex items-center justify-center text-ink-5 hover:text-ink-2 transition-colors"
                  title="More"
                  aria-label="More actions"
                >
                  <MoreHorizontal size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1.5">
                <button
                  onClick={() => {
                    onMarkAllRead();
                    setMoreOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-ink-3 hover:bg-glass-button hover:text-ink-1 transition-colors"
                >
                  <CheckCheck size={14} className="shrink-0 text-ink-5" />
                  Mark all as read
                </button>
                <button
                  onClick={() => {
                    onRefresh();
                    setMoreOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-ink-3 hover:bg-glass-button hover:text-ink-1 transition-colors"
                >
                  <RefreshCw size={14} className="shrink-0 text-ink-5" />
                  Refresh
                </button>
              </PopoverContent>
            </Popover>
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
            isUnread={isUnread(conv)}
            onSelect={onSelect}
            onResolve={onResolve}
            onSnooze={onSnooze}
          />
        ))}

        {/* Load-more affordance (hidden while skeletons show) */}
        {hasMore && conversations.length > 0 && (
          <button
            onClick={onLoadMore}
            className="glass-button w-full rounded-[8px] h-9 text-[13px] text-ink-5 hover:text-ink-3 transition-colors mt-1"
          >
            Load more
          </button>
        )}

        {/* Loading state — row skeletons while the first page (or a filter/search
            switch) is in flight, so we never flash the empty state or the
            previous filter's rows under remote-dev latency. */}
        {isLoading && conversations.length === 0 && (
          <div className="pt-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <ConversationRowSkeleton key={i} index={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && conversations.length === 0 && (
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
