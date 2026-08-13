import type { UIMessage } from "ai";
import type {
  PublicMessageAuthor,
  PublicMessageMetadata,
  PublicMessageRecord,
  PublicSourceReference,
} from "../shared/maven-conversation";

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
    !isNullableString(value.systemKind) ||
    (value.idempotencyKey !== undefined &&
      !isNullableString(value.idempotencyKey)) ||
    (value.origin !== undefined && value.origin !== null &&
      value.origin !== "widget" && value.origin !== "dashboard" &&
      value.origin !== "telegram" && value.origin !== "email" &&
      value.origin !== "mcp") ||
    (value.externalReplyTo !== undefined &&
      !isNullableString(value.externalReplyTo))
  ) return null;
  return value as unknown as PublicMessageMetadata;
}

function readText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> =>
      part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("");
}

export function adaptWidgetPublicMessages(
  messages: UIMessage[],
  projectId: string,
  conversationId: string,
): PublicMessageRecord[] {
  return messages.flatMap((message) => {
    const metadata = readMetadata(
      message.metadata,
      projectId,
      conversationId,
    );
    if (!metadata || message.role !== roleForAuthor(metadata.author)) return [];
    return [{
      id: message.id,
      conversationId,
      author: metadata.author,
      content: readText(message),
      imageUrls: [...metadata.imageUrls],
      sources: structuredClone(metadata.sources),
      senderName: metadata.senderName,
      senderAvatar: metadata.senderAvatar,
      userId: metadata.userId,
      systemKind: metadata.systemKind,
      createdAt: metadata.createdAt,
      deliveredAt: metadata.deliveredAt,
      readAt: metadata.readAt,
      emailedAt: metadata.emailedAt,
      idempotencyKey: metadata.idempotencyKey ?? null,
      origin: metadata.origin ?? null,
      externalReplyTo: metadata.externalReplyTo ?? null,
    } satisfies PublicMessageRecord];
  });
}
