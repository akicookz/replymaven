import { describe, expect, test } from "bun:test";
import { createEscalation } from "./escalation";
import { type PublicConversationStore } from "../../conversations/public-conversation-store";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type PublicMessageRecord } from "../../../shared/maven-conversation";

// ─── createEscalation harness ─────────────────────────────────────────────────
// Services are mocked at the I/O boundary; each helper records the calls the
// pure branching/metadata logic makes so we can assert on them.

interface AddSystemMessageCall {
  conversationId: string;
  kind: string;
  content: string;
}
interface UpdateConversationCall {
  id: string;
  projectId: string;
  data: { metadata?: string; visitorName?: string; visitorEmail?: string };
}
interface UpdateLegacyEscalationMetadataCall {
  id: string;
  projectId: string;
  data: {
    expectedMavenAcceptanceToken: string | null;
    summary: string;
    summaryMessageId: string;
    escalatedAt?: string;
    summaryPending?: boolean;
  };
}

function makeChatService() {
  const calls = {
    addPublicSystemMessage: [] as AddSystemMessageCall[],
    updateConversation: [] as UpdateConversationCall[],
    updateLegacyEscalationMetadata:
      [] as UpdateLegacyEscalationMetadataCall[],
  };
  const service = {
    appendSystem: async (input: {
      conversationId: string;
      kind: string;
      content: string;
      idempotencyKey?: string;
    }): Promise<PublicMessageRecord> => {
      const { conversationId, kind, content, idempotencyKey } = input;
      calls.addPublicSystemMessage.push({ conversationId, kind, content });
      const now = Date.now();
      return {
        id: idempotencyKey ?? "msg-review-1",
        conversationId,
        author: "system",
        content,
        sources: [],
        imageUrls: [],
        systemKind: kind,
        senderName: null,
        senderAvatar: null,
        userId: null,
        createdAt: now,
        emailedAt: null,
        deliveredAt: null,
        readAt: null,
      };
    },
    updateConversation: async (
      id: string,
      projectId: string,
      data: UpdateConversationCall["data"],
    ) => {
      calls.updateConversation.push({ id, projectId, data });
      return { id };
    },
    updateLegacyEscalationMetadata: async (
      projectId: string,
      id: string,
      data: UpdateLegacyEscalationMetadataCall["data"],
    ) => {
      calls.updateLegacyEscalationMetadata.push({ id, projectId, data });
      return { id };
    },
    acquireExternalAction: async () => ({
      projectId: "project-1",
      conversationId: "conv-1",
      leaseId: "lease-1",
      ownershipRevision: 0,
      acquiredAt: Date.now(),
    }),
    releaseExternalAction: async () => undefined,
  } as unknown as PublicConversationStore;
  return { service, calls };
}

const projectServiceStub = {
  getOwnerEmail: async () => null,
} as unknown as ProjectService;

const noopExecutionCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

function makeConversation(
  overrides: Partial<{
    id: string;
    visitorId: string | null;
    visitorName: string | null;
    visitorEmail: string | null;
    telegramThreadId: string | null;
    status: string;
    metadata: string | null;
  }> = {},
) {
  return {
    id: "conv-1",
    visitorId: "visitor-1",
    visitorName: "Alice",
    visitorEmail: "alice@example.com",
    telegramThreadId: null,
    status: "active",
    metadata: null,
    ...overrides,
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  const { service, calls } = makeChatService();
  const broadcasts: PublicMessageRecord[] = [];
  const params = {
    chatService: service,
    projectService: projectServiceStub,
    telegramService: undefined,
    project: { id: "project-1", name: "Acme" },
    conversation: makeConversation(),
    summary: "Visitor needs a refund on order 123.",
    settings: null,
    env: { BETTER_AUTH_URL: "https://app.test" },
    executionCtx: noopExecutionCtx,
    broadcast: (row: PublicMessageRecord) => {
      broadcasts.push(row);
    },
    ...overrides,
  };
  return { params, calls, broadcasts };
}

describe("createEscalation - first escalation (created)", () => {
  test("posts a review_summary system message and broadcasts it", async () => {
    const { params, calls, broadcasts } = baseParams();

    const result = await createEscalation(params as never);

    expect(result.created).toBe(true);
    expect(result.summaryMessageId).toBeString();
    expect(calls.addPublicSystemMessage).toHaveLength(1);
    expect(calls.addPublicSystemMessage[0]).toMatchObject({
      conversationId: "conv-1",
      kind: "review_summary",
      content: "Visitor needs a refund on order 123.",
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].id).toBe(result.summaryMessageId);
  });

  test("patches escalation fields without replaying unrelated metadata", async () => {
    const { params, calls } = baseParams({
      conversation: makeConversation({
        metadata: JSON.stringify({
          country: "US",
          city: "NYC",
          source: "widget",
        }),
      }),
    });

    const result = await createEscalation(params as never);

    expect(result.created).toBe(true);
    const meta = calls.updateLegacyEscalationMetadata[0].data;
    expect(meta).not.toHaveProperty("country");
    expect(meta).not.toHaveProperty("city");
    expect(meta).not.toHaveProperty("source");
    expect(meta.summaryMessageId).toBe(result.summaryMessageId);
  });

  test("uses the dedicated non-Maven metadata path instead of the generic patch", async () => {
    const { params, calls } = baseParams();

    const result = await createEscalation(params as never);

    expect(result.accepted).toBe(true);
    expect(calls.updateConversation).toHaveLength(0);
    expect(calls.updateLegacyEscalationMetadata).toHaveLength(2);
    expect(calls.updateLegacyEscalationMetadata[0].data).toMatchObject({
      expectedMavenAcceptanceToken: null,
      summary: "Visitor needs a refund on order 123.",
      summaryMessageId: result.summaryMessageId,
      summaryPending: true,
    });
    expect(calls.updateLegacyEscalationMetadata[1].data).toEqual({
      expectedMavenAcceptanceToken: null,
      summary: "Visitor needs a refund on order 123.",
      summaryMessageId: result.summaryMessageId,
      summaryPending: false,
    });
  });

  test("does not replay stale notification state in its metadata patch", async () => {
    const { params, calls } = baseParams({
      conversation: makeConversation({
        metadata: JSON.stringify({
          escalatedAt: "2026-08-09T00:00:00.000Z",
          reviewSummaryMessageId: "msg-review-1",
          teamRequestSummary: "Accepted summary.",
          teamRequestSummaryPending: true,
          teamRequestNotificationState: "pending",
          mavenTeamRequestAcceptedAt: "2026-08-09T00:00:00.000Z",
        }),
      }),
    });

    await createEscalation(params as never);

    const firstPatch = calls.updateLegacyEscalationMetadata[0].data;
    expect(firstPatch).not.toHaveProperty("teamRequestNotificationState");
    expect(firstPatch).not.toHaveProperty("mavenTeamRequestAcceptedAt");
  });

  test('treats the metadata literal "null" as absent instead of crashing', async () => {
    const { params, calls } = baseParams({
      conversation: makeConversation({ metadata: "null" }),
    });

    const result = await createEscalation(params as never);

    expect(result.created).toBe(true);
    const meta = calls.updateLegacyEscalationMetadata[0].data;
    expect(typeof meta.escalatedAt).toBe("string");
    expect(meta.summary).toBe("Visitor needs a refund on order 123.");
  });
});

describe("createEscalation - repeat escalation (already forwarded)", () => {
  test("does not post or broadcast a duplicate summary message", async () => {
    const { params, calls, broadcasts } = baseParams({
      conversation: makeConversation({
        metadata: JSON.stringify({
          escalatedAt: "2020-01-01T00:00:00.000Z",
          reviewSummaryMessageId: "msg-existing",
          country: "US",
        }),
      }),
    });

    const result = await createEscalation(params as never);

    expect(result.created).toBe(false);
    expect(result.summaryMessageId).toBe("msg-existing");
    expect(calls.addPublicSystemMessage).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });
});

describe("createEscalation - telegram notification", () => {
  function makeTelegramService() {
    const calls: Array<{
      botToken: string;
      chatId: string;
      params: {
        summary: string;
        conversationUrl: string;
        isUpdate: boolean;
        replyToMessageId?: number;
      };
    }> = [];
    const service = {
      notifyEscalation: async (
        botToken: string,
        chatId: string,
        p: {
          summary: string;
          conversationUrl: string;
          isUpdate: boolean;
          replyToMessageId?: number;
        },
      ): Promise<number | null> => {
        calls.push({ botToken, chatId, params: p });
        return 555;
      },
    } as unknown as TelegramService;
    return { service, calls };
  }

  const settings = {
    telegramBotToken: "bot-token",
    telegramChatId: "chat-id",
  };

  test("first escalation starts a thread linked to the review summary", async () => {
    const tg = makeTelegramService();
    const { params } = baseParams({
      telegramService: tg.service,
      settings,
    });

    const result = await createEscalation(params as never);

    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0].params.isUpdate).toBe(false);
    expect(tg.calls[0].params.replyToMessageId).toBeUndefined();
    expect(tg.calls[0].params.conversationUrl).toBe(
      `https://app.test/app/projects/project-1/conversations?filter=needs-you&id=conv-1&msg=${result.summaryMessageId}`,
    );
    expect(result.summaryMessageId).toBeString();
    expect(result.telegramThreadId).toBe("555");
  });

  test("repeat escalation: isUpdate true, replyTo parsed from telegramThreadId", async () => {
    const tg = makeTelegramService();
    const { params } = baseParams({
      telegramService: tg.service,
      settings,
      conversation: makeConversation({
        telegramThreadId: "999",
        metadata: JSON.stringify({
          escalatedAt: "2020-01-01T00:00:00.000Z",
          reviewSummaryMessageId: "msg-existing",
        }),
      }),
    });

    await createEscalation(params as never);

    expect(tg.calls[0].params.isUpdate).toBe(true);
    expect(tg.calls[0].params.replyToMessageId).toBe(999);
    expect(tg.calls[0].params.conversationUrl).toBe(
      "https://app.test/app/projects/project-1/conversations?filter=needs-you&id=conv-1&msg=msg-existing",
    );
  });

  test("does not notify after the conversation becomes unavailable", async () => {
    const tg = makeTelegramService();
    const unavailableChatService = {
      appendSystem: async () => null,
      updateConversation: async () => null,
      updateLegacyEscalationMetadata: async () => null,
    } as unknown as PublicConversationStore;
    const { params } = baseParams({
      chatService: unavailableChatService,
      telegramService: tg.service,
      settings,
    });

    const result = await createEscalation(params as never);

    expect(tg.calls).toHaveLength(0);
    expect(result.created).toBe(false);
    expect(result.summaryMessageId).toBeNull();
  });
});
