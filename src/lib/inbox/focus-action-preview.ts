import { passesInboxFilter, type InboxFilter } from "./filters";
import type { Conversation } from "./types";

export type FocusConversationAction =
  | { type: "resolve" }
  | { type: "reopen" }
  | { type: "snooze"; until: number | null }
  | { type: "spam" }
  | { type: "unflag" }
  | { type: "block" }
  | { type: "unblock" }
  | { type: "archive" }
  | { type: "unarchive" };

export function previewFocusConversationAction(
  conversation: Conversation,
  action: FocusConversationAction,
  nowMs: number,
): Conversation {
  const actionAt = new Date(nowMs).toISOString();
  switch (action.type) {
    case "resolve":
      return {
        ...conversation,
        status: "closed",
        closeReason: "resolved",
        updatedAt: actionAt,
      };
    case "reopen":
    case "unflag":
      return {
        ...conversation,
        status: "waiting_agent",
        closeReason: null,
        updatedAt: actionAt,
        lastActivityAt: actionAt,
      };
    case "snooze":
      return {
        ...conversation,
        snoozedUntil: action.until
          ? new Date(action.until).toISOString()
          : null,
        updatedAt: actionAt,
      };
    case "spam":
      return {
        ...conversation,
        status: "closed",
        closeReason: "spam",
        updatedAt: actionAt,
      };
    case "block":
      return {
        ...conversation,
        visitorBlocked: true,
        status: "closed",
        closeReason: "spam",
        updatedAt: actionAt,
      };
    case "unblock":
      return {
        ...conversation,
        visitorBlocked: false,
        updatedAt: actionAt,
      };
    case "archive":
      return {
        ...conversation,
        archivedAt: actionAt,
        updatedAt: actionAt,
      };
    case "unarchive":
      return {
        ...conversation,
        archivedAt: null,
        updatedAt: actionAt,
      };
  }
}

export function actionLeavesFilter(
  filter: InboxFilter,
  conversation: Conversation,
  action: FocusConversationAction,
  nowMs: number,
): boolean {
  const preview = previewFocusConversationAction(conversation, action, nowMs);
  return !passesInboxFilter(filter, preview, nowMs);
}
