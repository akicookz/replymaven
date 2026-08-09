import { describe, expect, test } from "bun:test";
import type { MessageRow } from "../db";
import {
  buildTrustedDefaultSidechatMessage,
  canAccessSidechatProject,
  handleCreateSidechatMessage,
  handleGetSidechatHistory,
  handleRetrySidechatTurn,
  type SidechatHandlerService,
} from "./sidechat-handlers";

const now = new Date("2026-08-09T12:00:00.000Z");

interface TestConversation {
  id: string;
  projectId: string;
  customerId: string | null;
  visitorName: string | null;
  archivedAt: Date | null;
  status: "active" | "waiting_agent" | "agent_replied" | "closed";
  chatState: string | null;
  lastActivityAt: Date;
  sidechatStatus: "idle" | "working" | "waiting_approval" | "ready" | "failed";
  sidechatRunId: string | null;
  sidechatLeaseExpiresAt: Date | null;
}

function makeConversation(
  overrides: Partial<TestConversation> = {},
): TestConversation {
  return {
    id: "conversation-1",
    projectId: "project-1",
    customerId: "customer-1",
    visitorName: "Conversation Alice",
    archivedAt: null,
    status: "waiting_agent",
    chatState: '{"aiParticipation":"human_only"}',
    lastActivityAt: new Date("2026-08-09T10:00:00.000Z"),
    sidechatStatus: "idle",
    sidechatRunId: null,
    sidechatLeaseExpiresAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "sidechat-human-1",
    conversationId: "conversation-1",
    role: "agent",
    content: "Please help me draft a reply.",
    channel: "sidechat",
    kind: "text",
    metadata: null,
    imageUrl: null,
    sources: null,
    senderName: "Agent Kim",
    senderAvatar: "https://private.example/avatar.png",
    userId: "user-private",
    createdAt: now,
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
    ...overrides,
  };
}

class MemorySidechatService implements SidechatHandlerService {
  conversation = makeConversation();
  messages: MessageRow[] = [];
  calls: string[] = [];
  settlementTimes: Array<Date | undefined> = [];
  allowClaim = true;

  async getConversationById(): Promise<TestConversation> {
    this.calls.push("conversation");
    if (
      this.conversation.sidechatStatus === "working" &&
      this.conversation.sidechatLeaseExpiresAt &&
      this.conversation.sidechatLeaseExpiresAt.getTime() <= now.getTime()
    ) {
      this.conversation = makeConversation({
        ...this.conversation,
        sidechatStatus: "failed",
        sidechatRunId: null,
        sidechatLeaseExpiresAt: null,
      });
    }
    return this.conversation;
  }

  async getSidechatConversationById(): Promise<TestConversation> {
    this.calls.push("conversation");
    return this.conversation;
  }

  async getRecentSidechatMessages(
    _conversationId: string,
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
    this.calls.push(`recent:${limit}`);
    return { messages: this.messages.slice(-limit), hasMore: false };
  }

  async getSidechatMessagesBefore(
    _conversationId: string,
    before: Date | { createdAt: Date; id: string },
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
    this.calls.push(before instanceof Date
      ? `legacy-before:${limit}`
      : `before:${before.createdAt.toISOString()}:${before.id}:${limit}`);
    return { messages: this.messages.slice(-limit), hasMore: false };
  }

  async claimSidechatRun(input: {
    runId: string;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    this.calls.push("claim");
    if (!this.allowClaim) return false;
    this.conversation.sidechatStatus = "working";
    this.conversation.sidechatRunId = input.runId;
    this.conversation.sidechatLeaseExpiresAt = input.leaseExpiresAt;
    return true;
  }

  async claimSidechatStartRun(input: {
    runId: string;
    leaseExpiresAt: Date;
  }): Promise<"claimed" | "existing" | "busy"> {
    this.calls.push("claim-start");
    if (this.messages.length > 0) return "existing";
    if (
      !this.allowClaim ||
      (this.conversation.sidechatLeaseExpiresAt?.getTime() ?? 0) > now.getTime()
    ) {
      return "busy";
    }
    this.conversation.sidechatStatus = "working";
    this.conversation.sidechatRunId = input.runId;
    this.conversation.sidechatLeaseExpiresAt = input.leaseExpiresAt;
    return "claimed";
  }

  async settleSidechatRun(input: {
    runId: string;
    status: "idle" | "ready" | "failed" | "waiting_approval";
    now?: Date;
  }): Promise<boolean> {
    this.calls.push(`settle:${input.status}`);
    this.settlementTimes.push(input.now);
    if (this.conversation.sidechatRunId !== input.runId) return false;
    if (
      !input.now ||
      this.conversation.archivedAt ||
      !this.conversation.sidechatLeaseExpiresAt ||
      this.conversation.sidechatLeaseExpiresAt.getTime() <= input.now.getTime()
    ) {
      return false;
    }
    this.conversation.sidechatStatus = input.status;
    this.conversation.sidechatRunId = null;
    this.conversation.sidechatLeaseExpiresAt = null;
    return true;
  }

  async addSidechatHumanMessage(input: {
    runId: string;
    content: string;
    userId: string;
    senderName: string;
    senderAvatar: string | null;
  }): Promise<MessageRow | null> {
    this.calls.push("insert");
    if (this.conversation.sidechatRunId !== input.runId) return null;
    const message = makeMessage({
      id: `sidechat-human-${this.messages.length + 1}`,
      content: input.content,
      userId: input.userId,
      senderName: input.senderName,
      senderAvatar: input.senderAvatar,
    });
    this.messages.push(message);
    return message;
  }
}

function createMutationOptions(service: MemorySidechatService) {
  const events: string[] = [];
  const background: Promise<void>[] = [];
  return {
    projectId: "project-1",
    conversationId: "conversation-1",
    actor: {
      userId: "user-1",
      name: "Agent Kim",
      avatarUrl: null,
    },
    service,
    now: () => now,
    createRunId: () => "run-1",
    async getCanonicalCustomerName() {
      events.push("customer");
      return "Canonical Alice";
    },
    broadcastMessage(message: MessageRow) {
      expect(service.messages.some((row) => row.id === message.id)).toBe(true);
      events.push("broadcast:message");
    },
    broadcastStatus(status: string) {
      events.push(`broadcast:${status}`);
    },
    runTurn(input: { message: MessageRow; runId: string }) {
      events.push(`run:${input.message.id}:${input.runId}`);
      return Promise.resolve();
    },
    scheduleBackground(promise: Promise<void>) {
      expect(service.messages.length).toBeGreaterThan(0);
      events.push("schedule");
      background.push(promise);
    },
    events,
    background,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("sidechat route authorization", () => {
  test.each([
    ["owner", "owner", true, null],
    ["admin", "admin", true, null],
    ["member with access", "member", false, ["project-1"]],
  ] as const)("allows %s effective-project access", (_label, role, all, ids) => {
    expect(
      canAccessSidechatProject({
        authenticatedUserId: "member-1",
        effectiveUserId: "owner-1",
        role,
        accessAllProjects: all,
        projectIds: ids ? [...ids] : null,
        project: { id: "project-1", userId: "owner-1" },
      }),
    ).toBe(true);
  });

  test("fails closed as not-found for an unrelated effective owner", () => {
    expect(
      canAccessSidechatProject({
        authenticatedUserId: "outsider-1",
        effectiveUserId: "outsider-1",
        role: "owner",
        accessAllProjects: true,
        projectIds: null,
        project: { id: "project-1", userId: "owner-1" },
      }),
    ).toBe(false);
  });
});

describe("sidechat history and acceptance", () => {
  test("keeps archived history readable and strips private storage fields", async () => {
    const service = new MemorySidechatService();
    service.conversation = makeConversation({ archivedAt: now });
    service.messages = [makeMessage()];

    const response = await handleGetSidechatHistory({
      projectId: "project-1",
      conversationId: "conversation-1",
      query: {},
      service,
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      {
        id: "sidechat-human-1",
        role: "agent",
        content: "Please help me draft a reply.",
        kind: "text",
        metadata: null,
        senderName: "Agent Kim",
        createdAt: now.getTime(),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("user-private");
    expect(JSON.stringify(body)).not.toContain("avatar.png");
  });

  test("round-trips a stable composite cursor for tied history rows", async () => {
    const service = new MemorySidechatService();
    service.messages = [
      makeMessage({ id: "tie-d" }),
      makeMessage({ id: "tie-e" }),
    ];
    service.getRecentSidechatMessages = async () => ({
      messages: service.messages,
      hasMore: true,
    });

    const first = await handleGetSidechatHistory({
      projectId: "project-1",
      conversationId: "conversation-1",
      query: { limit: "2" },
      service,
    });
    const firstBody = await readJson(first);
    const expectedCursor = `${now.getTime()}.tie-d`;
    expect(firstBody.nextBefore).toBe(expectedCursor);

    const second = await handleGetSidechatHistory({
      projectId: "project-1",
      conversationId: "conversation-1",
      query: { before: expectedCursor, limit: "2" },
      service,
    });

    expect(second.status).toBe(200);
    expect(service.calls).toContain(
      `before:${now.toISOString()}:tie-d:2`,
    );
  });

  test("rejects archived writes without claiming or inserting", async () => {
    const service = new MemorySidechatService();
    service.conversation = makeConversation({ archivedAt: now });
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "Help" },
    });

    expect(response.status).toBe(410);
    expect(service.calls).toEqual(["conversation"]);
    expect(service.messages).toEqual([]);
  });

  test("returns busy before inserting a private message", async () => {
    const service = new MemorySidechatService();
    service.allowClaim = false;
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "Keep my draft" },
    });

    expect(response.status).toBe(409);
    expect(service.calls).toEqual(["conversation", "claim"]);
    expect(service.messages).toEqual([]);
    expect(options.events).toEqual([]);
  });

  test("opens an existing thread without inserting or mutating its status", async () => {
    const service = new MemorySidechatService();
    service.messages = [makeMessage()];
    service.conversation = makeConversation({
      sidechatStatus: "ready",
      sidechatRunId: null,
    });
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "Do not duplicate", startOnlyIfEmpty: true },
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ outcome: "existing" });
    expect(service.calls).toEqual(["conversation", "claim-start"]);
    expect(service.messages).toHaveLength(1);
    expect(service.conversation.sidechatStatus).toBe("ready");
    expect(options.events).toEqual([]);
  });

  test("existing start classification does not normalize an expired run status", async () => {
    const expiredAt = new Date(now.getTime() - 1);
    const service = new MemorySidechatService();
    service.messages = [makeMessage()];
    service.conversation = makeConversation({
      sidechatStatus: "working",
      sidechatRunId: "run-expired",
      sidechatLeaseExpiresAt: expiredAt,
    });
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { startOnlyIfEmpty: true },
    });

    expect(response.status).toBe(200);
    expect(service.conversation).toMatchObject({
      sidechatStatus: "working",
      sidechatRunId: "run-expired",
      sidechatLeaseExpiresAt: expiredAt,
    });
    expect(service.calls).toEqual(["conversation", "claim-start"]);
  });

  test("atomically admits only one cross-client start request", async () => {
    const service = new MemorySidechatService();
    const firstOptions = createMutationOptions(service);
    const secondOptions = createMutationOptions(service);
    secondOptions.createRunId = () => "run-2";

    const responses = await Promise.all([
      handleCreateSidechatMessage({
        ...firstOptions,
        body: { content: "First start", startOnlyIfEmpty: true },
      }),
      handleCreateSidechatMessage({
        ...secondOptions,
        body: { content: "Second start", startOnlyIfEmpty: true },
      }),
    ]);
    const bodies = await Promise.all(responses.map(readJson));

    expect(responses.map((response) => response.status).toSorted()).toEqual([
      202,
      409,
    ]);
    expect(bodies.map((body) => body.outcome).toSorted()).toEqual([
      "accepted",
      "busy",
    ]);
    expect(service.messages).toHaveLength(1);
  });

  test("persists and broadcasts private acceptance before returning 202", async () => {
    const service = new MemorySidechatService();
    const publicSnapshot = {
      status: service.conversation.status,
      chatState: service.conversation.chatState,
      lastActivityAt: service.conversation.lastActivityAt,
    };
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "  Draft a careful answer  " },
    });
    const body = await readJson(response);

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ runId: "run-1" });
    expect(service.messages[0]?.content).toBe("Draft a careful answer");
    expect(options.events.slice(0, 3)).toEqual([
      "broadcast:message",
      "broadcast:working",
      "schedule",
    ]);
    expect({
      status: service.conversation.status,
      chatState: service.conversation.chatState,
      lastActivityAt: service.conversation.lastActivityAt,
    }).toEqual(publicSnapshot);
    await Promise.all(options.background);
    expect(options.events.at(-1)).toBe("run:sidechat-human-1:run-1");
  });

  test("builds the omitted default only from canonical or conversation names", async () => {
    const service = new MemorySidechatService();
    const options = createMutationOptions(service);

    const response = await handleCreateSidechatMessage({
      ...options,
      body: {},
    });

    expect(response.status).toBe(202);
    expect(service.messages[0]?.content).toBe(
      "Help me respond to Canonical Alice.",
    );
    expect(buildTrustedDefaultSidechatMessage(null, "Conversation Alice"))
      .toBe("Help me respond to Conversation Alice.");
    expect(buildTrustedDefaultSidechatMessage(null, null))
      .toBe("Help me respond to this conversation.");
  });

  test("releases the claimed run when trusted default resolution fails", async () => {
    const service = new MemorySidechatService();
    const options = createMutationOptions(service);
    options.getCanonicalCustomerName = async () => {
      throw new Error("customer lookup unavailable");
    };

    const response = await handleCreateSidechatMessage({
      ...options,
      body: {},
    });

    expect(response.status).toBe(500);
    expect(service.calls).toContain("settle:failed");
    expect(service.conversation.sidechatStatus).toBe("failed");
    expect(service.messages).toEqual([]);
    expect(options.background).toEqual([]);
  });

  test.each(["message", "status"] as const)(
    "returns durable acceptance and retries without duplicating after %s broadcast fails",
    async (failedBroadcast) => {
      const service = new MemorySidechatService();
      const options = createMutationOptions(service);
      if (failedBroadcast === "message") {
        options.broadcastMessage = () => {
          throw new Error("message broadcast unavailable");
        };
      } else {
        options.broadcastStatus = () => {
          throw new Error("status broadcast unavailable");
        };
      }

      const response = await handleCreateSidechatMessage({
        ...options,
        body: { content: "Keep this private" },
      });

      expect(response.status).toBe(202);
      expect(service.calls).toContain("settle:failed");
      expect(service.conversation.sidechatStatus).toBe("failed");
      expect(service.messages).toHaveLength(1);
      expect(options.background).toEqual([]);

      options.broadcastMessage = () => {};
      options.broadcastStatus = () => {};
      const retry = await handleRetrySidechatTurn({
        ...options,
        body: { messageId: "sidechat-human-1" },
      });

      expect(retry.status).toBe(202);
      expect(service.messages).toHaveLength(1);
      await Promise.all(options.background);
    },
  );

  test("returns 202 and marks the durable row retryable when waitUntil registration fails", async () => {
    const service = new MemorySidechatService();
    const options = createMutationOptions(service);
    options.scheduleBackground = () => {
      throw new Error("waitUntil unavailable");
    };

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "Keep this private" },
    });

    expect(response.status).toBe(202);
    expect(service.messages).toHaveLength(1);
    expect(service.conversation.sidechatStatus).toBe("failed");
    expect(service.calls).toContain("settle:failed");
  });

  test.each(["expiry", "archive"] as const)(
    "cleanup cannot settle after %s wins the acceptance race",
    async (winner) => {
      const service = new MemorySidechatService();
      const options = createMutationOptions(service);
      options.broadcastMessage = () => {
        if (winner === "expiry") {
          service.conversation.sidechatLeaseExpiresAt = now;
        } else {
          service.conversation.archivedAt = now;
        }
        throw new Error(`${winner} won`);
      };

      const response = await handleCreateSidechatMessage({
        ...options,
        body: { content: "Already durable" },
      });

      expect(response.status).toBe(202);
      expect(service.messages).toHaveLength(1);
      expect(service.settlementTimes).toEqual([now]);
      expect(service.conversation.sidechatStatus).toBe("working");
      expect(options.events).not.toContain("broadcast:failed");
    },
  );

  test("contains a background rejection and releases the matching run", async () => {
    const service = new MemorySidechatService();
    const options = createMutationOptions(service);
    options.runTurn = async () => {
      throw new Error("provider rejected");
    };

    const response = await handleCreateSidechatMessage({
      ...options,
      body: { content: "Help" },
    });
    await Promise.all(options.background);

    expect(response.status).toBe(202);
    expect(service.calls).toContain("settle:failed");
    expect(service.conversation.sidechatStatus).toBe("failed");
    expect(options.events).toContain("broadcast:failed");
  });

  test("retries an expired lease from the last human row without duplicating it", async () => {
    const service = new MemorySidechatService();
    service.conversation = makeConversation({
      sidechatStatus: "working",
      sidechatRunId: "expired-run",
      sidechatLeaseExpiresAt: new Date(now.getTime() - 1),
    });
    service.messages = [
      makeMessage(),
      makeMessage({
        id: "sidechat-maven-1",
        role: "bot",
        content: "Partial output must not be retried as input.",
        senderName: "Maven",
        userId: null,
      }),
    ];
    const options = createMutationOptions(service);

    const response = await handleRetrySidechatTurn({
      ...options,
      body: { messageId: "sidechat-human-1" },
    });
    const body = await readJson(response);

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      runId: "run-1",
      message: { id: "sidechat-human-1", role: "agent" },
    });
    expect(service.messages).toHaveLength(2);
    expect(service.calls).not.toContain("insert");
    await Promise.all(options.background);
    expect(options.events.at(-1)).toBe("run:sidechat-human-1:run-1");
  });

  test("rejects retry of anything except the last sidechat human message", async () => {
    const service = new MemorySidechatService();
    service.messages = [makeMessage()];
    const options = createMutationOptions(service);

    const response = await handleRetrySidechatTurn({
      ...options,
      body: { messageId: "older-human-message" },
    });

    expect(response.status).toBe(409);
    expect(service.calls).not.toContain("claim");
    expect(options.background).toEqual([]);
  });
});
