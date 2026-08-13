import { serializeMessageImageUrls } from "../../shared/message-images";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";

function serializeSources(message: PublicMessageRecord): string | null {
  if (message.systemKind) {
    return JSON.stringify({ systemKind: message.systemKind });
  }
  return message.sources.length > 0 ? JSON.stringify(message.sources) : null;
}

export async function projectPublicConversationSnapshot(
  database: D1Database,
  conversation: PublicConversationRecord,
  messages: PublicMessageRecord[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    database.prepare(
      `INSERT INTO conversations (
        id, project_id, customer_id, visitor_id, visitor_name, visitor_email,
        status, close_reason, telegram_thread_id, metadata, chat_state,
        last_activity_at, visitor_last_seen_at, visitor_presence,
        visitor_last_online_at, snoozed_until, archived_at, purge_started_at,
        external_action_started_at, priority, assignee_id, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        customer_id = excluded.customer_id,
        visitor_id = excluded.visitor_id,
        visitor_name = excluded.visitor_name,
        visitor_email = excluded.visitor_email,
        status = excluded.status,
        close_reason = excluded.close_reason,
        telegram_thread_id = excluded.telegram_thread_id,
        metadata = excluded.metadata,
        chat_state = excluded.chat_state,
        last_activity_at = excluded.last_activity_at,
        visitor_last_seen_at = excluded.visitor_last_seen_at,
        visitor_presence = excluded.visitor_presence,
        visitor_last_online_at = excluded.visitor_last_online_at,
        snoozed_until = excluded.snoozed_until,
        archived_at = excluded.archived_at,
        purge_started_at = excluded.purge_started_at,
        external_action_started_at = excluded.external_action_started_at,
        priority = excluded.priority,
        assignee_id = excluded.assignee_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
    ).bind(
      conversation.id,
      conversation.projectId,
      conversation.customerId,
      conversation.visitorId,
      conversation.visitorName,
      conversation.visitorEmail,
      conversation.status,
      conversation.closeReason,
      conversation.telegramThreadId,
      JSON.stringify(conversation.metadata),
      JSON.stringify(conversation.chatState),
      Math.floor(conversation.lastActivityAt / 1_000),
      conversation.visitorLastSeenAt === null
        ? null
        : Math.floor(conversation.visitorLastSeenAt / 1_000),
      conversation.visitorPresence,
      conversation.visitorLastOnlineAt === null
        ? null
        : Math.floor(conversation.visitorLastOnlineAt / 1_000),
      conversation.snoozedUntil === null
        ? null
        : Math.floor(conversation.snoozedUntil / 1_000),
      conversation.archivedAt === null
        ? null
        : Math.floor(conversation.archivedAt / 1_000),
      conversation.purgeStartedAt === null
        ? null
        : Math.floor(conversation.purgeStartedAt / 1_000),
      conversation.externalActionStartedAt === null
        ? null
        : Math.floor(conversation.externalActionStartedAt / 1_000),
      conversation.priority,
      conversation.assigneeId,
      Math.floor(conversation.createdAt / 1_000),
      Math.floor(conversation.updatedAt / 1_000),
    ),
    database.prepare(
      "DELETE FROM messages WHERE conversation_id = ?",
    ).bind(conversation.id),
  ];
  for (const message of messages) {
    statements.push(database.prepare(
      `INSERT INTO messages (
        id, conversation_id, role, content, image_url, sources,
        sender_name, sender_avatar, user_id, created_at, emailed_at,
        delivered_at, read_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      message.id,
      conversation.id,
      message.author,
      message.content,
      serializeMessageImageUrls(message.imageUrls),
      serializeSources(message),
      message.senderName,
      message.senderAvatar,
      message.userId,
      Math.floor(message.createdAt / 1_000),
      message.emailedAt === null ? null : Math.floor(message.emailedAt / 1_000),
      message.deliveredAt === null
        ? null
        : Math.floor(message.deliveredAt / 1_000),
      message.readAt === null ? null : Math.floor(message.readAt / 1_000),
    ));
  }
  await database.batch(statements);
}
