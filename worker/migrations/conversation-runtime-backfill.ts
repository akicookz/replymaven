import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import { toPublicChildName } from "../../shared/maven-conversation";
import { publicTranscriptChecksum } from "../../shared/public-transcript-checksum";
import type { MavenConversationSummary } from "../../shared/sidechat-agent";
import { conversations, messages } from "../db";
import type { AppEnv } from "../types";
import { AgentPublicConversationStore } from "../conversations/agent-public-conversation-store";
import {
  mapD1ConversationRow,
  mapD1MessageRow,
} from "../conversations/legacy-conversation-reader";

const DEFAULT_BACKFILL_LIMIT = 100;
const MAX_BACKFILL_LIMIT = 100;
const VERIFY_CONCURRENCY = 5;
// Verify fans out per conversation (child import, state read, transcript
// read), so large batches exhaust the per-request subrequest budget.
const DEFAULT_VERIFY_LIMIT = 10;
const MAX_VERIFY_BATCH_LIMIT = 25;

interface ProjectAgentMigrationStub {
  reconcileDirectory(
    summaries: MavenConversationSummary[],
  ): Promise<{ applied: number; skipped: number }>;
  listAllPublicConversationSummaries(): Promise<MavenConversationSummary[]>;
  listMigrationConversationSummaries(input: {
    afterConversationId: string | null;
    limit: number;
  }): Promise<MavenConversationSummary[]>;
}

export interface LegacyDirectoryEntry {
  conversation: PublicConversationRecord;
  messages: PublicMessageRecord[];
}

export interface ConversationDirectoryBackfillPort {
  readBatch(
    projectId: string,
    afterConversationId: string | null,
    limit: number,
  ): Promise<LegacyDirectoryEntry[]>;
  reconcile(
    projectId: string,
    summaries: MavenConversationSummary[],
  ): Promise<{ applied: number; skipped: number }>;
}

export interface ConversationDirectoryBackfillResult {
  processed: number;
  applied: number;
  skipped: number;
  complete: boolean;
  nextCursor: string | null;
}

export interface ConversationRuntimeParityResult {
  processed: number;
  complete: boolean;
  nextCursor: string | null;
  legacyCount: number;
  agentCount: number;
  legacyOnlyCount: number;
  agentOnlyCount: number;
  operationalMismatchCount: number;
  transcriptMismatchCount: number;
  mismatchCount: number;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}

export function legacyDirectoryRevision(updatedAt: number): number {
  const bounded = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, updatedAt));
  return Math.min(-1, Number.MIN_SAFE_INTEGER + Math.floor(bounded));
}

async function entrySummaryChecksum(
  conversation: PublicConversationRecord,
  messages: PublicMessageRecord[],
): Promise<string> {
  const value = JSON.stringify({
    conversation: operationalSnapshot(conversation),
    messageCount: messages.length,
    botMessageCount: messages.filter((message) => message.author === "bot").length,
    lastMessage: messages.at(-1) ?? null,
  });
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function legacyEntryToSummary(
  entry: LegacyDirectoryEntry,
): Promise<MavenConversationSummary> {
  const conversation = entry.conversation;
  const orderedMessages = [...entry.messages].sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  );
  const lastMessage = orderedMessages.at(-1) ?? null;
  return {
    conversationId: conversation.id,
    publicChildName: toPublicChildName(conversation.id),
    sidechatChildName: null,
    sidechatStatus: null,
    customerId: conversation.customerId,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    visitorEmail: conversation.visitorEmail,
    telegramThreadId: conversation.telegramThreadId,
    status: conversation.status,
    closeReason: conversation.closeReason,
    metadata: parseMetadata(conversation.metadata),
    priority: conversation.priority,
    assigneeId: conversation.assigneeId,
    snoozedUntil: conversation.snoozedUntil,
    archivedAt: conversation.archivedAt,
    purgeStartedAt: conversation.purgeStartedAt,
    retentionScheduleId: null,
    visitorLastSeenAt: conversation.visitorLastSeenAt,
    visitorPresence: conversation.visitorPresence,
    visitorLastOnlineAt: conversation.visitorLastOnlineAt,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageAuthor: lastMessage?.author ?? null,
    lastMessagePreview: lastMessage?.content ?? null,
    lastMessageSenderName: lastMessage?.senderName ?? null,
    lastMessageEmailedAt: lastMessage?.emailedAt ?? null,
    lastMessageCreatedAt: lastMessage?.createdAt ?? null,
    lastActivityAt: conversation.lastActivityAt,
    messageCount: orderedMessages.length,
    botMessageCount: orderedMessages.filter((message) =>
      message.author === "bot"
    ).length,
    childRevision: legacyDirectoryRevision(conversation.updatedAt),
    sourceChecksum: await entrySummaryChecksum(conversation, orderedMessages),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// Stateless by design: the cursor rides the request/response loop instead of
// a checkpoint table, and reruns are idempotent because the parent directory
// upserts summaries by revision.
export async function runConversationDirectoryBackfillBatch(
  port: ConversationDirectoryBackfillPort,
  projectId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<ConversationDirectoryBackfillResult> {
  const limit = Math.max(
    1,
    Math.min(MAX_BACKFILL_LIMIT, options.limit ?? DEFAULT_BACKFILL_LIMIT),
  );
  const cursor = options.cursor ?? null;
  const entries = await port.readBatch(projectId, cursor, limit);
  const summaries = await Promise.all(entries.map(legacyEntryToSummary));
  const reconciled = summaries.length > 0
    ? await port.reconcile(projectId, summaries)
    : { applied: 0, skipped: 0 };
  const complete = entries.length < limit;
  return {
    processed: entries.length,
    applied: reconciled.applied,
    skipped: reconciled.skipped,
    complete,
    nextCursor: entries.at(-1)?.conversation.id ?? cursor,
  };
}

function operationalSnapshot(
  conversation: PublicConversationRecord,
): Record<string, unknown> {
  function seconds(value: number | null): number | null {
    return value === null ? null : Math.floor(value / 1_000);
  }
  return {
    customerId: conversation.customerId,
    visitorId: conversation.visitorId,
    visitorName: conversation.visitorName,
    visitorEmail: conversation.visitorEmail,
    status: conversation.status,
    closeReason: conversation.closeReason,
    telegramThreadId: conversation.telegramThreadId,
    metadata: conversation.metadata,
    chatState: conversation.chatState,
    lastActivityAt: seconds(conversation.lastActivityAt),
    visitorLastSeenAt: seconds(conversation.visitorLastSeenAt),
    visitorPresence: conversation.visitorPresence,
    visitorLastOnlineAt: seconds(conversation.visitorLastOnlineAt),
    snoozedUntil: seconds(conversation.snoozedUntil),
    archivedAt: seconds(conversation.archivedAt),
    purgeStartedAt: seconds(conversation.purgeStartedAt),
    priority: conversation.priority,
    assigneeId: conversation.assigneeId,
    createdAt: seconds(conversation.createdAt),
    updatedAt: seconds(conversation.updatedAt),
    ownershipRevision: conversation.ownershipRevision,
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let index = 0;
  async function runWorker(): Promise<void> {
    while (index < values.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(values[current]!);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    runWorker,
  ));
  return results;
}

export class ConversationRuntimeMigrationService {
  private readonly agentStore: AgentPublicConversationStore;

  constructor(
    private readonly db: DrizzleD1Database<Record<string, unknown>>,
    private readonly env: AppEnv,
  ) {
    this.agentStore = new AgentPublicConversationStore({ db, env });
  }

  async backfillProject(
    projectId: string,
    options: { cursor?: string | null; limit?: number } = {},
  ): Promise<ConversationDirectoryBackfillResult> {
    return runConversationDirectoryBackfillBatch(
      {
        readBatch: (id, cursor, pageLimit) =>
          this.readLegacyBatch(id, cursor, pageLimit),
        reconcile: async (id, summaries) => {
          const parent = await this.getProjectAgent(id);
          return parent.reconcileDirectory(summaries);
        },
      },
      projectId,
      options,
    );
  }

  async verifyProject(
    projectId: string,
    options: { cursor?: string | null; limit?: number } = {},
  ): Promise<ConversationRuntimeParityResult> {
    const boundedLimit = Math.max(
      1,
      Math.min(MAX_VERIFY_BATCH_LIMIT, options.limit ?? DEFAULT_VERIFY_LIMIT),
    );
    const cursor = options.cursor ?? null;
    const parent = await this.getProjectAgent(projectId);
    const [legacyEntries, agentSummaries] = await Promise.all([
      this.readLegacyBatch(projectId, cursor, boundedLimit + 1),
      parent.listMigrationConversationSummaries({
        afterConversationId: cursor,
        limit: boundedLimit + 1,
      }),
    ]);
    const unionIds = [...new Set([
      ...legacyEntries.map((entry) => entry.conversation.id),
      ...agentSummaries.map((summary) => summary.conversationId),
    ])].sort();
    const selectedIds = unionIds.slice(0, boundedLimit);
    const selected = new Set(selectedIds);
    const complete = unionIds.length <= boundedLimit;
    const selectedLegacyEntries = legacyEntries.filter((entry) =>
      selected.has(entry.conversation.id)
    );
    const legacyById = new Map(selectedLegacyEntries.map((entry) =>
      [entry.conversation.id, entry] as const
    ));
    const agentById = new Map(agentSummaries
      .filter((summary) => selected.has(summary.conversationId))
      .map((summary) => [summary.conversationId, summary] as const));
    const sharedEntries = selectedLegacyEntries.filter((entry) =>
      agentById.has(entry.conversation.id)
    );
    const comparisons = await mapWithConcurrency(
      sharedEntries,
      VERIFY_CONCURRENCY,
      async (entry) => {
        await this.agentStore.ensurePublicConversation(entry.conversation);
        const agentConversation = await this.agentStore.get(
          projectId,
          entry.conversation.id,
        );
        const agentMessages = await this.agentStore.getMessages(
          projectId,
          entry.conversation.id,
        );
        if (!agentConversation) {
          return { operational: 1, transcript: 1 };
        }
        const legacyLatest = entry.messages.at(-1)?.id ?? null;
        const agentLatest = agentMessages.at(-1)?.id ?? null;
        const [legacyChecksum, agentChecksum] = await Promise.all([
          publicTranscriptChecksum(entry.messages),
          publicTranscriptChecksum(agentMessages),
        ]);
        return {
          operational: equalJson(
              operationalSnapshot(entry.conversation),
              operationalSnapshot(agentConversation),
            )
            ? 0
            : 1,
          transcript:
            entry.messages.length === agentMessages.length &&
              legacyLatest === agentLatest &&
              legacyChecksum === agentChecksum
              ? 0
              : 1,
        };
      },
    );
    const legacyCount = selectedIds.filter((id) => legacyById.has(id)).length;
    const agentCount = selectedIds.filter((id) => agentById.has(id)).length;
    const legacyOnlyCount = selectedIds.filter((id) =>
      legacyById.has(id) && !agentById.has(id)
    ).length;
    const agentOnlyCount = selectedIds.filter((id) =>
      agentById.has(id) && !legacyById.has(id)
    ).length;
    const operationalMismatchCount = comparisons.reduce(
      (total, result) => total + result.operational,
      0,
    );
    const transcriptMismatchCount = comparisons.reduce(
      (total, result) => total + result.transcript,
      0,
    );
    return {
      processed: selectedIds.length,
      complete,
      nextCursor: complete ? null : selectedIds.at(-1) ?? cursor,
      legacyCount,
      agentCount,
      legacyOnlyCount,
      agentOnlyCount,
      operationalMismatchCount,
      transcriptMismatchCount,
      mismatchCount: legacyOnlyCount + agentOnlyCount +
        operationalMismatchCount + transcriptMismatchCount,
    };
  }

  private async getProjectAgent(
    projectId: string,
  ): Promise<ProjectAgentMigrationStub> {
    const { getAgentByName } = await import("agents");
    return await getAgentByName(
      this.env.MAVEN_PROJECT_AGENT,
      projectId,
    ) as unknown as ProjectAgentMigrationStub;
  }

  private async readLegacyBatch(
    projectId: string,
    afterConversationId: string | null,
    limit: number,
  ): Promise<LegacyDirectoryEntry[]> {
    const rows = await this.db.select().from(conversations)
      .where(and(
        eq(conversations.projectId, projectId),
        ...(afterConversationId
          ? [gt(conversations.id, afterConversationId)]
          : []),
      ))
      .orderBy(asc(conversations.id))
      .limit(limit);
    if (rows.length === 0) return [];
    // D1 caps bound parameters at 100 per query; chunk the id list so the
    // batch size can never push the IN() clause over it.
    const ids = rows.map((row) => row.id);
    const messageRows = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      messageRows.push(...await this.db.select().from(messages)
        .where(inArray(messages.conversationId, ids.slice(offset, offset + 50)))
        .orderBy(asc(messages.createdAt), asc(messages.id)));
    }
    const byConversation = new Map<string, PublicMessageRecord[]>();
    for (const row of messageRows) {
      const mapped = mapD1MessageRow(row);
      const existing = byConversation.get(row.conversationId) ?? [];
      existing.push(mapped);
      byConversation.set(row.conversationId, existing);
    }
    return rows.map((row) => ({
      conversation: mapD1ConversationRow(row),
      messages: byConversation.get(row.id) ?? [],
    }));
  }
}
