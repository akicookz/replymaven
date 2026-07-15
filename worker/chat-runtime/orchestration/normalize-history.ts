import { type ConversationTurnMessage } from "../types";

const HISTORY_LIMIT = 10;

// Message timestamps arrive as Date objects (Drizzle rows), ISO strings
// (client payloads), or are absent entirely; normalize to ISO or undefined.
function toIsoTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  return undefined;
}

// Convention: `conversationHistory` throughout the chat runtime contains the
// PRIOR turns only — never the message currently being answered. The current
// message always travels separately as `currentMessage`. Call sites that need
// a full transcript (contact extraction, handoff rendering, team-request
// summaries) append it explicitly via `withCurrentTurn`.
export function normalizeConversationHistory(options: {
  rawHistory: Array<{ role: string; content: string; createdAt?: unknown }>;
  currentMessage: string;
}): ConversationTurnMessage[] {
  const normalized = options.rawHistory
    .filter(
      (message) =>
        message.role === "visitor" ||
        message.role === "agent" ||
        (message.role === "bot" && Boolean(message.content)),
    )
    .map((message) => ({
      role: message.role as "visitor" | "bot" | "agent",
      content: message.content,
      createdAt: toIsoTimestamp(message.createdAt),
    }));

  // A freshly-fetched server history may already contain the just-saved
  // current visitor message as its last entry; drop it so the convention
  // holds for every history source (client payload, prefetch, fresh fetch).
  const last = normalized[normalized.length - 1];
  if (
    last &&
    last.role === "visitor" &&
    last.content === options.currentMessage
  ) {
    normalized.pop();
  }

  return normalized.slice(-HISTORY_LIMIT);
}

export function withCurrentTurn(
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
): ConversationTurnMessage[] {
  return [
    ...conversationHistory,
    {
      role: "visitor",
      content: currentMessage,
      createdAt: new Date().toISOString(),
    },
  ];
}
