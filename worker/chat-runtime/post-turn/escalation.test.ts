import { describe, expect, test } from "bun:test";
import { createEscalation, parseTelegramThreadId } from "./escalation";
import { type ChatService } from "../../services/chat-service";
import { type ProjectService } from "../../services/project-service";
import { type TelegramService } from "../../services/telegram-service";
import { type MessageRow } from "../../db";

describe("parseTelegramThreadId", () => {
  test("parses a positive numeric string", () => {
    expect(parseTelegramThreadId("12345")).toBe(12345);
  });

  test("trims surrounding whitespace before parsing", () => {
    expect(parseTelegramThreadId("  12345  ")).toBe(12345);
  });

  test("returns undefined for null", () => {
    expect(parseTelegramThreadId(null)).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    expect(parseTelegramThreadId(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseTelegramThreadId("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    expect(parseTelegramThreadId("   ")).toBeUndefined();
  });

  test("returns undefined for non-numeric string", () => {
    expect(parseTelegramThreadId("abc")).toBeUndefined();
  });

  test("returns undefined for negative number", () => {
    expect(parseTelegramThreadId("-1")).toBeUndefined();
  });

  test("returns undefined for zero", () => {
    expect(parseTelegramThreadId("0")).toBeUndefined();
  });

  test("parses leading-digit strings via parseInt (e.g. '123abc' → 123)", () => {
    expect(parseTelegramThreadId("123abc")).toBe(123);
  });
});

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

function makeChatService() {
  const calls = {
    addSystemMessage: [] as AddSystemMessageCall[],
    updateConversation: [] as UpdateConversationCall[],
  };
  const service = {
    addSystemMessage: async (
      conversationId: string,
      kind: string,
      content: string,
    ): Promise<MessageRow> => {
      calls.addSystemMessage.push({ conversationId, kind, content });
      const now = new Date();
      return {
        id: "msg-review-1",
        conversationId,
        role: "system",
        content,
        sources: JSON.stringify({ systemKind: kind }),
        imageUrl: null,
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
      return null;
    },
  } as unknown as ChatService;
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
  const broadcasts: MessageRow[] = [];
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
    broadcast: (row: MessageRow) => {
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
    expect(result.summaryMessageId).toBe("msg-review-1");
    expect(calls.addSystemMessage).toHaveLength(1);
    expect(calls.addSystemMessage[0]).toMatchObject({
      conversationId: "conv-1",
      kind: "review_summary",
      content: "Visitor needs a refund on order 123.",
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].id).toBe("msg-review-1");
  });

  test("stamps escalatedAt + reviewSummaryMessageId + teamRequestSummary in metadata", async () => {
    const { params, calls } = baseParams();

    await createEscalation(params as never);

    expect(calls.updateConversation).toHaveLength(1);
    const meta = JSON.parse(calls.updateConversation[0].data.metadata!);
    expect(typeof meta.escalatedAt).toBe("string");
    expect(meta.reviewSummaryMessageId).toBe("msg-review-1");
    expect(meta.teamRequestSummary).toBe("Visitor needs a refund on order 123.");
  });

  test("preserves existing metadata keys (country/city/source)", async () => {
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
    const meta = JSON.parse(calls.updateConversation[0].data.metadata!);
    expect(meta.country).toBe("US");
    expect(meta.city).toBe("NYC");
    expect(meta.source).toBe("widget");
    expect(meta.reviewSummaryMessageId).toBe("msg-review-1");
  });

  test("falls back to default summary when summary is blank", async () => {
    const { params, calls } = baseParams({ summary: "   " });

    const result = await createEscalation(params as never);

    expect(result.summary).toBe("Visitor asked for team follow-up.");
    expect(calls.addSystemMessage[0].content).toBe(
      "Visitor asked for team follow-up.",
    );
  });

  test('treats the metadata literal "null" as absent instead of crashing', async () => {
    const { params, calls } = baseParams({
      conversation: makeConversation({ metadata: "null" }),
    });

    const result = await createEscalation(params as never);

    expect(result.created).toBe(true);
    const meta = JSON.parse(calls.updateConversation[0].data.metadata!);
    expect(typeof meta.escalatedAt).toBe("string");
    expect(meta.teamRequestSummary).toBe("Visitor needs a refund on order 123.");
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
    expect(calls.addSystemMessage).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  test("keeps the original escalatedAt and preserves prior keys", async () => {
    const { params, calls } = baseParams({
      conversation: makeConversation({
        metadata: JSON.stringify({
          escalatedAt: "2020-01-01T00:00:00.000Z",
          reviewSummaryMessageId: "msg-existing",
          country: "US",
        }),
      }),
    });

    await createEscalation(params as never);

    const meta = JSON.parse(calls.updateConversation[0].data.metadata!);
    expect(meta.escalatedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(meta.reviewSummaryMessageId).toBe("msg-existing");
    expect(meta.country).toBe("US");
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

  test("first escalation: isUpdate false, no replyTo, deep-link carries msg id", async () => {
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
      "https://app.test/app/projects/project-1/conversations?filter=needs-you&id=conv-1&msg=msg-review-1",
    );
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

  test("skips telegram when bot token/chat id are absent", async () => {
    const tg = makeTelegramService();
    const { params } = baseParams({
      telegramService: tg.service,
      settings: null,
    });

    await createEscalation(params as never);

    expect(tg.calls).toHaveLength(0);
  });
});
