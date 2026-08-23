import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "./maven-conversation";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function normalizedMessage(message: PublicMessageRecord): Record<string, unknown> {
  function seconds(value: number | null): number | null {
    return value === null ? null : Math.floor(value / 1_000);
  }
  return {
    id: message.id,
    conversationId: message.conversationId,
    author: message.author,
    content: message.content,
    imageUrls: message.imageUrls,
    sources: message.sources,
    senderName: message.senderName,
    senderAvatar: message.senderAvatar,
    userId: message.userId,
    systemKind: message.systemKind,
    createdAt: seconds(message.createdAt),
    deliveredAt: seconds(message.deliveredAt),
    readAt: seconds(message.readAt),
    emailedAt: seconds(message.emailedAt),
  };
}

export async function publicTranscriptChecksum(
  messages: PublicMessageRecord[],
): Promise<string> {
  const ordered = [...messages]
    .sort((left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    )
    .map(normalizedMessage);
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(ordered)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function publicConversationImportChecksum(
  conversation: PublicConversationRecord,
  messages: PublicMessageRecord[],
): Promise<string> {
  const { channelThreads: _channelThreads, ...checksumConversation } = conversation;
  const bytes = new TextEncoder().encode(
    JSON.stringify(stableValue({ conversation: checksumConversation, messages })),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
