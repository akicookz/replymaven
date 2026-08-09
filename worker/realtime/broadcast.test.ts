import { expect, test } from "bun:test";
import type { MessageRow } from "../db";
import type { AppEnv } from "../types";
import {
  broadcastCustomerUpdated,
  broadcastMessageNew,
  broadcastSidechatActivity,
  broadcastSidechatDelta,
  broadcastSidechatMessage,
  broadcastSidechatStatus,
  sidechatMessageRowToPayload,
} from "./broadcast";
import {
  broadcastEventToSockets,
  replayConversationMessages,
  type ConversationReplayReader,
  type RealtimeSocket,
  type SocketAttachment,
} from "../durable-objects/conversation-do";

interface BroadcastHarness {
  env: AppEnv;
  ctx: ExecutionContext;
  roomNames: string[];
  requests: Request[];
  flush(): Promise<void>;
}

function createBroadcastHarness(): BroadcastHarness {
  const roomNames: string[] = [];
  const requests: Request[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    INTERNAL_BROADCAST_SECRET: "internal-secret",
    CONVERSATION_DO: {
      idFromName(name: string) {
        roomNames.push(name);
        return name;
      },
      get() {
        return {
          async fetch(input: RequestInfo | URL, init?: RequestInit) {
            requests.push(new Request(input, init));
            return new Response("ok");
          },
        };
      },
    },
  } as AppEnv;
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as ExecutionContext;

  return {
    env,
    ctx,
    roomNames,
    requests,
    async flush() {
      await Promise.all(pending);
    },
  };
}

function createMessageRow(
  overrides: Partial<MessageRow> = {},
): MessageRow {
  return {
    id: "sidechat-message-1",
    conversationId: "conversation-1",
    role: "bot",
    content: "Here is a private draft.",
    channel: "sidechat",
    kind: "reply_draft",
    metadata: JSON.stringify({ draft: "Send this to the visitor." }),
    imageUrl: null,
    sources: null,
    senderName: "Maven",
    senderAvatar: null,
    userId: null,
    createdAt: new Date("2026-08-09T00:00:02.000Z"),
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
    ...overrides,
  };
}

function createSocket(
  attachment: SocketAttachment,
): RealtimeSocket & { sent: string[]; closes: string[] } {
  const sent: string[] = [];
  const closes: string[] = [];
  return {
    sent,
    closes,
    deserializeAttachment() {
      return attachment;
    },
    send(payload: string) {
      sent.push(payload);
    },
    close(_code: number, reason: string) {
      closes.push(reason);
    },
  };
}

test("broadcasts customer changes through the project customer room", async () => {
  const harness = createBroadcastHarness();
  broadcastCustomerUpdated(harness.env, harness.ctx, "project-1", [
    "customer-1",
    "customer-2",
  ]);
  await harness.flush();

  expect(harness.roomNames).toEqual(["customer-project:project-1"]);
  expect(await harness.requests[0]?.json()).toEqual({
    event: {
      type: "customer:updated",
      projectId: "project-1",
      customerIds: ["customer-1", "customer-2"],
      updatedAt: expect.any(Number),
    },
    audience: "agents",
  });
});

test("all sidechat broadcasters force the agent audience", async () => {
  const harness = createBroadcastHarness();
  const row = createMessageRow();

  broadcastSidechatMessage(
    harness.env,
    harness.ctx,
    "conversation-1",
    row,
  );
  broadcastSidechatDelta(
    harness.env,
    harness.ctx,
    "conversation-1",
    "run-1",
    "A safe partial response",
  );
  broadcastSidechatActivity(
    harness.env,
    harness.ctx,
    "conversation-1",
    "run-1",
    "Looking up the order",
    "start",
  );
  broadcastSidechatStatus(
    harness.env,
    harness.ctx,
    "conversation-1",
    {
      status: "working",
      runId: "run-1",
      revision: 7,
      updatedAt: Date.parse("2026-08-09T00:00:03.000Z"),
    },
  );
  await harness.flush();

  const bodies = await Promise.all(
    harness.requests.map(async (request) => request.json()),
  );
  expect(bodies.map((body) => body.audience)).toEqual([
    "agents",
    "agents",
    "agents",
    "agents",
  ]);
  expect(bodies.map((body) => body.event.type)).toEqual([
    "sidechat:message",
    "sidechat:delta",
    "sidechat:activity",
    "sidechat:status",
  ]);
  expect(bodies[0]?.event.message).toEqual({
    id: "sidechat-message-1",
    role: "bot",
    content: "Here is a private draft.",
    kind: "reply_draft",
    metadata: { draft: "Send this to the visitor." },
    senderName: "Maven",
    createdAt: Date.parse("2026-08-09T00:00:02.000Z"),
  });
  expect(bodies[3]?.event).toEqual({
    type: "sidechat:status",
    conversationId: "conversation-1",
    status: "working",
    runId: "run-1",
    revision: 7,
    updatedAt: Date.parse("2026-08-09T00:00:03.000Z"),
  });
});

test("sidechat payload conversion rejects unknown metadata keys", () => {
  const unsafe = createMessageRow({
    metadata: JSON.stringify({
      draft: "Safe draft",
      rawToolResult: { customerToken: "must-not-reach-browser" },
    }),
  });

  expect(() => sidechatMessageRowToPayload(unsafe)).toThrow(
    "Unsafe sidechat message metadata",
  );
});

test("public message broadcasts reject sidechat rows", () => {
  const harness = createBroadcastHarness();

  expect(() =>
    broadcastMessageNew(
      harness.env,
      harness.ctx,
      "conversation-1",
      createMessageRow(),
    ),
  ).toThrow("Cannot broadcast a non-public row as message:new");
  expect(harness.requests).toEqual([]);
});

test("the DO excludes visitor sockets from sidechat live events", () => {
  const visitor = createSocket({
    kind: "visitor",
    subjectId: "visitor-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  broadcastEventToSockets([visitor, agent], {
    event: {
      type: "sidechat:delta",
      conversationId: "conversation-1",
      runId: "run-1",
      delta: "Private",
    },
  });

  expect(visitor.sent).toEqual([]);
  expect(agent.sent).toHaveLength(1);
  expect(JSON.parse(agent.sent[0] ?? "")).toEqual({
    type: "sidechat:delta",
    conversationId: "conversation-1",
    runId: "run-1",
    delta: "Private",
  });
});

test("the DO broadcast boundary rejects unknown sidechat metadata", () => {
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });
  const unsafeBody = JSON.parse(
    JSON.stringify({
      event: {
        type: "sidechat:message",
        conversationId: "conversation-1",
        message: {
          id: "sidechat-message-1",
          role: "bot",
          content: "Private",
          kind: "reply_draft",
          metadata: {
            draft: "Safe draft",
            rawToolResult: "must-not-reach-browser",
          },
          senderName: "Maven",
          createdAt: 1,
        },
      },
    }),
  );

  expect(() => broadcastEventToSockets([agent], unsafeBody)).toThrow(
    "Unsafe sidechat message metadata",
  );
  expect(agent.sent).toEqual([]);
});

test("visitor replay executes only the public query", async () => {
  const calls: string[] = [];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel(id, channel) {
      calls.push(`cursor:${channel}:${id}`);
      return {
        id,
        conversationId: "conversation-1",
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
      };
    },
    async getPublicMessagesSince(_conversationId, since) {
      calls.push(`public:${since}`);
      return [
        createMessageRow({
          id: "public-2",
          role: "visitor",
          channel: "public",
          kind: "text",
          metadata: null,
          content: "Public follow-up",
        }),
      ];
    },
    async getSidechatMessagesSince(_conversationId, since) {
      calls.push(`sidechat:${since}`);
      return [createMessageRow()];
    },
    async getSidechatCoordinationSnapshot() {
      throw new Error("visitor replay must not query Sidechat coordination");
    },
  };
  const visitor = createSocket({
    kind: "visitor",
    subjectId: "visitor-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    visitor,
    visitor.deserializeAttachment() as SocketAttachment,
    {
      lastPublicMessageId: "public-1",
      lastSidechatMessageId: "sidechat-1",
    },
    reader,
  );

  expect(calls).toEqual([
    "cursor:public:public-1",
    `public:${Date.parse("2026-08-08T23:59:59.000Z")}`,
  ]);
  expect(visitor.sent.map((payload) => JSON.parse(payload).type)).toEqual([
    "message:new",
  ]);
});

test("agent replay sends the authoritative Sidechat status after message replay", async () => {
  const calls: string[] = [];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel() {
      return null;
    },
    async getPublicMessagesSince() {
      calls.push("public");
      return [];
    },
    async getSidechatMessagesSince() {
      calls.push("sidechat");
      return [createMessageRow()];
    },
    async getSidechatCoordinationSnapshot(conversationId, projectId) {
      calls.push(`coordination:${conversationId}:${projectId}`);
      return {
        status: "ready",
        runId: null,
        revision: 9,
        updatedAt: Date.parse("2026-08-09T00:00:03.000Z"),
      };
    },
  };
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    agent,
    agent.deserializeAttachment() as SocketAttachment,
    { lastPublicMessageId: null, lastSidechatMessageId: null },
    reader,
  );

  expect(calls).toEqual([
    "public",
    "sidechat",
    "coordination:conversation-1:project-1",
  ]);
  expect(agent.sent.map((payload) => JSON.parse(payload).type)).toEqual([
    "sidechat:message",
    "sidechat:status",
  ]);
  expect(JSON.parse(agent.sent[1] ?? "")).toEqual({
    type: "sidechat:status",
    conversationId: "conversation-1",
    status: "ready",
    runId: null,
    revision: 9,
    updatedAt: Date.parse("2026-08-09T00:00:03.000Z"),
  });
});

test("archived agent replay still sends coordination after private history", async () => {
  const calls: string[] = [];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel() {
      return null;
    },
    async getPublicMessagesSince() {
      return [];
    },
    async getSidechatMessagesSince() {
      calls.push("archived-private-history");
      return [createMessageRow()];
    },
    async getSidechatCoordinationSnapshot() {
      calls.push("archived-coordination");
      return {
        status: "failed",
        runId: null,
        revision: 12,
        updatedAt: Date.parse("2026-08-10T00:00:12.000Z"),
      };
    },
  };
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    agent,
    agent.deserializeAttachment() as SocketAttachment,
    { lastPublicMessageId: null, lastSidechatMessageId: null },
    reader,
  );

  expect(calls).toEqual(["archived-private-history", "archived-coordination"]);
  expect(agent.sent.map((payload) => JSON.parse(payload).type)).toEqual([
    "sidechat:message",
    "sidechat:status",
  ]);
});

test("visitor replay fails closed when the public reader returns a private row", async () => {
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel() {
      return null;
    },
    async getPublicMessagesSince() {
      return [createMessageRow()];
    },
    async getSidechatMessagesSince() {
      throw new Error("visitor replay must not query sidechat");
    },
    async getSidechatCoordinationSnapshot() {
      throw new Error("visitor replay must not query sidechat coordination");
    },
  };
  const visitor = createSocket({
    kind: "visitor",
    subjectId: "visitor-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    visitor,
    visitor.deserializeAttachment() as SocketAttachment,
    { lastPublicMessageId: null, lastSidechatMessageId: null },
    reader,
  );

  expect(visitor.sent).toEqual([]);
});

test("public replay includes rows after a same-second cursor", async () => {
  const cursorAt = new Date("2026-08-09T00:00:01.000Z");
  const rows = [
    createMessageRow({
      id: "public-z",
      role: "visitor",
      channel: "public",
      kind: "text",
      metadata: null,
      content: "Already seen",
      createdAt: cursorAt,
    }),
    createMessageRow({
      id: "public-a",
      role: "bot",
      channel: "public",
      kind: "text",
      metadata: null,
      content: "Same-second follow-up",
      createdAt: cursorAt,
    }),
  ];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel() {
      return rows[0] ?? null;
    },
    async getPublicMessagesSince(_conversationId, since) {
      return rows.filter((row) => row.createdAt.getTime() > since);
    },
    async getSidechatMessagesSince() {
      throw new Error("visitor replay must not query sidechat");
    },
    async getSidechatCoordinationSnapshot() {
      throw new Error("visitor replay must not query sidechat coordination");
    },
  };
  const visitor = createSocket({
    kind: "visitor",
    subjectId: "visitor-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    visitor,
    visitor.deserializeAttachment() as SocketAttachment,
    { lastPublicMessageId: "public-z", lastSidechatMessageId: null },
    reader,
  );

  expect(
    visitor.sent.map(
      (payload) => JSON.parse(payload).message.id as string,
    ),
  ).toEqual(["public-a"]);
});

test("agent replay uses independent public and sidechat cursors", async () => {
  const calls: string[] = [];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel(id, channel) {
      calls.push(`cursor:${channel}:${id}`);
      return {
        id,
        conversationId: "conversation-1",
        createdAt: new Date(
          channel === "public"
            ? "2026-08-09T00:00:00.000Z"
            : "2026-08-09T00:00:01.000Z",
        ),
      };
    },
    async getPublicMessagesSince(_conversationId, since) {
      calls.push(`public:${since}`);
      return [
        createMessageRow({
          id: "public-2",
          role: "visitor",
          channel: "public",
          kind: "text",
          metadata: null,
          content: "Public follow-up",
        }),
      ];
    },
    async getSidechatMessagesSince(_conversationId, since) {
      calls.push(`sidechat:${since}`);
      return [createMessageRow()];
    },
    async getSidechatCoordinationSnapshot() {
      return null;
    },
  };
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    agent,
    agent.deserializeAttachment() as SocketAttachment,
    {
      lastPublicMessageId: "public-1",
      lastSidechatMessageId: "sidechat-1",
    },
    reader,
  );

  expect(calls).toEqual([
    "cursor:public:public-1",
    `public:${Date.parse("2026-08-08T23:59:59.000Z")}`,
    "cursor:sidechat:sidechat-1",
    `sidechat:${Date.parse("2026-08-09T00:00:00.000Z")}`,
  ]);
  expect(agent.sent.map((payload) => JSON.parse(payload).type)).toEqual([
    "message:new",
    "sidechat:message",
  ]);
});

test("sidechat replay includes rows after a same-second cursor", async () => {
  const cursorAt = new Date("2026-08-09T00:00:01.000Z");
  const sidechatRows = [
    createMessageRow({
      id: "sidechat-z",
      content: "Already seen",
      kind: "text",
      metadata: null,
      createdAt: cursorAt,
    }),
    createMessageRow({
      id: "sidechat-a",
      content: "Same-second follow-up",
      kind: "text",
      metadata: null,
      createdAt: cursorAt,
    }),
  ];
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel(_id, channel) {
      return channel === "sidechat" ? (sidechatRows[0] ?? null) : null;
    },
    async getPublicMessagesSince() {
      return [];
    },
    async getSidechatMessagesSince(_conversationId, since) {
      return sidechatRows.filter((row) => row.createdAt.getTime() > since);
    },
    async getSidechatCoordinationSnapshot() {
      return null;
    },
  };
  const agent = createSocket({
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  });

  await replayConversationMessages(
    agent,
    agent.deserializeAttachment() as SocketAttachment,
    { lastPublicMessageId: null, lastSidechatMessageId: "sidechat-z" },
    reader,
  );

  expect(
    agent.sent.map(
      (payload) => JSON.parse(payload).message.id as string,
    ),
  ).toEqual(["sidechat-a"]);
});
