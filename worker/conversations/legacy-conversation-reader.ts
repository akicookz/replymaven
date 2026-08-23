import { and, asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { conversations, messages } from "../db";
import type { ConversationRow, MessageRow } from "../db";
import { parseMessageImageUrls } from "../../shared/message-images";
import {
  publicChannelThreads,
  type PublicConversationRecord,
  type PublicMessageRecord,
  type PublicSourceReference,
} from "../../shared/maven-conversation";

// Read-only access to the frozen legacy D1 conversation tables. The Agent
// runtime is the only writer; these rows exist solely as the import source
// and parity baseline until the final migration drops them.

function toMillis(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isPublicSourceReference(value: unknown): value is PublicSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.title === "string" &&
    (source.url === null || typeof source.url === "string") &&
    (source.type === "webpage" || source.type === "pdf" || source.type === "faq")
  );
}

function parseMessageSources(raw: string | null): PublicSourceReference[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPublicSourceReference) : [];
  } catch {
    return [];
  }
}

function parseSystemKind(raw: string | null): string | null {
  const parsed = parseJsonRecord(raw);
  return typeof parsed.systemKind === "string" ? parsed.systemKind : null;
}

export function mapD1ConversationRow(
  row: ConversationRow,
): PublicConversationRecord {
  const chatState = parseJsonRecord(row.chatState);
  const rawOwnershipRevision = chatState.ownershipRevision;
  const ownershipRevision =
    typeof rawOwnershipRevision === "number" &&
    Number.isFinite(rawOwnershipRevision)
      ? Math.max(0, Math.floor(rawOwnershipRevision))
      : 0;

  return {
    id: row.id,
    projectId: row.projectId,
    customerId: row.customerId,
    visitorId: row.visitorId,
    visitorName: row.visitorName,
    visitorEmail: row.visitorEmail,
    status: row.status,
    closeReason: row.closeReason,
    telegramThreadId: row.telegramThreadId,
    channelThreads: publicChannelThreads(row.telegramThreadId),
    metadata: parseJsonRecord(row.metadata),
    chatState,
    lastActivityAt: row.lastActivityAt?.getTime() ?? row.createdAt.getTime(),
    visitorLastSeenAt: toMillis(row.visitorLastSeenAt),
    visitorPresence: row.visitorPresence ?? "active",
    visitorLastOnlineAt: toMillis(row.visitorLastOnlineAt),
    snoozedUntil: toMillis(row.snoozedUntil),
    archivedAt: toMillis(row.archivedAt),
    purgeStartedAt: toMillis(row.purgeStartedAt),
    externalActionStartedAt: toMillis(row.externalActionStartedAt),
    priority: row.priority ?? "medium",
    assigneeId: row.assigneeId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    ownershipRevision,
  };
}

export function mapD1MessageRow(row: MessageRow): PublicMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: row.role,
    content: row.content,
    imageUrls: parseMessageImageUrls(row.imageUrl),
    sources: parseMessageSources(row.sources),
    senderName: row.senderName,
    senderAvatar: row.senderAvatar,
    userId: row.userId,
    systemKind: parseSystemKind(row.sources),
    createdAt: row.createdAt.getTime(),
    deliveredAt: toMillis(row.deliveredAt),
    readAt: toMillis(row.readAt),
    emailedAt: toMillis(row.emailedAt),
  };
}

export class LegacyConversationReader {
  constructor(private readonly db: DrizzleD1Database<Record<string, unknown>>) {}

  async get(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
      ))
      .limit(1);
    const row = rows[0];
    return row ? mapD1ConversationRow(row) : null;
  }

  async getMigrationMessages(
    projectId: string,
    conversationId: string,
  ): Promise<PublicMessageRecord[]> {
    const owner = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
      ))
      .limit(1);
    if (owner.length === 0) return [];
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return rows.map(mapD1MessageRow);
  }
}
