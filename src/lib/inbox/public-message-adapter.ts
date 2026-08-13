import type { UIMessage } from "ai";
import type {
  PublicMessageAuthor,
  PublicMessageMetadata,
  PublicSourceReference,
} from "../../../shared/maven-conversation";
import { serializeMessageImageUrls } from "../../../shared/message-images";
import type { Message } from "./types";

type OptimisticMessage = Message & { _optimistic?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isFinite(value));
}

function isPublicSource(value: unknown): value is PublicSourceReference {
  if (!isRecord(value)) return false;
  return typeof value.title === "string" &&
    isNullableString(value.url) &&
    (value.type === "webpage" || value.type === "pdf" || value.type === "faq");
}

function roleForAuthor(author: PublicMessageAuthor): UIMessage["role"] {
  switch (author) {
    case "visitor":
      return "user";
    case "bot":
    case "agent":
      return "assistant";
    case "system":
      return "system";
  }
}

function readMetadata(
  value: unknown,
  projectId: string,
  conversationId: string,
): PublicMessageMetadata | null {
  if (!isRecord(value)) return null;
  const author = value.author;
  if (
    value.v !== 1 ||
    value.channel !== "public" ||
    value.projectId !== projectId ||
    value.conversationId !== conversationId ||
    (author !== "visitor" && author !== "bot" && author !== "agent" &&
      author !== "system") ||
    !isNullableString(value.senderName) ||
    !isNullableString(value.senderAvatar) ||
    !isNullableString(value.userId) ||
    !Array.isArray(value.imageUrls) ||
    !value.imageUrls.every((url) => typeof url === "string") ||
    !Array.isArray(value.sources) ||
    !value.sources.every(isPublicSource) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    !isNullableNumber(value.deliveredAt) ||
    !isNullableNumber(value.readAt) ||
    !isNullableNumber(value.emailedAt) ||
    !isNullableString(value.systemKind)
  ) return null;
  return value as unknown as PublicMessageMetadata;
}

function readText(parts: UIMessage["parts"]): string {
  return parts
    .filter((part): part is Extract<typeof part, { type: "text" }> =>
      part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("");
}

function optionalIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function serializeSources(metadata: PublicMessageMetadata): string | null {
  if (metadata.sources.length > 0) return JSON.stringify(metadata.sources);
  return metadata.systemKind
    ? JSON.stringify({ systemKind: metadata.systemKind })
    : null;
}

function adaptPublicMessage(
  message: UIMessage,
  projectId: string,
  conversationId: string,
): Message | null {
  const metadata = readMetadata(message.metadata, projectId, conversationId);
  if (!metadata || message.role !== roleForAuthor(metadata.author)) return null;
  return {
    id: message.id,
    role: metadata.author,
    content: readText(message.parts),
    imageUrl: serializeMessageImageUrls(metadata.imageUrls),
    sources: serializeSources(metadata),
    senderName: metadata.senderName,
    senderAvatar: metadata.senderAvatar,
    userId: metadata.userId,
    createdAt: new Date(metadata.createdAt).toISOString(),
    emailedAt: optionalIso(metadata.emailedAt),
    deliveredAt: optionalIso(metadata.deliveredAt),
    readAt: optionalIso(metadata.readAt),
  };
}

export function adaptPublicMessages(
  messages: UIMessage[],
  projectId: string,
  conversationId: string,
): Message[] {
  return messages.flatMap((message) => {
    const adapted = adaptPublicMessage(message, projectId, conversationId);
    return adapted ? [adapted] : [];
  });
}

export function reconcilePublicMessages(
  authoritative: Message[],
  current: OptimisticMessage[],
): OptimisticMessage[] {
  const authoritativeIds = new Set(authoritative.map((message) => message.id));
  const pending = current.filter((message) =>
    message._optimistic === true && !authoritativeIds.has(message.id)
  );
  return [...authoritative, ...pending].sort((left, right) => {
    const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return created !== 0 ? created : left.id.localeCompare(right.id);
  });
}
