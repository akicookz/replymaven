import { parseMessageImageUrls } from "../../shared/message-images";
import { getLocalUploadKey } from "../../shared/upload-ownership";
import {
  buildClaimExpiredArchivesQuery,
} from "../conversations/d1-public-conversation-store";
import type { PublicConversationStore } from "../conversations/public-conversation-store";

export { buildClaimExpiredArchivesQuery };

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

export type NativeSidechatCleanup = (
  projectId: string,
  conversationId: string,
) => Promise<void>;

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

class PublicConversationRetentionStore implements ConversationRetentionStore {
  constructor(private conversationStore: PublicConversationStore) {}

  async claimExpired(
    retentionCutoff: Date,
    staleClaimCutoff: Date,
    claimAt: Date,
    limit: number,
  ): Promise<ClaimedConversation[]> {
    const rows = await this.conversationStore.claimExpiredArchives(
      retentionCutoff.getTime(),
      staleClaimCutoff.getTime(),
      claimAt.getTime(),
      limit,
    );
    const claimed = rows.map((row) => ({
      ...row,
      purgeStartedAt: new Date(row.purgeStartedAt),
    }));
    for (const conversation of claimed) {
      this.claimed.set(conversation.id, conversation);
    }
    return claimed;
  }

  async listMessageAttachments(
    conversationId: string,
  ): Promise<MessageAttachmentSource[]> {
    // Purging a conversation removes attachments owned by its transcript.
    const conversation = await this.findClaimedConversation(conversationId);
    if (!conversation) return [];
    const rows = await this.conversationStore.listMessageAttachments(
      conversation.projectId,
      conversationId,
    );
    return rows.map((row) => ({
      role: row.author,
      userId: row.userId,
      imageUrl: row.imageUrls.length > 0 ? JSON.stringify(row.imageUrls) : null,
    }));
  }

  async isUploadKeyReferencedElsewhere(
    key: string,
    conversationId: string,
  ): Promise<boolean> {
    // A key referenced by another conversation remains owned and must not be
    // removed from R2.
    return this.conversationStore.isUploadKeyReferencedElsewhere(
      key,
      conversationId,
    );
  }

  async deleteClaimedConversation(
    conversationId: string,
    purgeStartedAt: Date,
  ): Promise<boolean> {
    const conversation = await this.findClaimedConversation(conversationId);
    if (!conversation) return false;
    return this.conversationStore.deleteRetentionClaim(
      conversation.projectId,
      conversationId,
      purgeStartedAt.getTime(),
    );
  }

  private claimed = new Map<string, ClaimedConversation>();

  private async findClaimedConversation(
    conversationId: string,
  ): Promise<ClaimedConversation | null> {
    return this.claimed.get(conversationId) ?? null;
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
  cleanupSidechat: NativeSidechatCleanup,
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
  await cleanupSidechat(claimed.projectId, claimed.id);
  await deleteUploadKeys(uploads, unreferencedKeys);
  return store.deleteClaimedConversation(claimed.id, claimed.purgeStartedAt);
}

export async function purgeClaimedConversations(
  store: ConversationRetentionStore,
  uploads: R2Bucket,
  claimed: ClaimedConversation[],
  cleanupSidechat: NativeSidechatCleanup,
): Promise<ConversationRetentionResult> {
  let deleted = 0;
  let failed = 0;
  for (const conversation of claimed) {
    try {
      if (await purgeOneClaimedConversation(
        store,
        uploads,
        conversation,
        cleanupSidechat,
      )) {
        deleted += 1;
      }
    } catch {
      failed += 1;
      console.error("Archived conversation cleanup failed");
    }
  }
  return { claimed: claimed.length, deleted, failed };
}

export async function purgeExpiredArchivedConversations(
  conversationStore: PublicConversationStore,
  uploads: R2Bucket,
  cleanupSidechat: NativeSidechatCleanup,
  now: Date = new Date(),
  batchSize = DEFAULT_PURGE_BATCH_SIZE,
): Promise<ConversationRetentionResult> {
  const store = new PublicConversationRetentionStore(conversationStore);
  const retentionCutoff = new Date(now.getTime() - ARCHIVE_RETENTION_MS);
  const staleClaimCutoff = new Date(now.getTime() - PURGE_CLAIM_LEASE_MS);
  const claimed = await store.claimExpired(
    retentionCutoff,
    staleClaimCutoff,
    now,
    batchSize,
  );

  return purgeClaimedConversations(
    store,
    uploads,
    claimed,
    cleanupSidechat,
  );
}
