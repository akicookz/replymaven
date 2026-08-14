export type InboxFilter =
  | "needs-you"
  | "all"
  | "snoozed"
  | "resolved"
  | "archived"
  | "flagged";
export const INBOX_FILTERS: { id: InboxFilter; title: string }[] = [
  { id: "needs-you", title: "Needs You" },
  { id: "all", title: "All Conversations" },
  { id: "snoozed", title: "Snoozed" },
  { id: "resolved", title: "Resolved" },
  { id: "archived", title: "Archived" },
  { id: "flagged", title: "Flagged" },
];
export function filterTitle(f: InboxFilter): string {
  return INBOX_FILTERS.find((x) => x.id === f)?.title ?? "Needs You";
}

// Client-side mirror of the server's inboxFilterConditions (see
// worker/agents/maven/conversation-directory.ts): snoozed and flagged (spam) conversations
// live only in their own tabs. Used by the /updates poll merge to decide
// which delta rows enter — and which patched rows leave — the visible list.
export interface InboxFilterableRow {
  status: string;
  closeReason?: string | null;
  snoozedUntil?: string | null;
  archivedAt?: string | null;
}

export function passesInboxFilter(
  filter: InboxFilter,
  row: InboxFilterableRow,
  nowMs: number,
): boolean {
  const snoozeMs = row.snoozedUntil ? new Date(row.snoozedUntil).getTime() : NaN;
  const snoozed = Number.isFinite(snoozeMs) && snoozeMs > nowMs;
  const spam = row.closeReason === "spam";
  const archived = row.archivedAt != null;
  switch (filter) {
    case "needs-you":
      return row.status === "waiting_agent" && !snoozed && !archived;
    case "all":
      return !snoozed && !spam && !archived;
    case "snoozed":
      return snoozed && !archived;
    case "resolved":
      return row.status === "closed" && !spam && !archived;
    case "archived":
      return archived;
    case "flagged":
      return spam && !archived;
  }
}

// List sort order, surfaced by the conversation-list "sort & filter" control.
export type InboxSort = "newest" | "oldest" | "priority";
export const INBOX_SORTS: { id: InboxSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "priority", label: "Priority" },
];
