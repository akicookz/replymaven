import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { parseMessageImageUrls } from "../../shared/message-images";
import { getLocalUploadKey } from "../../shared/upload-ownership";
import {
  conversations,
  messages,
  toolExecutions,
} from "../db/schema";

export const ARCHIVE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const PURGE_CLAIM_LEASE_MS = 60 * 60 * 1000;
const DEFAULT_PURGE_BATCH_SIZE = 50;
const R2_DELETE_BATCH_SIZE = 1000;

export interface ClaimedConversation {
  id: string;
  projectId: string;
  purgeStartedAt: Date;
}

export interface MessageAttachmentSource {
  channel: "public" | "sidechat";
  role: "visitor" | "bot" | "agent" | "system";
  userId: string | null;
  imageUrl: string | null;
}

export interface ConversationRetentionStore {
  claimExpired(
    retentionCutoff: Date,
    staleClaimCutoff: Date,
    claimAt: Date,
    limit: number,
  ): Promise<ClaimedConversation[]>;
  listMessageAttachments(
    conversationId: string,
  ): Promise<MessageAttachmentSource[]>;
  isUploadKeyReferencedElsewhere(
    key: string,
    conversationId: string,
  ): Promise<boolean>;
  deleteClaimedConversation(
    conversationId: string,
    purgeStartedAt: Date,
  ): Promise<boolean>;
}

export interface ConversationRetentionResult {
  claimed: number;
  deleted: number;
  failed: number;
}

export function buildClaimExpiredArchivesQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  conversationIds: string[],
  retentionCutoff: Date,
  staleClaimCutoff: Date,
  claimAt: Date,
) {
  return db
    .update(conversations)
    .set({ purgeStartedAt: claimAt })
    .where(and(
      inArray(conversations.id, conversationIds),
      lte(conversations.archivedAt, retentionCutoff),
      or(
        isNull(conversations.purgeStartedAt),
        lte(conversations.purgeStartedAt, staleClaimCutoff),
      ),
    ))
    .returning({
      id: conversations.id,
      projectId: conversations.projectId,
      purgeStartedAt: conversations.purgeStartedAt,
    });
}

export function collectOwnedUploadKeys(
  projectId: string,
  conversationId: string,
  attachmentSources: MessageAttachmentSource[],
): string[] {
  const keys = new Set<string>();
  for (const source of attachmentSources) {
    const conversationPrefix =
      `${projectId}/conversation-attachments/${conversationId}/`;

    for (const imageUrl of parseMessageImageUrls(source.imageUrl)) {
      const key = getLocalUploadKey(imageUrl);
      // Legacy widget and dashboard uploads were not conversation-scoped.
      // Their ownership cannot be proven during retention, so leave them in
      // R2 rather than risk deleting an object reused by another entity.
      if (!key?.startsWith(conversationPrefix)) continue;
      keys.add(key);
    }
  }
  return [...keys];
}

class D1ConversationRetentionStore implements ConversationRetentionStore {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
  ) {}

  async claimExpired(
    retentionCutoff: Date,
    staleClaimCutoff: Date,
    claimAt: Date,
    limit: number,
  ): Promise<ClaimedConversation[]> {
    const candidates = await this.db
      .select({
        id: conversations.id,
        projectId: conversations.projectId,
      })
      .from(conversations)
      .where(and(
        lte(conversations.archivedAt, retentionCutoff),
        or(
          isNull(conversations.purgeStartedAt),
          lte(conversations.purgeStartedAt, staleClaimCutoff),
        ),
      ))
      .orderBy(asc(conversations.archivedAt))
      .limit(limit);

    if (candidates.length === 0) return [];

    const rows = await buildClaimExpiredArchivesQuery(
      this.db,
      candidates.map((candidate) => candidate.id),
      retentionCutoff,
      staleClaimCutoff,
      claimAt,
    );

    return rows.flatMap((row) => row.purgeStartedAt
      ? [{
          id: row.id,
          projectId: row.projectId,
          purgeStartedAt: row.purgeStartedAt,
        }]
      : []
    );
  }

  async listMessageAttachments(
    conversationId: string,
  ): Promise<MessageAttachmentSource[]> {
    // Intentionally all-channel: purging a conversation must remove attachments
    // owned by both its public transcript and its private sidechat transcript.
    const rows = await this.db
      .select({
        channel: messages.channel,
        role: messages.role,
        userId: messages.userId,
        imageUrl: messages.imageUrl,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    return rows;
  }

  async isUploadKeyReferencedElsewhere(
    key: string,
    conversationId: string,
  ): Promise<boolean> {
    // Intentionally all-channel: a key referenced by either transcript of any
    // other conversation remains owned and must not be removed from R2.
    const rows = await this.db
      .select({ imageUrl: messages.imageUrl })
      .from(messages)
      .where(and(
        ne(messages.conversationId, conversationId),
        sql`instr(${messages.imageUrl}, ${key}) > 0`,
      ));

    return rows.some((row) =>
      parseMessageImageUrls(row.imageUrl).some(
        (imageUrl) => getLocalUploadKey(imageUrl) === key,
      )
    );
  }

  async deleteClaimedConversation(
    conversationId: string,
    purgeStartedAt: Date,
  ): Promise<boolean> {
    await this.db
      .delete(toolExecutions)
      .where(eq(toolExecutions.conversationId, conversationId));

    const rows = await this.db
      .delete(conversations)
      .where(and(
        eq(conversations.id, conversationId),
        eq(conversations.purgeStartedAt, purgeStartedAt),
      ))
      .returning({ id: conversations.id });
    return rows.length === 1;
  }
}

async function deleteUploadKeys(
  uploads: R2Bucket,
  keys: string[],
): Promise<void> {
  for (let index = 0; index < keys.length; index += R2_DELETE_BATCH_SIZE) {
    await uploads.delete(keys.slice(index, index + R2_DELETE_BATCH_SIZE));
  }
}

export async function purgeOneClaimedConversation(
  store: ConversationRetentionStore,
  uploads: R2Bucket,
  claimed: ClaimedConversation,
): Promise<boolean> {
  const attachmentSources = await store.listMessageAttachments(claimed.id);
  const ownedKeys = collectOwnedUploadKeys(
    claimed.projectId,
    claimed.id,
    attachmentSources,
  );
  const unreferencedKeys: string[] = [];
  for (const key of ownedKeys) {
    if (!await store.isUploadKeyReferencedElsewhere(key, claimed.id)) {
      unreferencedKeys.push(key);
    }
  }
  await deleteUploadKeys(uploads, unreferencedKeys);
  return store.deleteClaimedConversation(claimed.id, claimed.purgeStartedAt);
}

export async function purgeExpiredArchivedConversations(
  db: DrizzleD1Database<Record<string, unknown>>,
  uploads: R2Bucket,
  now: Date = new Date(),
  batchSize = DEFAULT_PURGE_BATCH_SIZE,
): Promise<ConversationRetentionResult> {
  const store = new D1ConversationRetentionStore(db);
  const retentionCutoff = new Date(now.getTime() - ARCHIVE_RETENTION_MS);
  const staleClaimCutoff = new Date(now.getTime() - PURGE_CLAIM_LEASE_MS);
  const claimed = await store.claimExpired(
    retentionCutoff,
    staleClaimCutoff,
    now,
    batchSize,
  );

  let deleted = 0;
  let failed = 0;
  for (const conversation of claimed) {
    try {
      if (await purgeOneClaimedConversation(store, uploads, conversation)) {
        deleted += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `Failed to purge archived conversation ${conversation.id}:`,
        error,
      );
    }
  }

  return { claimed: claimed.length, deleted, failed };
}
