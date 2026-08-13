import { serializeMessageImageUrls } from "../../shared/message-images";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import type { PublicLastMessagePreview } from "./public-conversation-store";

function serializeRecord(value: Record<string, unknown>): string | null {
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function serializeSources(message: PublicMessageRecord): string | null {
  if (message.sources.length > 0) return JSON.stringify(message.sources);
  return message.systemKind
    ? JSON.stringify({ systemKind: message.systemKind })
    : null;
}

export function toLegacyConversationDto(
  conversation: PublicConversationRecord,
): Record<string, unknown> {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    customerId: conversation.customerId,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    visitorEmail: conversation.visitorEmail,
    status: conversation.status,
    closeReason: conversation.closeReason,
    telegramThreadId: conversation.telegramThreadId,
    metadata: serializeRecord(conversation.metadata),
    chatState: serializeRecord(conversation.chatState),
    lastActivityAt: new Date(conversation.lastActivityAt),
    visitorLastSeenAt: conversation.visitorLastSeenAt
      ? new Date(conversation.visitorLastSeenAt)
      : null,
    visitorPresence: conversation.visitorPresence,
    visitorLastOnlineAt: conversation.visitorLastOnlineAt
      ? new Date(conversation.visitorLastOnlineAt)
      : null,
    snoozedUntil: conversation.snoozedUntil
      ? new Date(conversation.snoozedUntil)
      : null,
    archivedAt: conversation.archivedAt
      ? new Date(conversation.archivedAt)
      : null,
    purgeStartedAt: conversation.purgeStartedAt
      ? new Date(conversation.purgeStartedAt)
      : null,
    externalActionStartedAt: conversation.externalActionStartedAt
      ? new Date(conversation.externalActionStartedAt)
      : null,
    priority: conversation.priority,
    assigneeId: conversation.assigneeId,
    createdAt: new Date(conversation.createdAt),
    updatedAt: new Date(conversation.updatedAt),
  };
}

export function toLegacyMessageDto(
  message: PublicMessageRecord,
): Record<string, unknown> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.author,
    content: message.content,
    imageUrl: serializeMessageImageUrls(message.imageUrls),
    sources: serializeSources(message),
    senderName: message.senderName,
    senderAvatar: message.senderAvatar,
    userId: message.userId,
    createdAt: new Date(message.createdAt),
    emailedAt: message.emailedAt ? new Date(message.emailedAt) : null,
    deliveredAt: message.deliveredAt ? new Date(message.deliveredAt) : null,
    readAt: message.readAt ? new Date(message.readAt) : null,
  };
}

export function toLegacyLastMessagePreviewDto(
  message: PublicLastMessagePreview,
): Record<string, unknown> {
  return {
    id: message.id,
    role: message.author,
    content: message.content,
    senderName: message.senderName,
    emailedAt: message.emailedAt ? new Date(message.emailedAt) : null,
    createdAt: new Date(message.createdAt),
  };
}
