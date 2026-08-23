import {
  INBOX_PICK_COPY,
  inboxEmptyCopy,
  type InboxEmptyCopy,
} from "@/lib/inbox/empty-state";
import type { InboxFilter } from "@/lib/inbox/filters";
import type { InboxCounts } from "@/lib/inbox/types";

interface InboxEmptyPaneProps {
  filter: InboxFilter;
  search: string;
  counts: InboxCounts;
  unreadOnly: boolean;
  hasConversations: boolean;
  isLoading: boolean;
}

function EmptyCopy({ copy }: { copy: InboxEmptyCopy }) {
  return (
    <div className="relative max-w-[16rem] px-6 text-center">
      <p className="text-[15px] leading-relaxed text-pretty text-ink-5">
        {copy.headline}
      </p>
      {copy.body && (
        <p className="mt-1.5 text-sm text-pretty text-ink-7">{copy.body}</p>
      )}
    </div>
  );
}

export default function InboxEmptyPane({
  filter,
  search,
  counts,
  unreadOnly,
  hasConversations,
  isLoading,
}: InboxEmptyPaneProps) {
  if (isLoading) {
    return <div className="glass-reading hidden flex-1 md:block" />;
  }

  if (hasConversations) {
    return (
      <div className="glass-reading hidden flex-1 place-items-center text-sm text-ink-7 md:grid">
        {INBOX_PICK_COPY}
      </div>
    );
  }

  const copy = inboxEmptyCopy({ filter, search, counts, unreadOnly });

  return (
    <div className="glass-reading relative hidden flex-1 place-items-center overflow-hidden md:grid">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[46%] left-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-[90px]" />
        <div className="absolute top-[58%] left-[42%] h-48 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(40,92,104,0.28)] blur-[70px]" />
      </div>
      <EmptyCopy copy={copy} />
    </div>
  );
}
