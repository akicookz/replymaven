import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import { toPublicChildName } from "../../shared/maven-conversation";
import { publicTranscriptChecksum } from "../../shared/public-transcript-checksum";
import type { MavenConversationSummary } from "../../shared/sidechat-agent";
import {
  conversationRuntimeMigrations,
  conversations,
  messages,
} from "../db";
import type { AppEnv } from "../types";
import { AgentPublicConversationStore } from "../conversations/agent-public-conversation-store";
import {
  D1PublicConversationStore,
  mapD1ConversationRow,
  mapD1MessageRow,
} from "../conversations/d1-public-conversation-store";

const DEFAULT_BACKFILL_LIMIT = 100;
const MAX_BACKFILL_LIMIT = 100;
const VERIFY_CONCURRENCY = 5;
const COMPATIBILITY_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

interface ProjectAgentMigrationStub {
  reconcileDirectory(
    summaries: MavenConversationSummary[],
  ): Promise<{ applied: number; skipped: number }>;
  listAllPublicConversationSummaries(): Promise<MavenConversationSummary[]>;
  getCompatibilityProjectionStatus(): Promise<{
    enabled: boolean;
    pendingOutboxCount: number;
    lastLegacyRequestAt: number | null;
  }>;
  disableCompatibilityProjection(): Promise<void>;
}

export interface ConversationRuntimeCheckpoint {
  projectId: string;
  directoryCursor: string | null;
  directoryCompleteAt: number | null;
  agentCutoverAt: number | null;
  lastVerifiedAt: number | null;
  mismatchCount: number;
}

export interface LegacyDirectoryEntry {
  conversation: PublicConversationRecord;
  messages: PublicMessageRecord[];
}

export interface ConversationDirectoryBackfillPort {
  loadCheckpoint(projectId: string): Promise<ConversationRuntimeCheckpoint>;
  readBatch(
    projectId: string,
    afterConversationId: string | null,
    limit: number,
  ): Promise<LegacyDirectoryEntry[]>;
  reconcile(
    projectId: string,
    summaries: MavenConversationSummary[],
  ): Promise<{ applied: number; skipped: number }>;
  saveProgress(input: {
    projectId: string;
    directoryCursor: string | null;
    complete: boolean;
    now: number;
  }): Promise<void>;
}

export interface ConversationDirectoryBackfillResult {
  processed: number;
  applied: number;
  skipped: number;
  complete: boolean;
  nextCursor: string | null;
}

export interface ConversationRuntimeParityResult {
  legacyCount: number;
  agentCount: number;
  legacyOnlyCount: number;
  agentOnlyCount: number;
  operationalMismatchCount: number;
  transcriptMismatchCount: number;
  mismatchCount: number;
  verifiedAt: number;
}

interface CompatibilityProjectionDisableGate {
  agentCutoverAt: number | null;
  lastVerifiedAt: number | null;
  mismatchCount: number;
  pendingOutboxCount: number;
  lastLegacyRequestAt: number | null;
}

export function isCompatibilityProjectionDisableEligible(
  gate: CompatibilityProjectionDisableGate,
  now: number,
): boolean {
  if (gate.agentCutoverAt === null) return false;
  const quietPeriodEndsAt = Math.max(
    gate.agentCutoverAt,
    gate.lastLegacyRequestAt ?? 0,
  ) + COMPATIBILITY_ROLLBACK_WINDOW_MS;
  return gate.mismatchCount === 0 &&
    gate.pendingOutboxCount === 0 &&
    gate.lastVerifiedAt !== null &&
    gate.lastVerifiedAt >= quietPeriodEndsAt &&
    now >= quietPeriodEndsAt;
}

export function compareConversationRuntimeIds(
  legacyIds: string[],
  agentIds: string[],
): { legacyOnlyIds: string[]; agentOnlyIds: string[] } {
  const legacy = new Set(legacyIds);
  const agent = new Set(agentIds);
  return {
    legacyOnlyIds: [...legacy].filter((id) => !agent.has(id)).sort(),
    agentOnlyIds: [...agent].filter((id) => !legacy.has(id)).sort(),
  };
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

export async function runConversationDirectoryBackfillBatch(
  port: ConversationDirectoryBackfillPort,
  projectId: string,
  options: { limit?: number; now?: number } = {},
): Promise<ConversationDirectoryBackfillResult> {
  const limit = Math.max(
    1,
    Math.min(MAX_BACKFILL_LIMIT, options.limit ?? DEFAULT_BACKFILL_LIMIT),
  );
  const checkpoint = await port.loadCheckpoint(projectId);
  if (checkpoint.directoryCompleteAt !== null) {
    return {
      processed: 0,
      applied: 0,
      skipped: 0,
      complete: true,
      nextCursor: checkpoint.directoryCursor,
    };
  }
  const entries = await port.readBatch(
    projectId,
    checkpoint.directoryCursor,
    limit,
  );
  const summaries = await Promise.all(entries.map(legacyEntryToSummary));
  const reconciled = summaries.length > 0
    ? await port.reconcile(projectId, summaries)
    : { applied: 0, skipped: 0 };
  const complete = entries.length < limit;
  const nextCursor = entries.at(-1)?.conversation.id ??
    checkpoint.directoryCursor;
  await port.saveProgress({
    projectId,
    directoryCursor: nextCursor,
    complete,
    now: options.now ?? Date.now(),
  });
  return {
    processed: entries.length,
    applied: reconciled.applied,
    skipped: reconciled.skipped,
    complete,
    nextCursor,
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
  private readonly legacyStore: D1PublicConversationStore;
  private readonly agentStore: AgentPublicConversationStore;

  constructor(
    private readonly db: DrizzleD1Database<Record<string, unknown>>,
    private readonly env: AppEnv,
  ) {
    this.legacyStore = new D1PublicConversationStore(db);
    this.agentStore = new AgentPublicConversationStore({
      db,
      env,
      legacy: this.legacyStore,
    });
  }

  async backfillProject(
    projectId: string,
    limit = DEFAULT_BACKFILL_LIMIT,
  ): Promise<ConversationDirectoryBackfillResult> {
    return runConversationDirectoryBackfillBatch(
      {
        loadCheckpoint: (id) => this.getOrCreateCheckpoint(id),
        readBatch: (id, cursor, pageLimit) =>
          this.readLegacyBatch(id, cursor, pageLimit),
        reconcile: async (id, summaries) => {
          const parent = await this.getProjectAgent(id);
          return parent.reconcileDirectory(summaries);
        },
        saveProgress: (input) => this.saveBackfillProgress(input),
      },
      projectId,
      { limit },
    );
  }

  async verifyProject(projectId: string): Promise<ConversationRuntimeParityResult> {
    const checkpoint = await this.getOrCreateCheckpoint(projectId);
    const legacyEntries = await this.readAllLegacy(projectId);
    const parent = await this.getProjectAgent(projectId);
    const agentSummaries = await parent.listAllPublicConversationSummaries();
    const agentIds = new Set(agentSummaries.map((summary) =>
      summary.conversationId
    ));
    const idComparison = compareConversationRuntimeIds(
      legacyEntries.map((entry) => entry.conversation.id),
      agentSummaries.map((summary) => summary.conversationId),
    );
    const sharedEntries = legacyEntries.filter((entry) =>
      agentIds.has(entry.conversation.id)
    );
    const comparisons = await mapWithConcurrency(
      sharedEntries,
      VERIFY_CONCURRENCY,
      async (entry) => {
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
    const legacyOnlyCount = idComparison.legacyOnlyIds.length;
    const agentOnlyCount = idComparison.agentOnlyIds.length;
    const operationalMismatchCount = comparisons.reduce(
      (total, result) => total + result.operational,
      0,
    );
    const transcriptMismatchCount = comparisons.reduce(
      (total, result) => total + result.transcript,
      0,
    );
    const verifiedAt = Date.now();
    const mismatchCount = legacyOnlyCount + agentOnlyCount +
      operationalMismatchCount + transcriptMismatchCount;
    await this.ensureCheckpoint(projectId);
    const agentCutoverAt =
      this.env.PUBLIC_CONVERSATION_STORE === "agent" &&
        checkpoint.directoryCompleteAt !== null &&
        mismatchCount === 0 &&
        checkpoint.agentCutoverAt === null
        ? new Date(verifiedAt)
        : undefined;
    await this.db.update(conversationRuntimeMigrations).set({
      lastVerifiedAt: new Date(verifiedAt),
      mismatchCount,
      ...(agentCutoverAt ? { agentCutoverAt } : {}),
      updatedAt: new Date(verifiedAt),
    }).where(eq(conversationRuntimeMigrations.projectId, projectId));
    return {
      legacyCount: legacyEntries.length,
      agentCount: agentSummaries.length,
      legacyOnlyCount,
      agentOnlyCount,
      operationalMismatchCount,
      transcriptMismatchCount,
      mismatchCount,
      verifiedAt,
    };
  }

  async getStatus(projectId: string): Promise<ConversationRuntimeCheckpoint & {
    cutoverEligible: boolean;
    compatibilityProjection: {
      enabled: boolean;
      pendingOutboxCount: number;
      lastLegacyRequestAt: number | null;
      disableEligibleAt: number | null;
    };
  }> {
    const parent = await this.getProjectAgent(projectId);
    const projection = await parent.getCompatibilityProjectionStatus();
    const checkpoint = await this.getOrCreateCheckpoint(projectId);
    return {
      ...checkpoint,
      cutoverEligible:
        checkpoint.directoryCompleteAt !== null &&
        checkpoint.lastVerifiedAt !== null &&
        checkpoint.mismatchCount === 0,
      compatibilityProjection: {
        ...projection,
        disableEligibleAt: checkpoint.agentCutoverAt === null
          ? null
          : Math.max(
              checkpoint.agentCutoverAt,
              projection.lastLegacyRequestAt ?? 0,
            ) + COMPATIBILITY_ROLLBACK_WINDOW_MS,
      },
    };
  }

  async disableCompatibilityProjection(projectId: string): Promise<{
    disabled: true;
  }> {
    const status = await this.getStatus(projectId);
    if (!isCompatibilityProjectionDisableEligible({
      agentCutoverAt: status.agentCutoverAt,
      lastVerifiedAt: status.lastVerifiedAt,
      mismatchCount: status.mismatchCount,
      pendingOutboxCount:
        status.compatibilityProjection.pendingOutboxCount,
      lastLegacyRequestAt:
        status.compatibilityProjection.lastLegacyRequestAt,
    }, Date.now())) {
      throw new Error("Compatibility projection disablement is not eligible");
    }
    const parent = await this.getProjectAgent(projectId);
    await parent.disableCompatibilityProjection();
    return { disabled: true };
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

  private async ensureCheckpoint(projectId: string): Promise<void> {
    await this.db.insert(conversationRuntimeMigrations).values({
      projectId,
    }).onConflictDoNothing();
  }

  private async getOrCreateCheckpoint(
    projectId: string,
  ): Promise<ConversationRuntimeCheckpoint> {
    await this.ensureCheckpoint(projectId);
    const rows = await this.db.select().from(conversationRuntimeMigrations)
      .where(eq(conversationRuntimeMigrations.projectId, projectId)).limit(1);
    const row = rows[0];
    if (!row) throw new Error("Conversation runtime checkpoint unavailable");
    return {
      projectId: row.projectId,
      directoryCursor: row.directoryCursor,
      directoryCompleteAt: row.directoryCompleteAt?.getTime() ?? null,
      agentCutoverAt: row.agentCutoverAt?.getTime() ?? null,
      lastVerifiedAt: row.lastVerifiedAt?.getTime() ?? null,
      mismatchCount: row.mismatchCount,
    };
  }

  private async saveBackfillProgress(input: {
    projectId: string;
    directoryCursor: string | null;
    complete: boolean;
    now: number;
  }): Promise<void> {
    await this.db.update(conversationRuntimeMigrations).set({
      directoryCursor: input.directoryCursor,
      ...(input.complete ? { directoryCompleteAt: new Date(input.now) } : {}),
      updatedAt: new Date(input.now),
    }).where(eq(conversationRuntimeMigrations.projectId, input.projectId));
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
    const ids = rows.map((row) => row.id);
    const messageRows = await this.db.select().from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(asc(messages.createdAt), asc(messages.id));
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

  private async readAllLegacy(
    projectId: string,
  ): Promise<LegacyDirectoryEntry[]> {
    const entries: LegacyDirectoryEntry[] = [];
    let cursor: string | null = null;
    do {
      const batch = await this.readLegacyBatch(
        projectId,
        cursor,
        DEFAULT_BACKFILL_LIMIT,
      );
      entries.push(...batch);
      cursor = batch.at(-1)?.conversation.id ?? null;
      if (batch.length < DEFAULT_BACKFILL_LIMIT) break;
    } while (cursor);
    return entries;
  }
}
