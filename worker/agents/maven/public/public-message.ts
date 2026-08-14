import type {
  FileUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  UIMessage,
} from "ai";
import type {
  PublicMessageAuthor,
  PublicMessageMetadata,
  PublicMessageRecord,
  PublicSourceReference,
} from "../../../../shared/maven-conversation";

type PublicDataParts = Record<string, unknown> & {
  "public-source": PublicSourceReference;
  "public-activity": { phase: string };
};

export type PublicUIMessage = UIMessage<PublicMessageMetadata, PublicDataParts>;

function roleForAuthor(
  author: PublicMessageAuthor,
): PublicUIMessage["role"] {
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

function sourcePart(
  source: PublicSourceReference,
  index: number,
): SourceUrlUIPart | SourceDocumentUIPart {
  const sourceId = `public-source-${index}`;
  return source.url
    ? {
        type: "source-url",
        sourceId,
        url: source.url,
        title: source.title,
      }
    : {
        type: "source-document",
        sourceId,
        mediaType: "text/plain",
        title: source.title,
      };
}

function filePart(url: string): FileUIPart {
  return {
    type: "file",
    mediaType: "image/*",
    url,
  };
}

export function toPublicUiMessage(
  message: PublicMessageRecord,
  projectId: string,
): PublicUIMessage {
  const metadata: PublicMessageMetadata = {
    v: 1,
    channel: "public",
    projectId,
    conversationId: message.conversationId,
    author: message.author,
    senderName: message.senderName,
    senderAvatar: message.senderAvatar,
    userId: message.userId,
    imageUrls: [...message.imageUrls],
    sources: structuredClone(message.sources),
    createdAt: message.createdAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    emailedAt: message.emailedAt,
    systemKind: message.systemKind,
    idempotencyKey: message.idempotencyKey ?? null,
    origin: message.origin ?? null,
    externalReplyTo: message.externalReplyTo ?? null,
  };
  return {
    id: message.id,
    role: roleForAuthor(message.author),
    metadata,
    parts: [
      { type: "text", text: message.content },
      ...message.imageUrls.map(filePart),
      ...message.sources.map(sourcePart),
    ],
  };
}

function isPublicMessageMetadata(
  value: unknown,
  projectId: string,
  conversationId: string,
): value is PublicMessageMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Partial<PublicMessageMetadata>;
  return metadata.v === 1 &&
    metadata.channel === "public" &&
    metadata.projectId === projectId &&
    metadata.conversationId === conversationId &&
    (metadata.author === "visitor" || metadata.author === "bot" ||
      metadata.author === "agent" || metadata.author === "system") &&
    Array.isArray(metadata.imageUrls) &&
    Array.isArray(metadata.sources) &&
    typeof metadata.createdAt === "number";
}

function textContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> =>
      part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export function fromPublicUiMessage(
  message: UIMessage,
  projectId: string,
  conversationId: string,
): PublicMessageRecord {
  if (!isPublicMessageMetadata(message.metadata, projectId, conversationId)) {
    throw new Error("Invalid public message metadata");
  }
  if (message.role !== roleForAuthor(message.metadata.author)) {
    throw new Error("Public message author does not match its role");
  }
  return {
    id: message.id,
    conversationId,
    author: message.metadata.author,
    content: textContent(message),
    imageUrls: [...message.metadata.imageUrls],
    sources: structuredClone(message.metadata.sources),
    senderName: message.metadata.senderName,
    senderAvatar: message.metadata.senderAvatar,
    userId: message.metadata.userId,
    systemKind: message.metadata.systemKind,
    createdAt: message.metadata.createdAt,
    deliveredAt: message.metadata.deliveredAt,
    readAt: message.metadata.readAt,
    emailedAt: message.metadata.emailedAt,
    idempotencyKey: message.metadata.idempotencyKey ?? null,
    origin: message.metadata.origin ?? null,
    externalReplyTo: message.metadata.externalReplyTo ?? null,
  };
}

export function sanitizePublicMessageForPersistence(
  message: UIMessage,
  projectId: string,
  conversationId: string,
): PublicUIMessage {
  const record = fromPublicUiMessage(message, projectId, conversationId);
  return toPublicUiMessage(record, projectId);
}
