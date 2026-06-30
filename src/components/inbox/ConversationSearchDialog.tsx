import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Message } from "@/lib/inbox/types";

interface ConversationSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Messages matching the query, in thread order. */
  results: Message[];
  /** Jump to a message in the thread (highlights it + scrolls into view). */
  onPick: (messageId: string) => void;
}

function senderLabel(m: Message): string {
  if (m.role === "visitor") return m.senderName ?? "Visitor";
  if (m.role === "bot") return "Maven · AI";
  return m.senderName ?? "Agent";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Render a windowed snippet around the first match, with the term highlighted.
function Snippet({ content, query }: { content: string; query: string }) {
  const q = query.trim();
  const idx = q ? content.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx === -1) return <>{content}</>;
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + q.length + 140);
  return (
    <>
      {start > 0 ? "…" : ""}
      {content.slice(start, idx)}
      <mark className="bg-amber-400/30 text-ink-1 rounded-[2px]">
        {content.slice(idx, idx + q.length)}
      </mark>
      {content.slice(idx + q.length, end)}
      {end < content.length ? "…" : ""}
    </>
  );
}

export default function ConversationSearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  onPick,
}: ConversationSearchDialogProps) {
  const trimmed = query.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Full-page surface — results get the whole screen instead of a cramped box */}
      <DialogContent className="top-0 left-0 translate-x-0 translate-y-0 w-screen h-screen max-w-none sm:max-w-none rounded-none border-0 p-0 gap-0 flex flex-col">
        {/* Search header — frosted bar, separated by contrast + spacing (no divider) */}
        <div className="shrink-0 glass-bar px-4 md:px-8 pt-6 pb-5">
          <div className="mx-auto w-full max-w-[720px]">
            <DialogHeader className="text-left mb-3">
              <DialogTitle className="text-[16px]">Search conversation</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2.5 rounded-[12px] glass-button h-12 px-4">
              <Search className="size-5 text-ink-6 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search messages…"
                className="flex-1 min-w-0 bg-transparent text-[15px] text-ink-2 placeholder:text-ink-6 outline-none"
              />
              {trimmed.length > 0 && (
                <span className="text-[12px] text-ink-6 tabular-nums shrink-0">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-4">
          <div className="mx-auto w-full max-w-[720px]">
            {trimmed.length === 0 ? (
              <p className="py-16 text-center text-[14px] text-ink-7">
                Type to search this conversation.
              </p>
            ) : results.length === 0 ? (
              <p className="py-16 text-center text-[14px] text-ink-7">
                No messages match “{trimmed}”.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {results.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPick(m.id)}
                    className="w-full text-left rounded-[10px] px-3 py-2.5 hover:bg-glass-button transition-colors"
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold text-ink-4">
                        {senderLabel(m)}
                      </span>
                      <span className="text-[11px] text-ink-7">
                        {formatTime(m.createdAt)}
                      </span>
                    </div>
                    <div className="text-[14px] text-ink-3 line-clamp-2 leading-snug">
                      <Snippet content={m.content} query={query} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
