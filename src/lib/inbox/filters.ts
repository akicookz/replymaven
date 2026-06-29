export type InboxFilter = "needs-you" | "all" | "snoozed" | "resolved" | "flagged";
export const INBOX_FILTERS: { id: InboxFilter; title: string }[] = [
  { id: "needs-you", title: "Needs You" },
  { id: "all", title: "All Conversations" },
  { id: "snoozed", title: "Snoozed" },
  { id: "resolved", title: "Resolved" },
  { id: "flagged", title: "Flagged" },
];
export function filterTitle(f: InboxFilter): string {
  return INBOX_FILTERS.find((x) => x.id === f)?.title ?? "Needs You";
}

// List sort order, surfaced by the conversation-list "sort & filter" control.
export type InboxSort = "newest" | "oldest" | "priority";
export const INBOX_SORTS: { id: InboxSort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "priority", label: "Priority" },
];
