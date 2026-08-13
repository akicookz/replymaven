import { describe, expect, test } from "bun:test";
import { type ProjectSettingsRow } from "../../../db";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../../shared/maven-conversation";
import { type PublicConversationStore } from "../../../conversations/public-conversation-store";
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

interface TestHarness {
  context: MavenTurnContext;
  conversation: TestConversation;
  ownershipClaims: number;
  teamRequestNotifications: number;
  reviewSummaries: string[];
  telegramSummaries: string[];
  telegramUpdates: boolean[];
  telegramAttempts: number;
  telegramThreadPersistenceAttempts: number;
  broadcasts: PublicMessageRecord[];
  systemMessageIds: Set<string>;
  failOwnershipClaim: boolean;
  humanTakesOwnershipAfterClaim: boolean;
  parsedHumanOwnershipAfterClaim: boolean;
  failEscalationUpdate: boolean;
  throwEscalationUpdate: boolean;
  failTelegramThreadUpdate: boolean;
  clearContactBeforeClaim: boolean;
  escalationUpdateCalls: number;
  throwEscalationUpdateOnCall: number | null;
  notificationClaims: number;
  notificationClaimed: boolean;
  throwNotificationClaimOnce: boolean;
  throwTelegramNotification: boolean;
  rejectExternalActionOnce: boolean;
  pauseAcceptedRequestReadOnce: boolean;
  acceptedRequestReadReached: Deferred;
  releaseAcceptedRequestRead: Deferred;
  summaryInsertTokens: string[];
  threadPersistenceTokens: string[];
  pendingContactWrites: Array<{
    fields: Array<"name" | "email">;
    ownership: { status: string; chatState: string | null };
  }>;
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

function createMessage(content: string): PublicMessageRecord {
  return {
    id: "review-summary-1",
    conversationId: "conversation-1",
    author: "system",
    content,
    sources: [],
    imageUrls: [],
    systemKind: "review_summary",
    senderName: null,
    senderAvatar: null,
    userId: null,
    createdAt: 0,
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
  };
}

function publicConversationSnapshot(
  conversation: TestConversation,
): PublicConversationRecord {
  return {
    ...conversation,
    metadata: conversation.metadata ? JSON.parse(conversation.metadata) : {},
    chatState: conversation.chatState ? JSON.parse(conversation.chatState) : {},
    closeReason: null,
    lastActivityAt: 0,
    visitorLastSeenAt: null,
    visitorPresence: "active",
    visitorLastOnlineAt: null,
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    externalActionStartedAt: null,
    priority: "medium",
    assigneeId: null,
    createdAt: 0,
    updatedAt: 0,
    ownershipRevision: 0,
  } as PublicConversationRecord;
}

function createHarness(options: {
  channel?: MavenTurnContext["channel"];
  conversation?: Partial<TestConversation>;
  failOwnershipClaim?: boolean;
  humanTakesOwnershipAfterClaim?: boolean;
  parsedHumanOwnershipAfterClaim?: boolean;
  failEscalationUpdate?: boolean;
  throwEscalationUpdate?: boolean;
  failTelegramThreadUpdate?: boolean;
  clearContactBeforeClaim?: boolean;
  throwEscalationUpdateOnCall?: number;
  throwTelegramNotification?: boolean;
  throwNotificationClaimOnce?: boolean;
  rejectExternalActionOnce?: boolean;
  pauseAcceptedRequestReadOnce?: boolean;
} = {}): {
  harness: TestHarness;
  definition: ReturnType<typeof createRequestTeamHelpTool>;
  chatService: PublicConversationStore;
} {
  const harness: TestHarness = {
    context: createContext(options.channel ?? "public"),
    conversation: createConversation(options.conversation),
    ownershipClaims: 0,
    teamRequestNotifications: 0,
    reviewSummaries: [],
    telegramSummaries: [],
    telegramUpdates: [],
    telegramAttempts: 0,
    telegramThreadPersistenceAttempts: 0,
    broadcasts: [],
    systemMessageIds: new Set(),
    failOwnershipClaim: options.failOwnershipClaim ?? false,
    humanTakesOwnershipAfterClaim:
      options.humanTakesOwnershipAfterClaim ?? false,
    parsedHumanOwnershipAfterClaim:
      options.parsedHumanOwnershipAfterClaim ?? false,
    failEscalationUpdate: options.failEscalationUpdate ?? false,
    throwEscalationUpdate: options.throwEscalationUpdate ?? false,
    failTelegramThreadUpdate: options.failTelegramThreadUpdate ?? false,
    clearContactBeforeClaim: options.clearContactBeforeClaim ?? false,
    escalationUpdateCalls: 0,
    throwEscalationUpdateOnCall:
      options.throwEscalationUpdateOnCall ?? null,
    notificationClaims: 0,
    notificationClaimed: false,
    throwNotificationClaimOnce: options.throwNotificationClaimOnce ?? false,
    throwTelegramNotification: options.throwTelegramNotification ?? false,
    rejectExternalActionOnce: options.rejectExternalActionOnce ?? false,
    pauseAcceptedRequestReadOnce:
      options.pauseAcceptedRequestReadOnce ?? false,
    acceptedRequestReadReached: createDeferred(),
    releaseAcceptedRequestRead: createDeferred(),
    summaryInsertTokens: [],
    threadPersistenceTokens: [],
    pendingContactWrites: [],
  };

  const chatService = {
    async getOperational(projectId: string, conversationId: string) {
      if (
        conversationId !== harness.conversation.id ||
        projectId !== harness.conversation.projectId
      ) {
        return null;
      }
      return publicConversationSnapshot(harness.conversation);
    },
    async updatePendingTeamRequestContact(
      _projectId: string,
      _conversationId: string,
      ownership: { status: string; chatState: string | null },
      update: { awaitingContactFields: Array<"name" | "email"> },
    ) {
      harness.pendingContactWrites.push({
        fields: update.awaitingContactFields,
        ownership,
      });
      const current = harness.conversation.chatState
        ? JSON.parse(harness.conversation.chatState)
        : {};
      harness.conversation.chatState = JSON.stringify({
        ...current,
        awaitingContactFields: update.awaitingContactFields,
      });
      return publicConversationSnapshot(harness.conversation);
    },
    async claimTeamRequest(input: {
      projectId: string;
      conversationId: string;
      summary: string;
    }) {
      const { conversationId, projectId, summary } = input;
      harness.ownershipClaims += 1;
      if (harness.clearContactBeforeClaim) {
        harness.conversation.visitorEmail = null;
        harness.clearContactBeforeClaim = false;
      }
      const authoritativeMissingFields = [
        ...(harness.conversation.visitorName?.trim() ? [] : ["name" as const]),
        ...(harness.conversation.visitorEmail?.trim() ? [] : ["email" as const]),
      ];
      const authoritativeState = harness.conversation.chatState
        ? JSON.parse(harness.conversation.chatState)
        : {};
      if (
        authoritativeMissingFields.length > 0 &&
        authoritativeState.contactDeclined !== true
      ) {
        return {
          status: "contact_required" as const,
          requiredFields: authoritativeMissingFields,
        };
      }
      if (
        harness.failOwnershipClaim ||
        conversationId !== harness.conversation.id ||
        projectId !== harness.conversation.projectId ||
        harness.conversation.status !== "active"
      ) {
        if (
          harness.conversation.status === "waiting_agent" ||
          harness.conversation.status === "agent_replied"
        ) {
          return { status: "already_requested" as const };
        }
        return { status: "unavailable" as const };
      }
      harness.conversation.status = "waiting_agent";
      harness.conversation.chatState = JSON.stringify({
        aiParticipation: "assist_until_agent",
        contactDeclined: false,
      });
      const acceptedAt = new Date().toISOString();
      const acceptanceToken = crypto.randomUUID();
      harness.conversation.metadata = JSON.stringify({
        ...(harness.conversation.metadata
          ? JSON.parse(harness.conversation.metadata)
          : {}),
        teamRequestSummary: summary,
        escalatedAt: acceptedAt,
        reviewSummaryMessageId: crypto.randomUUID(),
        teamRequestSummaryPending: true,
        teamRequestNotificationState: "pending",
        mavenTeamRequestAcceptedAt: acceptedAt,
        mavenTeamRequestAcceptanceToken: acceptanceToken,
      });
      if (harness.humanTakesOwnershipAfterClaim) {
        harness.conversation.status = "agent_replied";
        harness.conversation.chatState = JSON.stringify({
          aiParticipation: "human_only",
          contactDeclined: false,
        });
      } else if (harness.parsedHumanOwnershipAfterClaim) {
        harness.conversation.chatState = JSON.stringify({
          aiParticipation: "human_only",
          contactDeclined: false,
        });
      }
      return { status: "claimed" as const };
    },
    async appendSystem(input: {
      content: string;
      idempotencyKey?: string;
    }) {
      const messageId = input.idempotencyKey ?? "review-summary-1";
      if (harness.systemMessageIds.has(messageId)) return null;
      harness.systemMessageIds.add(messageId);
      harness.reviewSummaries.push(input.content);
      return { ...createMessage(input.content), id: messageId };
    },
    async getTeamRequestAcceptance(
      _projectId: string,
      _conversationId: string,
      acceptanceToken: string,
    ) {
      const metadata = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      if (metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken) {
        return null;
      }
      const snapshot = {
        acceptanceToken,
        acceptedAt: metadata.mavenTeamRequestAcceptedAt as string,
        notificationState: metadata.teamRequestNotificationState as string,
        summary: metadata.teamRequestSummary as string,
        summaryMessageId: metadata.reviewSummaryMessageId as string,
        summaryPending: metadata.teamRequestSummaryPending === true,
      };
      if (harness.pauseAcceptedRequestReadOnce) {
        harness.pauseAcceptedRequestReadOnce = false;
        harness.acceptedRequestReadReached.resolve();
        await harness.releaseAcceptedRequestRead.promise;
      }
      return snapshot;
    },
    async addTeamRequestSummary(
      _projectId: string,
      _conversationId: string,
      acceptanceToken: string,
    ) {
      const metadata = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      if (
        metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken ||
        metadata.teamRequestSummaryPending !== true
      ) {
        return null;
      }
      harness.summaryInsertTokens.push(acceptanceToken);
      const messageId = metadata.reviewSummaryMessageId as string;
      if (harness.systemMessageIds.has(messageId)) return null;
      harness.systemMessageIds.add(messageId);
      const summary = metadata.teamRequestSummary as string;
      harness.reviewSummaries.push(summary);
      const message = createMessage(summary);
      return { ...message, id: messageId };
    },
    async completeTeamRequestSummary(input: {
      acceptanceToken: string;
    }) {
      const { acceptanceToken } = input;
      const metadata = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      if (metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken) {
        return false;
      }
      metadata.teamRequestSummaryPending = false;
      harness.conversation.metadata = JSON.stringify(metadata);
      return true;
    },
    async updateLegacyEscalationMetadata(
      _projectId: string,
      _conversationId: string,
      data: {
        expectedMavenAcceptanceToken: string | null;
        summary: string;
        summaryMessageId: string;
        escalatedAt?: string;
        summaryPending?: boolean;
      },
    ) {
      harness.escalationUpdateCalls += 1;
      if (
        harness.throwEscalationUpdateOnCall ===
        harness.escalationUpdateCalls
      ) {
        throw new Error("metadata completion write failed");
      }
      if (harness.throwEscalationUpdate) {
        harness.throwEscalationUpdate = false;
        throw new Error("metadata write failed");
      }
      if (harness.failEscalationUpdate) return null;
      const existing = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      const currentAcceptanceToken =
        typeof existing.mavenTeamRequestAcceptanceToken === "string"
          ? existing.mavenTeamRequestAcceptanceToken
          : null;
      if (currentAcceptanceToken !== data.expectedMavenAcceptanceToken) {
        return null;
      }
      harness.conversation.metadata = JSON.stringify({
        ...existing,
        teamRequestSummary: data.summary,
        reviewSummaryMessageId: data.summaryMessageId,
        ...(data.escalatedAt ? { escalatedAt: data.escalatedAt } : {}),
        ...(data.summaryPending === undefined
          ? {}
          : { teamRequestSummaryPending: data.summaryPending }),
      });
      return publicConversationSnapshot(harness.conversation);
    },
    async acquireExternalAction(input: {
      projectId: string;
      conversationId: string;
    }) {
      if (harness.rejectExternalActionOnce) {
        harness.rejectExternalActionOnce = false;
        return null;
      }
      return {
        ...input,
        leaseId: "lease-1",
        ownershipRevision: 0,
        acquiredAt: Date.now(),
      };
    },
    async releaseExternalAction() {},
    async updateTelegramThreadId(
      _projectId: string,
      _conversationId: string,
      threadId: string,
    ) {
      harness.telegramThreadPersistenceAttempts += 1;
      if (harness.failTelegramThreadUpdate) {
        harness.failTelegramThreadUpdate = false;
        throw new Error("thread persistence failed");
      }
      harness.conversation.telegramThreadId = threadId;
    },
    async persistTeamRequestTelegramThreadId(
      _projectId: string,
      _conversationId: string,
      acceptanceToken: string,
      threadId: string,
    ) {
      harness.telegramThreadPersistenceAttempts += 1;
      if (harness.failTelegramThreadUpdate) {
        harness.failTelegramThreadUpdate = false;
        throw new Error("thread persistence failed");
      }
      const metadata = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      if (
        metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken
      ) {
        return false;
      }
      harness.threadPersistenceTokens.push(acceptanceToken);
      harness.conversation.telegramThreadId = threadId;
      return true;
    },
    async claimTeamRequestNotification(
      _projectId: string,
      _conversationId: string,
      acceptanceToken: string,
    ) {
      harness.notificationClaims += 1;
      if (harness.throwNotificationClaimOnce) {
        harness.throwNotificationClaimOnce = false;
        throw new Error("notification preflight failed");
      }
      if (harness.notificationClaimed) return false;
      harness.notificationClaimed = true;
      const metadata = harness.conversation.metadata
        ? JSON.parse(harness.conversation.metadata)
        : {};
      if (metadata.mavenTeamRequestAcceptanceToken !== acceptanceToken) {
        return false;
      }
      harness.conversation.metadata = JSON.stringify({
        ...metadata,
        teamRequestNotificationState: "attempted",
      });
      return true;
    },
  } as unknown as PublicConversationStore;

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
      params: { summary: string; isUpdate: boolean },
    ) {
      harness.telegramAttempts += 1;
      if (harness.throwTelegramNotification) {
        throw new Error("Telegram unavailable");
      }
      harness.telegramSummaries.push(params.summary);
      harness.telegramUpdates.push(params.isUpdate);
      return 123;
    },
  } as unknown as TelegramService;
  const executionCtx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;

  return {
    harness,
    chatService,
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
    expect(harness.pendingContactWrites).toEqual([
      {
        fields: ["name", "email"],
        ownership: {
          status: "active",
          chatState: JSON.stringify({
            aiParticipation: "continuous",
            contactDeclined: false,
          }),
        },
      },
    ]);
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

  test("does not repair an unrelated pre-existing waiting handoff", async () => {
    const { harness, definition } = createHarness({
      conversation: {
        status: "waiting_agent",
        chatState: JSON.stringify({
          aiParticipation: "assist_until_agent",
          contactDeclined: false,
        }),
        metadata: null,
        telegramThreadId: "999",
      },
    });

    const result = await executePublicTool(definition, harness.context, {
      summary: "A later request should not create another notification.",
    });

    expect(result.status).toBe("requested");
    expect(harness.reviewSummaries).toEqual([]);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("concurrent stale repairs claim one external notification attempt", async () => {
    const acceptedAt = new Date().toISOString();
    const summary = "Visitor needs a refund on order 123.";
    const { harness, definition } = createHarness({
      conversation: {
        status: "waiting_agent",
        chatState: JSON.stringify({
          aiParticipation: "assist_until_agent",
          contactDeclined: false,
        }),
        metadata: JSON.stringify({
          teamRequestSummary: summary,
          escalatedAt: acceptedAt,
          reviewSummaryMessageId: "repair-summary-1",
          teamRequestSummaryPending: true,
          mavenTeamRequestAcceptedAt: acceptedAt,
          mavenTeamRequestAcceptanceToken: "repair-generation",
          teamRequestNotificationState: "pending",
        }),
      },
    });

    const results = await Promise.all([
      executePublicTool(definition, harness.context, { summary: "stale A" }),
      executePublicTool(definition, harness.context, { summary: "stale B" }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "requested",
      "requested",
    ]);
    expect(harness.notificationClaims).toBe(2);
    expect(harness.reviewSummaries).toEqual([summary]);
    expect(harness.telegramSummaries).toEqual([summary]);
  });

  test("a paused prior-generation repair cannot mutate or notify the new generation", async () => {
    const oldAcceptedAt = "2026-08-09T00:00:00.000Z";
    const { harness, definition, chatService } = createHarness({
      pauseAcceptedRequestReadOnce: true,
      conversation: {
        status: "waiting_agent",
        chatState: JSON.stringify({
          aiParticipation: "assist_until_agent",
          contactDeclined: false,
        }),
        metadata: JSON.stringify({
          teamRequestSummary: "Old accepted summary.",
          escalatedAt: oldAcceptedAt,
          reviewSummaryMessageId: "old-message",
          teamRequestSummaryPending: true,
          teamRequestNotificationState: "pending",
          mavenTeamRequestAcceptedAt: oldAcceptedAt,
          mavenTeamRequestAcceptanceToken: "old-generation",
        }),
      },
    });

    const oldRepair = executePublicTool(definition, harness.context, {
      summary: "stale model summary",
    });
    await harness.acceptedRequestReadReached.promise;

    harness.conversation.status = "active";
    harness.conversation.chatState = JSON.stringify({
      aiParticipation: "continuous",
      contactDeclined: false,
    });
    expect(
      await chatService.claimTeamRequest({
        conversationId: harness.conversation.id,
        projectId: harness.conversation.projectId,
        summary: "New accepted summary.",
      }),
    ).toEqual({ status: "claimed" });
    const newAcceptance = JSON.parse(harness.conversation.metadata ?? "{}");
    harness.releaseAcceptedRequestRead.resolve();
    expect((await oldRepair).status).toBe("requested");

    const afterOldRepair = JSON.parse(harness.conversation.metadata ?? "{}");
    expect(afterOldRepair).toMatchObject({
      teamRequestSummary: "New accepted summary.",
      reviewSummaryMessageId: newAcceptance.reviewSummaryMessageId,
      teamRequestSummaryPending: true,
      teamRequestNotificationState: "pending",
      mavenTeamRequestAcceptanceToken:
        newAcceptance.mavenTeamRequestAcceptanceToken,
    });
    expect(harness.summaryInsertTokens).toEqual([]);
    expect(harness.notificationClaims).toBe(0);
    expect(harness.telegramSummaries).toEqual([]);
    expect(harness.threadPersistenceTokens).toEqual([]);

    const newRepair = await executePublicTool(definition, harness.context, {
      summary: "later model summary",
    });
    expect(newRepair.status).toBe("requested");
    expect(harness.reviewSummaries).toEqual(["New accepted summary."]);
    expect(harness.telegramSummaries).toEqual(["New accepted summary."]);
    expect(harness.summaryInsertTokens).toEqual([
      newAcceptance.mavenTeamRequestAcceptanceToken,
    ]);
    expect(harness.threadPersistenceTokens).toEqual([
      newAcceptance.mavenTeamRequestAcceptanceToken,
    ]);
    expect(harness.conversation.telegramThreadId).toBe("123");
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
      "requested",
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
      status: "requested",
      visitorMessage:
        "This is already with an engineer and they'll continue the follow-up there.",
    });
    expect(harness.ownershipClaims).toBe(1);
    expect(harness.teamRequestNotifications).toBe(0);
    expect(harness.reviewSummaries).toEqual([]);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("treats parsed human-only ownership as already forwarded even with active status", async () => {
    const { harness, definition } = createHarness({
      conversation: {
        status: "active",
        chatState: JSON.stringify({
          aiParticipation: "human_only",
          contactDeclined: false,
        }),
      },
    });

    const result = await executePublicTool(definition, harness.context, {
      summary: "Visitor needs a refund on order 123.",
    });

    expect(result).toEqual({
      status: "requested",
      visitorMessage:
        "This is already with an engineer and they'll continue the follow-up there.",
    });
    expect(harness.ownershipClaims).toBe(0);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("suppresses side effects when parsed human ownership wins after the claim", async () => {
    const { harness, definition } = createHarness({
      parsedHumanOwnershipAfterClaim: true,
    });

    const result = await executePublicTool(definition, harness.context, {
      summary: "Visitor needs a refund on order 123.",
    });

    expect(result).toEqual({
      status: "requested",
      visitorMessage:
        "This is already with an engineer and they'll continue the follow-up there.",
    });
    expect(harness.teamRequestNotifications).toBe(0);
    expect(harness.reviewSummaries).toEqual([]);
    expect(harness.telegramSummaries).toEqual([]);
  });

  test("keeps accepted ownership monotonic and repairs a failed metadata write", async () => {
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
      status: "requested",
      visitorMessage:
        "I've passed this along and an engineer will follow up with you shortly.",
    });
    harness.failEscalationUpdate = false;
    const retry = await executePublicTool(definition, harness.context, {
      summary: "Visitor needs a refund on order 123.",
    });
    expect(retry.status).toBe("requested");
    expect(harness.reviewSummaries).toHaveLength(1);
    expect(harness.telegramSummaries).toHaveLength(1);
  });

  test("repairs a thrown metadata write without repeating external effects", async () => {
    const { harness, definition } = createHarness({
      throwEscalationUpdate: true,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    const retry = await executePublicTool(definition, harness.context, input);

    expect(first.status).toBe("requested");
    expect(retry.status).toBe("requested");
    expect(harness.reviewSummaries).toHaveLength(1);
    expect(harness.telegramSummaries).toHaveLength(1);
  });

  test("retries a thrown summary-completion write with the same review message", async () => {
    const { harness, definition } = createHarness({
      throwEscalationUpdateOnCall: 2,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    const retry = await executePublicTool(definition, harness.context, input);

    expect(first.status).toBe("requested");
    expect(retry.status).toBe("requested");
    expect(harness.reviewSummaries).toEqual([input.summary]);
    expect(harness.telegramSummaries).toEqual([input.summary]);
  });

  test("retries a returned thread ID without duplicating Telegram", async () => {
    const { harness, definition } = createHarness({
      failTelegramThreadUpdate: true,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    const retry = await executePublicTool(definition, harness.context, input);

    expect(first.status).toBe("requested");
    expect(retry.status).toBe("requested");
    expect(harness.telegramSummaries).toHaveLength(1);
    expect(harness.telegramThreadPersistenceAttempts).toBe(2);
    expect(harness.conversation.telegramThreadId).toBe("123");
  });

  test("retries a known-unsent notification preflight failure", async () => {
    const { harness, definition } = createHarness({
      throwNotificationClaimOnce: true,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    expect(first.status).toBe("requested");
    expect(harness.telegramAttempts).toBe(0);

    const retry = await executePublicTool(definition, harness.context, input);
    expect(retry.status).toBe("requested");
    expect(harness.notificationClaims).toBe(2);
    expect(harness.telegramAttempts).toBe(1);
    expect(harness.telegramSummaries).toEqual([input.summary]);
    expect(harness.telegramUpdates).toEqual([false]);
  });

  test("keeps notification pending when the external-action lease rejects", async () => {
    const { harness, definition } = createHarness({
      rejectExternalActionOnce: true,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    expect(first.status).toBe("requested");
    expect(harness.notificationClaims).toBe(0);
    expect(harness.telegramAttempts).toBe(0);

    const retry = await executePublicTool(definition, harness.context, input);
    expect(retry.status).toBe("requested");
    expect(harness.notificationClaims).toBe(1);
    expect(harness.telegramAttempts).toBe(1);
    expect(harness.telegramSummaries).toEqual([input.summary]);
  });

  test("does not repeat an external attempt after Telegram throws", async () => {
    const { harness, definition } = createHarness({
      throwTelegramNotification: true,
    });
    const input = { summary: "Visitor needs a refund on order 123." };

    const first = await executePublicTool(definition, harness.context, input);
    const retry = await executePublicTool(definition, harness.context, input);

    expect(first.status).toBe("requested");
    expect(retry.status).toBe("requested");
    expect(harness.telegramAttempts).toBe(1);
    expect(harness.notificationClaims).toBe(1);
  });

  test("returns contact_required when saved contact is cleared before the claim", async () => {
    const { harness, definition } = createHarness({
      clearContactBeforeClaim: true,
    });

    const result = await executePublicTool(definition, harness.context, {
      summary: "Visitor needs a refund on order 123.",
    });

    expect(result).toEqual({
      status: "contact_required",
      requiredFields: ["email"],
    });
    expect(harness.conversation.status).toBe("active");
    expect(harness.teamRequestNotifications).toBe(0);
    expect(harness.telegramSummaries).toEqual([]);
  });
});
