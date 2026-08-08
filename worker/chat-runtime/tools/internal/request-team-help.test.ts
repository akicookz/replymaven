import { describe, expect, test } from "bun:test";
import { type MessageRow, type ProjectSettingsRow } from "../../../db";
import { type ChatService } from "../../../services/chat-service";
import { type ProjectService } from "../../../services/project-service";
import { type TelegramService } from "../../../services/telegram-service";
import { buildMavenToolRegistry } from "../build-maven-tool-registry";
import { type MavenTurnContext } from "../../types";
import {
  createRequestTeamHelpTool,
  type RequestTeamHelpResult,
} from "./request-team-help";

interface TestConversation {
  id: string;
  projectId: string;
  customerId: string | null;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  telegramThreadId: string | null;
  status: string;
  chatState: string | null;
  metadata: string | null;
}

interface TestHarness {
  context: MavenTurnContext;
  conversation: TestConversation;
  ownershipClaims: number;
  teamRequestNotifications: number;
  reviewSummaries: string[];
  telegramSummaries: string[];
  broadcasts: MessageRow[];
  failOwnershipClaim: boolean;
  humanTakesOwnershipAfterClaim: boolean;
  failEscalationUpdate: boolean;
}

function createContext(channel: MavenTurnContext["channel"]): MavenTurnContext {
  return {
    channel,
    projectId: "project-1",
    conversationId: "conversation-1",
    actorUserId: null,
    customerId: "customer-1",
    ownership: {
      status: "active",
      chatState: JSON.stringify({
        aiParticipation: "continuous",
        contactDeclined: false,
      }),
    },
  };
}

function createConversation(
  overrides: Partial<TestConversation> = {},
): TestConversation {
  return {
    id: "conversation-1",
    projectId: "project-1",
    customerId: "customer-1",
    visitorId: "visitor-1",
    visitorName: "Alice",
    visitorEmail: "alice@example.com",
    telegramThreadId: null,
    status: "active",
    chatState: JSON.stringify({
      aiParticipation: "continuous",
      contactDeclined: false,
    }),
    metadata: null,
    ...overrides,
  };
}

function createMessage(content: string): MessageRow {
  return {
    id: "review-summary-1",
    conversationId: "conversation-1",
    role: "system",
    content,
    sources: JSON.stringify({ systemKind: "review_summary" }),
    imageUrl: null,
    senderName: null,
    senderAvatar: null,
    userId: null,
    createdAt: new Date(0),
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
  };
}

function createHarness(options: {
  channel?: MavenTurnContext["channel"];
  conversation?: Partial<TestConversation>;
  failOwnershipClaim?: boolean;
  humanTakesOwnershipAfterClaim?: boolean;
  failEscalationUpdate?: boolean;
} = {}): {
  harness: TestHarness;
  definition: ReturnType<typeof createRequestTeamHelpTool>;
} {
  const harness: TestHarness = {
    context: createContext(options.channel ?? "public"),
    conversation: createConversation(options.conversation),
    ownershipClaims: 0,
    teamRequestNotifications: 0,
    reviewSummaries: [],
    telegramSummaries: [],
    broadcasts: [],
    failOwnershipClaim: options.failOwnershipClaim ?? false,
    humanTakesOwnershipAfterClaim:
      options.humanTakesOwnershipAfterClaim ?? false,
    failEscalationUpdate: options.failEscalationUpdate ?? false,
  };

  const chatService = {
    async getOperationalConversationById(
      conversationId: string,
      projectId: string,
    ) {
      if (
        conversationId !== harness.conversation.id ||
        projectId !== harness.conversation.projectId
      ) {
        return null;
      }
      return { ...harness.conversation };
    },
    async claimTeamRequest(conversationId: string, projectId: string) {
      harness.ownershipClaims += 1;
      if (
        harness.failOwnershipClaim ||
        conversationId !== harness.conversation.id ||
        projectId !== harness.conversation.projectId ||
        (harness.conversation.status !== "active" &&
          harness.conversation.status !== "waiting_agent")
      ) {
        return false;
      }
      harness.conversation.status = "waiting_agent";
      harness.conversation.chatState = JSON.stringify({
        aiParticipation: "assist_until_agent",
        contactDeclined: false,
      });
      if (harness.humanTakesOwnershipAfterClaim) {
        harness.conversation.status = "agent_replied";
        harness.conversation.chatState = JSON.stringify({
          aiParticipation: "human_only",
          contactDeclined: false,
        });
      }
      return true;
    },
    async claimNewTeamRequest(conversationId: string, projectId: string) {
      harness.ownershipClaims += 1;
      if (
        harness.failOwnershipClaim ||
        conversationId !== harness.conversation.id ||
        projectId !== harness.conversation.projectId ||
        harness.conversation.status !== "active"
      ) {
        return false;
      }
      harness.conversation.status = "waiting_agent";
      harness.conversation.chatState = JSON.stringify({
        aiParticipation: "assist_until_agent",
        contactDeclined: false,
      });
      if (harness.humanTakesOwnershipAfterClaim) {
        harness.conversation.status = "agent_replied";
        harness.conversation.chatState = JSON.stringify({
          aiParticipation: "human_only",
          contactDeclined: false,
        });
      }
      return true;
    },
    async addSystemMessage(
      _conversationId: string,
      _kind: string,
      content: string,
    ) {
      harness.reviewSummaries.push(content);
      return createMessage(content);
    },
    async updateConversation(
      _conversationId: string,
      _projectId: string,
      data: { metadata?: string },
    ) {
      if (harness.failEscalationUpdate) return null;
      if (data.metadata) {
        harness.conversation.metadata = data.metadata;
      }
      return { ...harness.conversation };
    },
    async runExternalActionIfOperational<T>(
      _conversationId: string,
      _projectId: string,
      action: () => Promise<T>,
    ) {
      return { executed: true, value: await action() };
    },
    async updateTelegramThreadId(
      _conversationId: string,
      _projectId: string,
      threadId: string,
    ) {
      harness.conversation.telegramThreadId = threadId;
    },
  } as unknown as ChatService;

  const settings = {
    telegramBotToken: "telegram-token",
    telegramChatId: "telegram-chat",
    agentName: "an engineer",
  } as ProjectSettingsRow;
  const projectService = {
    async getProjectById(projectId: string) {
      return projectId === "project-1"
        ? { id: "project-1", name: "Acme" }
        : null;
    },
    async getSettings(projectId: string) {
      return projectId === "project-1" ? settings : null;
    },
    async getOwnerEmail() {
      return null;
    },
  } as unknown as ProjectService;
  const telegramService = {
    async notifyEscalation(
      _botToken: string,
      _chatId: string,
      params: { summary: string },
    ) {
      harness.telegramSummaries.push(params.summary);
      return 123;
    },
  } as unknown as TelegramService;
  const executionCtx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;

  return {
    harness,
    definition: createRequestTeamHelpTool({
      context: harness.context,
      chatService,
      projectService,
      telegramService,
      env: {
        BETTER_AUTH_URL: "https://app.test",
      },
      executionCtx,
      onTeamRequested() {
        harness.teamRequestNotifications += 1;
      },
      broadcast(message) {
        harness.broadcasts.push(message);
      },
    }),
  };
}

async function executePublicTool(
  definition: ReturnType<typeof createRequestTeamHelpTool>,
  context: MavenTurnContext,
  input: unknown,
): Promise<RequestTeamHelpResult> {
  const registry = buildMavenToolRegistry({
    context,
    definitions: [definition],
  });
  const registered = registry.tools.request_team_help;
  if (!registered || typeof registered.execute !== "function") {
    throw new Error("Expected request_team_help to be executable");
  }
  return registered.execute(input, {
    toolCallId: "team-help-call",
    messages: [],
  }) as Promise<RequestTeamHelpResult>;
}

describe("createRequestTeamHelpTool", () => {
  test("is explicitly public-only and accepts only a bounded summary", () => {
    const publicHarness = createHarness();
    const sidechatHarness = createHarness({ channel: "sidechat" });
    const publicRegistry = buildMavenToolRegistry({
      context: publicHarness.harness.context,
      definitions: [publicHarness.definition],
    });
    const sidechatRegistry = buildMavenToolRegistry({
      context: sidechatHarness.harness.context,
      definitions: [sidechatHarness.definition],
    });
    const schema = publicHarness.definition.inputSchema as {
      safeParse(input: unknown): { success: boolean };
    };

    expect(publicHarness.definition.capability.allowedChannels).toEqual([
      "public",
    ]);
    expect(Object.keys(publicRegistry.tools)).toEqual(["request_team_help"]);
    expect(Object.keys(sidechatRegistry.tools)).toEqual([]);
    expect(schema.safeParse({ summary: "Refund requested." }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({ summary: "x".repeat(701) }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        summary: "Refund requested.",
        conversationId: "model-controlled",
      }).success,
    ).toBe(false);
  });

  test("returns required contact fields without changing ownership", async () => {
    const { harness, definition } = createHarness({
      conversation: {
        visitorName: null,
        visitorEmail: null,
      },
    });

    const result = await executePublicTool(
      definition,
      harness.context,
      { summary: "Visitor needs account help." },
    );

    expect(result).toEqual({
      status: "contact_required",
      requiredFields: ["name", "email"],
    });
    expect(harness.conversation.status).toBe("active");
    expect(harness.ownershipClaims).toBe(0);
    expect(harness.teamRequestNotifications).toBe(0);
    expect(harness.reviewSummaries).toEqual([]);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("claims ownership and delegates one successful escalation", async () => {
    const { harness, definition } = createHarness();

    const result = await executePublicTool(
      definition,
      harness.context,
      { summary: "Visitor needs a refund on order 123." },
    );

    expect(result).toEqual({
      status: "requested",
      visitorMessage:
        "I've passed this along and an engineer will follow up with you shortly.",
    });
    expect(harness.conversation.status).toBe("waiting_agent");
    expect(harness.ownershipClaims).toBe(1);
    expect(harness.teamRequestNotifications).toBe(1);
    expect(harness.reviewSummaries).toEqual([
      "Visitor needs a refund on order 123.",
    ]);
    expect(harness.telegramSummaries).toEqual([
      "Visitor needs a refund on order 123.",
    ]);
    expect(harness.conversation.telegramThreadId).toBe("123");
  });

  test("returns the existing handoff without repeating its side effects", async () => {
    const { harness, definition } = createHarness();
    const input = { summary: "Visitor needs a refund on order 123." };

    await executePublicTool(definition, harness.context, input);
    const repeated = await executePublicTool(
      definition,
      harness.context,
      input,
    );

    expect(repeated).toEqual({
      status: "requested",
      visitorMessage:
        "This is already with an engineer and they'll continue the follow-up there.",
    });
    expect(harness.ownershipClaims).toBe(1);
    expect(harness.teamRequestNotifications).toBe(1);
    expect(harness.reviewSummaries).toHaveLength(1);
    expect(harness.telegramSummaries).toHaveLength(1);
  });

  test("concurrent repeated calls produce only one escalation side effect", async () => {
    const { harness, definition } = createHarness();
    const input = { summary: "Visitor needs a refund on order 123." };

    const results = await Promise.all([
      executePublicTool(definition, harness.context, input),
      executePublicTool(definition, harness.context, input),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "requested",
      "unavailable",
    ]);
    expect(harness.ownershipClaims).toBe(2);
    expect(harness.teamRequestNotifications).toBe(1);
    expect(harness.reviewSummaries).toHaveLength(1);
    expect(harness.telegramSummaries).toHaveLength(1);
  });

  test("rechecks authoritative ownership before Telegram side effects", async () => {
    const { harness, definition } = createHarness({
      humanTakesOwnershipAfterClaim: true,
    });

    const result = await executePublicTool(
      definition,
      harness.context,
      { summary: "Visitor needs a refund on order 123." },
    );

    expect(result).toEqual({
      status: "unavailable",
      visitorMessage:
        "I couldn't forward that to the team just now. I can keep helping here, or you can try again in a moment.",
    });
    expect(harness.ownershipClaims).toBe(1);
    expect(harness.teamRequestNotifications).toBe(0);
    expect(harness.reviewSummaries).toEqual([]);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("does not claim success when the escalation write becomes unavailable", async () => {
    const { harness, definition } = createHarness({
      conversation: { metadata: JSON.stringify({ source: "widget" }) },
      failEscalationUpdate: true,
    });

    const result = await executePublicTool(
      definition,
      harness.context,
      { summary: "Visitor needs a refund on order 123." },
    );

    expect(result).toEqual({
      status: "unavailable",
      visitorMessage:
        "I couldn't forward that to the team just now. I can keep helping here, or you can try again in a moment.",
    });
    expect(harness.telegramSummaries).toEqual([]);
  });
});
