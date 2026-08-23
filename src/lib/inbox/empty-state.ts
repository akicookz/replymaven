import { INBOX_FILTER_IDS, type InboxFilter } from "./filters";
import type { InboxCounts } from "./types";

export interface InboxEmptyCopy {
  headline: string;
  body?: string;
}

export const INBOX_PICK_COPY = "Pick a conversation.";

export function isInboxFirstRun(counts: InboxCounts): boolean {
  return INBOX_FILTER_IDS.every((id) => counts[id] === 0);
}

export function inboxEmptyCopy(input: {
  filter: InboxFilter;
  search: string;
  counts: InboxCounts;
  unreadOnly: boolean;
}): InboxEmptyCopy {
  if (input.search.trim()) {
    return { headline: "No conversations match your search." };
  }
  if (isInboxFirstRun(input.counts)) {
    return { headline: "Conversations from the widget will land here." };
  }
  if (input.unreadOnly) {
    return { headline: "No unread conversations." };
  }
  return inboxFilterEmptyCopy(input.filter, input.counts);
}

export function formatInboxEmptyCopy(copy: InboxEmptyCopy): string {
  return copy.body ? `${copy.headline} ${copy.body}` : copy.headline;
}

function inboxFilterEmptyCopy(
  filter: InboxFilter,
  counts: InboxCounts,
): InboxEmptyCopy {
  switch (filter) {
    case "needs-you":
      if (counts.inbox > 0) {
        return {
          headline: "Support is being handled.",
          body: "You're all free.",
        };
      }
      return { headline: "No open conversations." };
    case "inbox":
      return { headline: "No open conversations." };
    case "snoozed":
      return { headline: "Nothing snoozed." };
    case "resolved":
      return { headline: "Nothing resolved yet." };
    case "archived":
      return { headline: "Nothing archived." };
    case "flagged":
      return { headline: "Nothing flagged." };
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}
