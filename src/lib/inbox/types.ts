import type { InboxFilter } from "./filters";

// Shared inbox data shapes consumed by the Conversations orchestrator and the
// inbox presentational components (MessageList / ReadingPane / FocusView and
// their descendants in Tasks 8–13).

export interface LastMessagePreview {
  id: string;
  role: "visitor" | "bot" | "agent" | "system";
  content: string;
  senderName: string | null;
  emailedAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  closeReason: string | null;
  priority?: "low" | "medium" | "high" | null;
  snoozedUntil?: string | null;
  metadata: string | null;
  visitorLastSeenAt: string | null;
  visitorPresence: string | null;
  visitorLastOnlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string | null;
  lastMessage?: LastMessagePreview | null;
}

export interface Message {
  id: string;
  // Dashboard threads include centred `system` event rows (snoozed, flagged,
  // joined, …) in addition to the conversational roles.
  role: "visitor" | "bot" | "agent" | "system";
  content: string;
  imageUrl?: string | null;
  sources?: string | null;
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  createdAt: string;
  emailedAt?: string | null;
}

export type InboxCounts = Record<InboxFilter, number>;
