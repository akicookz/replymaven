import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { schema } from "../db";
import {
  buildAiResolutionQuery,
  buildActiveConversationByVisitorQuery,
  buildBanSweepQuery,
  buildConditionalBotMessageQuery,
  buildConditionalAgentMessageQuery,
  buildConditionalSystemMessageQuery,
  buildConditionalVisitorMessageQuery,
  buildHumanTakeoverQuery,
  buildNewTeamRequestClaimQuery,
  buildInboxCountsQuery,
  buildBulkConversationActionQuery,
  buildConversationByIdQuery,
  buildExternalActionLeaseQuery,
  buildNeedsReviewQuery,
  buildOperationalConversationQuery,
  ChatService,
  type ConversationRow,
} from "./chat-service";

function makeConversation(overrides: Partial<ConversationRow>): ConversationRow {
  const now = new Date();
  return {
    id: "conv-1", projectId: "project-1", visitorId: "visitor-1",
    customerId: null,
    visitorName: null, visitorEmail: null, status: "active", closeReason: null,
    telegramThreadId: null, metadata: null, chatState: null, lastActivityAt: now,
    visitorLastSeenAt: null, visitorPresence: "active", visitorLastOnlineAt: null,
    snoozedUntil: null, priority: "medium", assigneeId: null,
    archivedAt: null, purgeStartedAt: null, externalActionStartedAt: null,
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function makeUpdatingDb(): DrizzleD1Database<Record<string, unknown>> {
  const db = { update: () => ({ set: () => ({ where: async () => undefined }) }) };
  return db as unknown as DrizzleD1Database<Record<string, unknown>>;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class BarrierChatService extends ChatService {
  constructor(
    db: DrizzleD1Database<Record<string, unknown>>,
    private readonly afterTeamRequestRead?: () => Promise<void>,
    private readonly beforeMetadataPatch?: () => Promise<void>,
    private readonly beforeTelegramThreadPersistence?: () => Promise<void>,
  ) {
    super(db);
  }

  protected override async afterNewTeamRequestAuthoritativeRead(): Promise<void> {
    await this.afterTeamRequestRead?.();
  }

  protected override async beforeConversationMetadataPatch(): Promise<void> {
    await this.beforeMetadataPatch?.();
  }

  protected override async beforeNewTeamRequestTelegramThreadPersistence(): Promise<void> {
    await this.beforeTelegramThreadPersistence?.();
  }
}

function createConversationContinuityService(): {
  service: ChatService;
  sqlite: Database;
  db: DrizzleD1Database<Record<string, unknown>>;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE customers (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE customer_visitors (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_id text NOT NULL,
    visitor_id text NOT NULL,
    linked_by text NOT NULL,
    created_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  sqlite.exec(`CREATE TABLE conversations (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_id text,
    visitor_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    status text DEFAULT 'active' NOT NULL,
    close_reason text,
    telegram_thread_id text,
    metadata text,
    chat_state text,
    last_activity_at integer DEFAULT (unixepoch()) NOT NULL,
    visitor_last_seen_at integer,
    visitor_presence text DEFAULT 'active',
    visitor_last_online_at integer,
    snoozed_until integer,
    archived_at integer,
    purge_started_at integer,
    external_action_started_at integer,
    priority text DEFAULT 'medium' NOT NULL,
    assignee_id text,
    created_at integer DEFAULT (unixepoch()) NOT NULL,
    updated_at integer DEFAULT (unixepoch()) NOT NULL
  )`);
  const sqliteDb = drizzleSqlite(sqlite, { schema });
  const db = sqliteDb as unknown as DrizzleD1Database<Record<string, unknown>>;
  return {
    service: new ChatService(db),
    sqlite,
    db,
  };
}

async function createAttemptedTeamRequest(
  service: ChatService,
): Promise<{ conversation: ConversationRow; acceptanceToken: string }> {
  const created = await service.createConversation({
    projectId: "project-1",
    customerId: null,
    visitorId: "visitor-1",
    visitorName: "Alice",
    visitorEmail: "alice@example.com",
    metadata: null,
  });
  const claim = await service.claimNewTeamRequest(
    created.id,
    created.projectId,
    "Visitor needs help.",
  );
  if (claim.status !== "claimed") {
    throw new Error(`Expected a claimed team request, received ${claim.status}`);
  }
  const conversation = await service.getOperationalConversationById(
    created.id,
    created.projectId,
  );
  if (!conversation) throw new Error("Expected an operational conversation");
  const acceptanceToken = JSON.parse(conversation.metadata ?? "{}")
    .mavenTeamRequestAcceptanceToken as unknown;
  if (typeof acceptanceToken !== "string") {
    throw new Error("Expected a Maven acceptance token");
  }
  const attempted = await service.claimNewTeamRequestNotification(
    conversation.id,
    conversation.projectId,
    acceptanceToken,
  );
  if (!attempted) throw new Error("Expected a notification attempt claim");
  return { conversation, acceptanceToken };
}

function createTelegramPersistenceBarrier(
  db: DrizzleD1Database<Record<string, unknown>>,
) {
  const ready = createDeferred();
  const release = createDeferred();
  const service = new BarrierChatService(
    db,
    undefined,
    undefined,
    async () => {
      ready.resolve();
      await release.promise;
    },
  );
  return { ready, release, service };
}

function makeOwnershipDb(row: ConversationRow): {
  db: DrizzleD1Database<Record<string, unknown>>;
  getUpdateCount: () => number;
} {
  let updateCount = 0;
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => {
        updateCount += 1;
        return { set: () => ({ where: () => ({ returning: async () => [{ status: "agent_replied" }] }) }) };
      },
    } as unknown as DrizzleD1Database<Record<string, unknown>>,
    getUpdateCount: () => updateCount,
  };
}

function makeReopenDb(row: ConversationRow): {
  db: DrizzleD1Database<Record<string, unknown>>;
  getStatusWrite: () => unknown;
} {
  let statusWrite: unknown;
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({ set: (values: { status?: unknown }) => {
        statusWrite = values.status;
        return { where: async () => undefined };
      } }),
    } as unknown as DrizzleD1Database<Record<string, unknown>>,
    getStatusWrite: () => statusWrite,
  };
}

describe("ChatService ownership and atomic writes", () => {
  test("merges ordinary metadata patches against the live conversation", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: JSON.stringify({ source: "widget", country: "US" }),
    });

    const updated = await service.updateConversation(
      conversation.id,
      conversation.projectId,
      { metadata: JSON.stringify({ country: "CA", campaign: "spring" }) },
    );
    const metadata = JSON.parse(updated?.metadata ?? "{}");

    expect(metadata).toMatchObject({
      source: "widget",
      country: "CA",
      campaign: "spring",
    });
  });

  test("reads archived conversation detail without making it operational", () => {
    const readable = buildConversationByIdQuery(
      drizzle({} as never),
      "conv-1",
      "project-1",
    ).toSQL();
    const operational = buildOperationalConversationQuery(
      drizzle({} as never),
      "conv-1",
      "project-1",
    ).toSQL();

    expect(readable.sql).toContain('"conversations"."project_id" = ?');
    expect(readable.sql).not.toContain('"conversations"."archived_at" is null');
    expect(operational.sql).toContain('"conversations"."archived_at" is null');
  });

  test("acquires an external-action lease only for an operational conversation", () => {
    const leaseAt = new Date("2026-08-01T10:00:00.000Z");
    const staleBefore = new Date("2026-08-01T09:58:00.000Z");
    const { sql, params } = buildExternalActionLeaseQuery(
      drizzle({} as never),
      "conv-1",
      "project-1",
      leaseAt,
      staleBefore,
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(sql).toContain('"conversations"."external_action_started_at" is null');
    expect(sql).toContain('"conversations"."external_action_started_at" <= ?');
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(expect.arrayContaining([
      "conv-1",
      "project-1",
      Math.floor(leaseAt.getTime() / 1000),
      Math.floor(staleBefore.getTime() / 1000),
    ]));
  });

  test("does not run an external action when its conversation cannot be leased", async () => {
    let actionCalled = false;
    const db = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    } as unknown as DrizzleD1Database<Record<string, unknown>>;

    const result = await new ChatService(db).runExternalActionIfOperational(
      "conv-1",
      "project-1",
      async () => {
        actionCalled = true;
        return "sent";
      },
      new Date("2026-08-01T10:00:00.000Z"),
    );

    expect(result).toEqual({ executed: false });
    expect(actionCalled).toBe(false);
  });

  test("releases the external-action lease after the action finishes", async () => {
    const events: string[] = [];
    let updateCall = 0;
    const db = {
      update: () => {
        updateCall += 1;
        const currentCall = updateCall;
        return {
          set: () => ({
            where: () => currentCall === 1
              ? { returning: async () => [{ id: "conv-1" }] }
              : Promise.resolve(events.push("released")),
          }),
        };
      },
    } as unknown as DrizzleD1Database<Record<string, unknown>>;

    const result = await new ChatService(db).runExternalActionIfOperational(
      "conv-1",
      "project-1",
      async () => {
        events.push("action");
        return "sent";
      },
      new Date("2026-08-01T10:00:00.000Z"),
    );

    expect(result).toEqual({ executed: true, value: "sent" });
    expect(events).toEqual(["action", "released"]);
  });

  test("only skips the waiting_agent row in a mixed batch", async () => {
    const service = new ChatService(makeUpdatingDb());
    const stale = new Date(Date.now() - 60 * 60 * 1000);

    const closed = await service.checkAndCloseStaleForProject([
      makeConversation({ id: "waiting", status: "waiting_agent", lastActivityAt: stale }),
      makeConversation({ id: "active", status: "active", lastActivityAt: stale }),
      makeConversation({ id: "fresh", lastActivityAt: new Date() }),
    ], 5);

    expect(closed).toEqual(["active"]);
  });

  test("a delayed team request cannot reopen a closed human-owned conversation", async () => {
    const closedHuman = makeConversation({
      status: "closed",
      closeReason: "resolved",
      chatState: JSON.stringify({ state: "agent_mode", aiParticipation: "human_only" }),
    });
    const { db, getUpdateCount } = makeOwnershipDb(closedHuman);

    const status = await new ChatService(db).transitionChatOwnership(
      closedHuman.id, closedHuman.projectId, "team_requested",
    );

    expect(status).toBe("closed");
    expect(getUpdateCount()).toBe(0);
  });

  test("reopens a closed human-owned conversation in agent mode", async () => {
    const closedHuman = makeConversation({ status: "closed" });
    const { db, getStatusWrite } = makeReopenDb(closedHuman);

    await new ChatService(db).reopenConversation(
      closedHuman.id, closedHuman.projectId, "agent_replied",
    );

    expect(getStatusWrite()).toBe("agent_replied");
  });

  test("inserts bot output only from the exact ownership snapshot", () => {
    const { sql, params } = buildConditionalBotMessageQuery(drizzle({} as never), {
      id: "bot-1", conversationId: "conv-1", projectId: "project-1",
      content: "Try reconnecting.", sources: null, senderName: "Maven",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      expectedStatus: "waiting_agent", expectedChatState: '{"ownershipRevision":2}',
    }).toSQL();

    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining(["waiting_agent", '{"ownershipRevision":2}']));
  });

  test("inserts visitor output only while the conversation is operational", () => {
    const { sql, params } = buildConditionalVisitorMessageQuery(
      drizzle({} as never),
      {
        id: "visitor-message-1",
        conversationId: "conv-1",
        projectId: "project-1",
        content: "Can you help?",
        imageUrl: null,
        sources: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining(["conv-1", "project-1"]));
  });

  test("does not append system history after archival", () => {
    const { sql, params } = buildConditionalSystemMessageQuery(
      drizzle({} as never),
      {
        id: "system-1",
        conversationId: "conv-1",
        content: "Agent joined",
        sources: '{"systemKind":"joined"}',
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toContain("conv-1");
  });

  test("does not append an agent reply after archival", () => {
    const { sql, params } = buildConditionalAgentMessageQuery(
      drizzle({} as never),
      {
        id: "agent-message-1",
        conversationId: "conv-1",
        projectId: "project-1",
        content: "I can help.",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining(["conv-1", "project-1"]));
  });

  test("takes ownership and advances the JSON revision in one update", () => {
    const { sql, params } = buildHumanTakeoverQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(sql).toContain("json_set");
    expect(sql).toContain("$.ownershipRevision");
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining(["agent_replied", "conv-1", "project-1"]));
  });

  test("claims a new team request only from one exact active AI-owned snapshot", () => {
    const expectedChatState = JSON.stringify({
      state: "active",
      aiParticipation: "continuous",
      ownershipRevision: 2,
    });
    const nextChatState = JSON.stringify({
      state: "escalating",
      aiParticipation: "assist_until_agent",
      ownershipRevision: 3,
    });
    const { sql, params } = buildNewTeamRequestClaimQuery(
      drizzle({} as never),
      "conv-1",
      "project-1",
      expectedChatState,
      nextChatState,
      "Alice",
      "alice@example.com",
      {
        acceptanceToken: "acceptance-1",
        summary: "Visitor needs help.",
        acceptedAt: "2026-08-09T00:00:00.000Z",
        summaryMessageId: "summary-1",
      },
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."status" = ?');
    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(sql).toContain('"conversations"."visitor_name" = ?');
    expect(sql).toContain('"conversations"."visitor_email" = ?');
    expect(sql).toContain("json_set");
    expect(sql).toContain("$.mavenTeamRequestAcceptedAt");
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(
      expect.arrayContaining([
        "waiting_agent",
        nextChatState,
        "conv-1",
        "project-1",
        "active",
        expectedChatState,
        "Alice",
        "alice@example.com",
      ]),
    );
    expect(params).not.toContain("agent_replied");
  });

  test("allows only the first concurrent new-team-request claim", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });

    const claims = await Promise.all([
      service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
      service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
    ]);
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );

    expect(claims.map((claim) => claim.status).sort()).toEqual([
      "already_requested",
      "claimed",
    ]);
    expect(latest?.status).toBe("waiting_agent");
    const metadata = JSON.parse(latest?.metadata ?? "{}");
    expect(metadata.teamRequestSummary).toBe("Visitor needs help.");
    expect(metadata.teamRequestSummaryPending).toBe(true);
    expect(metadata.teamRequestNotificationState).toBe("pending");
    expect(metadata.mavenTeamRequestAcceptedAt).toBeString();
    expect(metadata.reviewSummaryMessageId).toBeString();
  });

  test("allows only one external notification attempt for an accepted request", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const acceptanceToken = JSON.parse(accepted?.metadata ?? "{}")
      .mavenTeamRequestAcceptanceToken as string;

    const attempts = await Promise.all([
      service.claimNewTeamRequestNotification(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
      ),
      service.claimNewTeamRequestNotification(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
      ),
    ]);
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const metadata = JSON.parse(latest?.metadata ?? "{}");

    expect(attempts.sort()).toEqual([false, true]);
    expect(metadata.teamRequestNotificationState).toBe("attempted");
    expect(metadata.teamRequestNotificationAttemptedAt).toBeString();
  });

  test("rejects an active row whose authoritative state is human-owned", async () => {
    const activeHuman = makeConversation({
      status: "active",
      chatState: JSON.stringify({
        state: "agent_mode",
        aiParticipation: "human_only",
      }),
    });
    const { db, getUpdateCount } = makeOwnershipDb(activeHuman);

    const claimed = await new ChatService(db).claimNewTeamRequest(
      activeHuman.id,
      activeHuman.projectId,
      "Visitor needs help.",
    );

    expect(claimed).toEqual({ status: "already_requested" });
    expect(getUpdateCount()).toBe(0);
  });

  test("contact cleared after the authoritative read prevents the ownership claim", async () => {
    const { sqlite, db } = createConversationContinuityService();
    const authoritativeRead = createDeferred();
    const releaseClaim = createDeferred();
    const service = new BarrierChatService(db, async () => {
      authoritativeRead.resolve();
      await releaseClaim.promise;
    });
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });

    const claimPromise = service.claimNewTeamRequest(
      conversation.id,
      conversation.projectId,
      "Visitor needs help.",
    );
    await authoritativeRead.promise;
    sqlite
      .query("UPDATE conversations SET visitor_email = NULL WHERE id = ?")
      .run(conversation.id);
    releaseClaim.resolve();

    const claim = await claimPromise;
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );

    expect(claim).toEqual({
      status: "contact_required",
      requiredFields: ["email"],
    });
    expect(latest?.status).toBe("active");
  });

  test("an ordinary metadata patch cannot replay stale notification state", async () => {
    const { service, db } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: JSON.stringify({ source: "widget" }),
    });
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const acceptanceToken = JSON.parse(accepted?.metadata ?? "{}")
      .mavenTeamRequestAcceptanceToken as string;

    const staleWriterReady = createDeferred();
    const releaseStaleWriter = createDeferred();
    const staleWriter = new BarrierChatService(db, undefined, async () => {
      staleWriterReady.resolve();
      await releaseStaleWriter.promise;
    });
    const patchPromise = staleWriter.updateConversation(
      conversation.id,
      conversation.projectId,
      {
        metadata: JSON.stringify({ source: "dashboard", campaign: "spring" }),
      },
    );
    await staleWriterReady.promise;
    expect(
      await service.claimNewTeamRequestNotification(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
      ),
    ).toBe(true);
    releaseStaleWriter.resolve();
    await patchPromise;

    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const metadata = JSON.parse(latest?.metadata ?? "{}");
    expect(metadata.teamRequestNotificationState).toBe("attempted");
    expect(metadata.teamRequestSummaryPending).toBe(true);
    expect(metadata.mavenTeamRequestAcceptedAt).toBeString();
    expect(metadata.source).toBe("dashboard");
    expect(metadata.campaign).toBe("spring");
  });

  test("generic metadata patches cannot replace the immutable acceptance token", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const originalToken = JSON.parse(accepted?.metadata ?? "{}")
      .mavenTeamRequestAcceptanceToken as string;

    const updated = await service.updateConversation(
      conversation.id,
      conversation.projectId,
      {
        metadata: JSON.stringify({
          mavenTeamRequestAcceptanceToken: "replacement-token",
          source: "widget",
        }),
      },
    );
    const metadata = JSON.parse(updated?.metadata ?? "{}");

    expect(metadata.mavenTeamRequestAcceptanceToken).toBe(originalToken);
    expect(metadata.source).toBe("widget");
  });

  const protectedAcceptanceFieldCases: Array<{
    field:
      | "teamRequestSummary"
      | "reviewSummaryMessageId"
      | "teamRequestSummaryPending"
      | "teamRequestNotificationState"
      | "mavenTeamRequestTelegramThreadAcceptanceToken";
    replacement: unknown;
  }> = [
    { field: "teamRequestSummary", replacement: "Forged summary." },
    { field: "reviewSummaryMessageId", replacement: "forged-message" },
    { field: "teamRequestSummaryPending", replacement: "false" },
    { field: "teamRequestNotificationState", replacement: "attempted" },
    {
      field: "mavenTeamRequestTelegramThreadAcceptanceToken",
      replacement: "forged-thread-generation",
    },
  ];

  for (const { field, replacement } of protectedAcceptanceFieldCases) {
    test(`generic metadata patches cannot replace ${field}`, async () => {
      const { service } = createConversationContinuityService();
      const conversation = await service.createConversation({
        projectId: "project-1",
        customerId: null,
        visitorId: "visitor-1",
        visitorName: "Alice",
        visitorEmail: "alice@example.com",
        metadata: JSON.stringify({ source: "widget" }),
      });
      expect(
        await service.claimNewTeamRequest(
          conversation.id,
          conversation.projectId,
          "Accepted summary.",
        ),
      ).toEqual({ status: "claimed" });
      const accepted = await service.getOperationalConversationById(
        conversation.id,
        conversation.projectId,
      );
      const acceptedMetadata = JSON.parse(accepted?.metadata ?? "{}");

      const updated = await service.updateConversation(
        conversation.id,
        conversation.projectId,
        {
          metadata: JSON.stringify({
            [field]: replacement,
            source: "dashboard",
          }),
        },
      );
      const metadata = JSON.parse(updated?.metadata ?? "{}");

      expect(metadata[field]).toEqual(acceptedMetadata[field]);
      expect(metadata.source).toBe("dashboard");
    });
  }

  test("protected-only metadata patches leave metadata and updatedAt unchanged", async () => {
    const { service, sqlite } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: JSON.stringify({ source: "widget" }),
    });
    sqlite
      .query("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(946_684_800, conversation.id);
    const before = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );

    const updated = await service.updateConversation(
      conversation.id,
      conversation.projectId,
      {
        metadata: JSON.stringify({
          teamRequestSummary: "Forged summary.",
          reviewSummaryMessageId: "forged-message",
          teamRequestSummaryPending: "false",
          teamRequestNotificationState: "attempted",
          mavenTeamRequestAcceptanceToken: "forged-generation",
          mavenTeamRequestTelegramThreadAcceptanceToken:
            "forged-thread-generation",
        }),
      },
    );

    expect(updated?.metadata).toBe(before?.metadata);
    expect(updated?.updatedAt).toEqual(before?.updatedAt);
  });

  test("trusted legacy escalation metadata remains writable outside generic patches", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: JSON.stringify({ source: "contact_form" }),
    });

    const started = await service.updateLegacyEscalationMetadata(
      conversation.id,
      conversation.projectId,
      {
        expectedMavenAcceptanceToken: null,
        summary: "Legacy contact request.",
        summaryMessageId: "legacy-summary-message",
        escalatedAt: "2026-08-09T12:00:00.000Z",
        summaryPending: true,
      },
    );
    const completed = await service.updateLegacyEscalationMetadata(
      conversation.id,
      conversation.projectId,
      {
        expectedMavenAcceptanceToken: null,
        summary: "Legacy contact request.",
        summaryMessageId: "legacy-summary-message",
        summaryPending: false,
      },
    );
    const metadata = JSON.parse(completed?.metadata ?? "{}");

    expect(started).not.toBeNull();
    expect(metadata).toMatchObject({
      source: "contact_form",
      teamRequestSummary: "Legacy contact request.",
      reviewSummaryMessageId: "legacy-summary-message",
      escalatedAt: "2026-08-09T12:00:00.000Z",
      teamRequestSummaryPending: false,
    });
  });

  test("stale legacy escalation metadata loses to a fresh Maven acceptance token", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: JSON.stringify({ source: "widget" }),
    });
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Accepted Maven summary.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const acceptedMetadata = JSON.parse(accepted?.metadata ?? "{}");

    const staleUpdate = await service.updateLegacyEscalationMetadata(
      conversation.id,
      conversation.projectId,
      {
        expectedMavenAcceptanceToken: null,
        summary: "Stale legacy summary.",
        summaryMessageId: "stale-legacy-message",
        summaryPending: false,
      },
    );
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const metadata = JSON.parse(latest?.metadata ?? "{}");

    expect(staleUpdate).toBeNull();
    expect(metadata.teamRequestSummary).toBe("Accepted Maven summary.");
    expect(metadata.reviewSummaryMessageId).toBe(
      acceptedMetadata.reviewSummaryMessageId,
    );
    expect(metadata.teamRequestSummaryPending).toBe(true);
    expect(metadata.teamRequestNotificationState).toBe("pending");
  });

  test("retained Maven history does not block a trusted legacy escalation after handback", async () => {
    const { service } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Earlier Maven summary.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const acceptanceToken = JSON.parse(accepted?.metadata ?? "{}")
      .mavenTeamRequestAcceptanceToken as string;
    expect(
      await service.transitionChatOwnership(
        conversation.id,
        conversation.projectId,
        "ai_handed_back",
      ),
    ).toBe("active");

    const updated = await service.updateLegacyEscalationMetadata(
      conversation.id,
      conversation.projectId,
      {
        expectedMavenAcceptanceToken: acceptanceToken,
        summary: "Later contact-form summary.",
        summaryMessageId: "later-contact-form-message",
        escalatedAt: "2026-08-09T13:00:00.000Z",
        summaryPending: true,
      },
    );
    const metadata = JSON.parse(updated?.metadata ?? "{}");

    expect(updated).not.toBeNull();
    expect(metadata.mavenTeamRequestAcceptanceToken).toBe(acceptanceToken);
    expect(metadata.teamRequestSummary).toBe("Later contact-form summary.");
    expect(metadata.reviewSummaryMessageId).toBe(
      "later-contact-form-message",
    );
    expect(metadata.teamRequestSummaryPending).toBe(true);
  });

  test("persists a returned Telegram thread only for the accepted request", async () => {
    const { service, sqlite } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: "Alice",
      visitorEmail: "alice@example.com",
      metadata: null,
    });
    sqlite
      .query("UPDATE conversations SET telegram_thread_id = ? WHERE id = ?")
      .run("older-thread", conversation.id);
    expect(
      await service.claimNewTeamRequest(
        conversation.id,
        conversation.projectId,
        "Visitor needs help.",
      ),
    ).toEqual({ status: "claimed" });
    const accepted = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const acceptedMetadata = JSON.parse(accepted?.metadata ?? "{}");
    const acceptanceToken =
      acceptedMetadata.mavenTeamRequestAcceptanceToken as string;
    expect(
      await service.claimNewTeamRequestNotification(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
      ),
    ).toBe(true);

    expect(
      await service.persistNewTeamRequestTelegramThreadId(
        conversation.id,
        conversation.projectId,
        "prior-acceptance",
        "999",
      ),
    ).toBe(false);
    expect(
      await service.persistNewTeamRequestTelegramThreadId(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
        "123",
      ),
    ).toBe(true);
    expect(
      await service.persistNewTeamRequestTelegramThreadId(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
        "123",
      ),
    ).toBe(true);
    expect(
      await service.persistNewTeamRequestTelegramThreadId(
        conversation.id,
        conversation.projectId,
        acceptanceToken,
        "456",
      ),
    ).toBe(false);
    expect(
      (
        await service.getOperationalConversationById(
          conversation.id,
          conversation.projectId,
        )
      )?.telegramThreadId,
    ).toBe("123");
  });

  test("uses waiting-agent ownership fallback when persisting through malformed chat state", async () => {
    const { service, sqlite } = createConversationContinuityService();
    const { conversation, acceptanceToken } =
      await createAttemptedTeamRequest(service);
    sqlite
      .query("UPDATE conversations SET chat_state = ? WHERE id = ?")
      .run("{malformed", conversation.id);

    const persisted = await service.persistNewTeamRequestTelegramThreadId(
      conversation.id,
      conversation.projectId,
      acceptanceToken,
      "new-thread",
    );
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    const metadata = JSON.parse(latest?.metadata ?? "{}");

    expect(persisted).toBe(true);
    expect(latest?.telegramThreadId).toBe("new-thread");
    expect(metadata.mavenTeamRequestTelegramThreadAcceptanceToken).toBe(
      acceptanceToken,
    );
  });

  test("handback winning the Telegram thread persistence race prevents mutation", async () => {
    const { service, db } = createConversationContinuityService();
    const { conversation, acceptanceToken } =
      await createAttemptedTeamRequest(service);

    const barrier = createTelegramPersistenceBarrier(db);
    const persistence = barrier.service.persistNewTeamRequestTelegramThreadId(
      conversation.id,
      conversation.projectId,
      acceptanceToken,
      "new-thread",
    );
    const firstEvent = await Promise.race([
      barrier.ready.promise.then(() => "persistence_ready" as const),
      persistence.then(() => "persistence_completed" as const),
    ]);
    expect(firstEvent).toBe("persistence_ready");

    expect(
      await service.transitionChatOwnership(
        conversation.id,
        conversation.projectId,
        "ai_handed_back",
      ),
    ).toBe("active");
    barrier.release.resolve();

    expect(await persistence).toBe(false);
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    expect(latest?.status).toBe("active");
    expect(latest?.telegramThreadId).toBeNull();
    expect(
      JSON.parse(latest?.metadata ?? "{}")
        .mavenTeamRequestTelegramThreadAcceptanceToken,
    ).toBeUndefined();
  });

  test("takeover winning the Telegram thread persistence race prevents mutation", async () => {
    const { service, db } = createConversationContinuityService();
    const { conversation, acceptanceToken } =
      await createAttemptedTeamRequest(service);
    const barrier = createTelegramPersistenceBarrier(db);
    const persistence = barrier.service.persistNewTeamRequestTelegramThreadId(
      conversation.id,
      conversation.projectId,
      acceptanceToken,
      "new-thread",
    );
    const firstEvent = await Promise.race([
      barrier.ready.promise.then(() => "persistence_ready" as const),
      persistence.then(() => "persistence_completed" as const),
    ]);
    expect(firstEvent).toBe("persistence_ready");

    const ownership = await service.takeHumanOwnership(
      conversation.id,
      conversation.projectId,
    );
    expect(ownership?.status).toBe("agent_replied");
    barrier.release.resolve();

    expect(await persistence).toBe(false);
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    expect(latest?.status).toBe("agent_replied");
    expect(latest?.telegramThreadId).toBeNull();
    expect(
      JSON.parse(latest?.metadata ?? "{}")
        .mavenTeamRequestTelegramThreadAcceptanceToken,
    ).toBeUndefined();
  });

  test("human-only ownership prevents thread persistence while waiting status lags", async () => {
    const { service, sqlite, db } = createConversationContinuityService();
    const { conversation, acceptanceToken } =
      await createAttemptedTeamRequest(service);

    const barrier = createTelegramPersistenceBarrier(db);
    const persistence = barrier.service.persistNewTeamRequestTelegramThreadId(
      conversation.id,
      conversation.projectId,
      acceptanceToken,
      "new-thread",
    );
    const firstEvent = await Promise.race([
      barrier.ready.promise.then(() => "persistence_ready" as const),
      persistence.then(() => "persistence_completed" as const),
    ]);
    expect(firstEvent).toBe("persistence_ready");

    const acceptedState = JSON.parse(conversation.chatState ?? "{}");
    sqlite
      .query("UPDATE conversations SET chat_state = ? WHERE id = ?")
      .run(
        JSON.stringify({
          ...acceptedState,
          state: "agent_mode",
          aiParticipation: "human_only",
          ownershipRevision:
            typeof acceptedState.ownershipRevision === "number"
              ? acceptedState.ownershipRevision + 1
              : 1,
        }),
        conversation.id,
      );
    barrier.release.resolve();

    expect(await persistence).toBe(false);
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );
    expect(latest?.status).toBe("waiting_agent");
    expect(latest?.telegramThreadId).toBeNull();
    expect(
      JSON.parse(latest?.metadata ?? "{}")
        .mavenTeamRequestTelegramThreadAcceptanceToken,
    ).toBeUndefined();
  });

  test("trusted contactDeclined permits an atomic claim without saved contact", async () => {
    const { service, sqlite } = createConversationContinuityService();
    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      metadata: null,
    });
    sqlite
      .query("UPDATE conversations SET chat_state = ? WHERE id = ?")
      .run(
        JSON.stringify({
          state: "active",
          aiParticipation: "continuous",
          contactDeclined: true,
        }),
        conversation.id,
      );

    const claim = await service.claimNewTeamRequest(
      conversation.id,
      conversation.projectId,
      "Visitor needs help.",
    );
    const latest = await service.getOperationalConversationById(
      conversation.id,
      conversation.projectId,
    );

    expect(claim).toEqual({ status: "claimed" });
    expect(latest?.status).toBe("waiting_agent");
  });
});

describe("ChatService tenant and AI ownership guards", () => {
  test("resolves a visitor mapping inside conversation insertion", async () => {
    const { service, sqlite } = createConversationContinuityService();
    sqlite
      .query("INSERT INTO customers (id, project_id) VALUES (?, ?)")
      .run("customer-1", "project-1");
    sqlite
      .query(
        "INSERT INTO customer_visitors (id, project_id, customer_id, visitor_id, linked_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "visitor-link-1",
        "project-1",
        "customer-1",
        "visitor-1",
        "signed_widget",
      );

    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      metadata: null,
    });

    expect(conversation.customerId).toBe("customer-1");
  });

  test("prefers the current visitor mapping over stale caller ownership", async () => {
    const { service, sqlite } = createConversationContinuityService();
    sqlite
      .query("INSERT INTO customers (id, project_id) VALUES (?, ?), (?, ?)")
      .run(
        "customer-current",
        "project-1",
        "customer-before-merge",
        "project-1",
      );
    sqlite
      .query(
        "INSERT INTO customer_visitors (id, project_id, customer_id, visitor_id, linked_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "visitor-link-1",
        "project-1",
        "customer-current",
        "visitor-1",
        "dashboard",
      );

    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: "customer-before-merge",
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      metadata: null,
    });

    expect(conversation.customerId).toBe("customer-current");
  });

  test("discards stale caller ownership after customer deletion", async () => {
    const { service } = createConversationContinuityService();

    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: "customer-deleted",
      visitorId: "visitor-1",
      visitorName: null,
      visitorEmail: null,
      metadata: null,
    });

    expect(conversation.customerId).toBeNull();
  });

  test("persists a pre-resolved customer on conversation creation", async () => {
    const { service, sqlite } = createConversationContinuityService();
    sqlite
      .query("INSERT INTO customers (id, project_id) VALUES (?, ?)")
      .run("customer-1", "project-1");

    const conversation = await service.createConversation({
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      visitorName: "Customer name",
      visitorEmail: "customer@example.com",
      metadata: null,
    });

    expect(conversation.customerId).toBe("customer-1");
    expect(conversation).toMatchObject({
      visitorName: "Customer name",
      visitorEmail: "customer@example.com",
    });
  });

  test("includes customer identity in incremental inbox updates", async () => {
    let selectedKeys: string[] = [];
    const db = {
      select: (projection: Record<string, unknown>) => {
        selectedKeys = Object.keys(projection);
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
            }),
          }),
        };
      },
    } as unknown as DrizzleD1Database<Record<string, unknown>>;

    await new ChatService(db).getConversationUpdatesSince(
      "project-1",
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(selectedKeys).toContain("customerId");
  });

  test("scopes needs-review rows and inbox counts to the current project", () => {
    const db = drizzle({} as never);
    const now = new Date("2026-08-01T00:00:00.000Z");
    const needsReview = buildNeedsReviewQuery(
      db, "project-1", Date.parse("2026-07-31T00:00:00.000Z"), now,
    ).toSQL();
    const inboxCounts = buildInboxCountsQuery(db, "project-1", now).toSQL();

    expect(needsReview.sql).toContain('"conversations"."project_id" = ?');
    expect(needsReview.params).toContain("project-1");
    expect(inboxCounts.sql).toContain('"conversations"."project_id" = ?');
    expect(inboxCounts.params).toContain("project-1");
  });

  test("excludes archived rows from operational inbox queries", () => {
    const db = drizzle({} as never);
    const now = new Date("2026-08-01T00:00:00.000Z");
    const needsReview = buildNeedsReviewQuery(
      db,
      "project-1",
      Date.parse("2026-07-31T00:00:00.000Z"),
      now,
    ).toSQL();
    const inboxCounts = buildInboxCountsQuery(db, "project-1", now).toSQL();

    expect(needsReview.sql).toContain('"conversations"."archived_at" is null');
    expect(inboxCounts.sql).toContain('"conversations"."archived_at" is null');
    expect(inboxCounts.sql).toContain('"conversations"."archived_at" is not null');
  });

  test("excludes archived rows from widget identity lookups", () => {
    const db = drizzle({} as never);
    const direct = buildOperationalConversationQuery(
      db,
      "conv-1",
      "project-1",
    ).toSQL();
    const active = buildActiveConversationByVisitorQuery(
      db,
      "project-1",
      "visitor-1",
    ).toSQL();

    expect(direct.sql).toContain('"conversations"."archived_at" is null');
    expect(active.sql).toContain('"conversations"."archived_at" is null');
  });

  test("closes only this project's OPEN conversations, as spam, returning ids", () => {
    const { sql, params } = buildBanSweepQuery(
      drizzle({} as never), "project-1", "visitor-1",
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."status" <> ?');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(expect.arrayContaining(["closed", "spam", "project-1", "visitor-1"]));
  });

  test("matches by visitor id OR email when an email is known", () => {
    const { sql, params } = buildBanSweepQuery(
      drizzle({} as never), "project-1", "visitor-1", "spam@example.com",
    ).toSQL();

    expect(sql).toContain('"conversations"."visitor_id" = ? or "conversations"."visitor_email" = ?');
    expect(params).toEqual(expect.arrayContaining(["visitor-1", "spam@example.com"]));
  });

  test("cannot close a conversation after a human has joined", () => {
    const { params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(params).not.toContain("agent_replied");
    expect(params).toContain("bot_resolved");
  });

  test("only resolves currently AI-owned active or waiting conversations", () => {
    const { sql, params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1",
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining(["active", "waiting_agent"]));
  });

  test("uses the ownership snapshot as a compare-and-swap guard", () => {
    const expected = '{"ownershipRevision":2}';
    const resolved = '{"ownershipRevision":3}';
    const { sql, params } = buildAiResolutionQuery(
      drizzle({} as never), "conv-1", "project-1", expected, resolved,
    ).toSQL();

    expect(sql).toContain('"conversations"."chat_state" = ?');
    expect(params).toEqual(expect.arrayContaining([expected, resolved]));
  });
});

describe("ChatService bulk conversation actions", () => {
  test("reports updated and skipped ids in request order", async () => {
    const db = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ id: "conv-2" }],
          }),
        }),
      }),
    } as unknown as DrizzleD1Database<Record<string, unknown>>;

    const result = await new ChatService(db).bulkUpdateConversations(
      "project-1",
      ["conv-1", "conv-2", "conv-3"],
      { action: "archive" },
      new Date("2026-08-01T10:00:00.000Z"),
    );

    expect(result).toEqual({
      updatedIds: ["conv-2"],
      skippedIds: ["conv-1", "conv-3"],
    });
  });

  test("archives only requested conversations in the current project", () => {
    const archivedAt = new Date("2026-08-01T10:00:00.000Z");
    const { sql, params } = buildBulkConversationActionQuery(
      drizzle({} as never),
      "project-1",
      ["conv-1", "conv-2"],
      { action: "archive" },
      archivedAt,
    ).toSQL();

    expect(sql).toContain('"conversations"."project_id" = ?');
    expect(sql).toContain('"conversations"."id" in (?, ?)');
    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(sql).toContain('"conversations"."external_action_started_at" is null');
    expect(sql).toContain('returning "id"');
    expect(params).toEqual(expect.arrayContaining([
      archivedAt.getTime() / 1000,
      "project-1",
      "conv-1",
      "conv-2",
    ]));
  });

  test("unarchives only before retention has claimed the conversation", () => {
    const { sql, params } = buildBulkConversationActionQuery(
      drizzle({} as never),
      "project-1",
      ["conv-1"],
      { action: "unarchive" },
      new Date("2026-08-01T10:00:00.000Z"),
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" is not null');
    expect(sql).toContain('"conversations"."purge_started_at" is null');
    expect(params).toEqual(expect.arrayContaining(["project-1", "conv-1"]));
  });

  test("keeps archived conversations immutable for non-unarchive actions", () => {
    const { sql, params } = buildBulkConversationActionQuery(
      drizzle({} as never),
      "project-1",
      ["conv-1"],
      { action: "assign", assigneeId: "agent-1" },
      new Date("2026-08-01T10:00:00.000Z"),
    ).toSQL();

    expect(sql).toContain('"conversations"."archived_at" is null');
    expect(params).toEqual(expect.arrayContaining([
      "agent-1",
      "project-1",
      "conv-1",
    ]));
  });

  test("maps each state-changing action to its intended fields", () => {
    const db = drizzle({} as never);
    const now = new Date("2026-08-01T10:00:00.000Z");
    const resolve = buildBulkConversationActionQuery(
      db, "project-1", ["conv-1"], { action: "resolve" }, now,
    ).toSQL();
    const snooze = buildBulkConversationActionQuery(
      db, "project-1", ["conv-1"], { action: "snooze", until: 1_786_000_000_000 }, now,
    ).toSQL();
    const priority = buildBulkConversationActionQuery(
      db, "project-1", ["conv-1"], { action: "priority", priority: "high" }, now,
    ).toSQL();
    const spam = buildBulkConversationActionQuery(
      db, "project-1", ["conv-1"], { action: "flag_spam" }, now,
    ).toSQL();

    expect(resolve.sql).toContain('"status" = ?, "close_reason" = ?');
    expect(resolve.params).toEqual(expect.arrayContaining(["closed", "resolved"]));
    expect(snooze.sql).toContain('"snoozed_until" = ?');
    expect(priority.sql).toContain('"priority" = ?');
    expect(priority.params).toContain("high");
    expect(spam.params).toEqual(expect.arrayContaining(["closed", "spam"]));
  });
});
