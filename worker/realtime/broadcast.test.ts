import { expect, test } from "bun:test";
import type { MessageRow } from "../db";
import type { AppEnv } from "../types";
import {
  broadcastCustomerUpdated,
  broadcastMessageNew,
  messageRowToPayload,
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

function createMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "bot",
    content: "Public reply",
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

function agentAttachment(): SocketAttachment {
  return {
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
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

test("broadcasts a public message using the shared message payload", async () => {
  const harness = createBroadcastHarness();
  const row = createMessageRow();

  broadcastMessageNew(harness.env, harness.ctx, "conversation-1", row);
  await harness.flush();

  expect(messageRowToPayload(row)).toEqual({
    id: "message-1",
    role: "bot",
    content: "Public reply",
    imageUrl: null,
    sources: null,
    senderName: "Maven",
    senderAvatar: null,
    createdAt: Date.parse("2026-08-09T00:00:02.000Z"),
  });
  expect(await harness.requests[0]?.json()).toEqual({
    event: {
      type: "message:new",
      conversationId: "conversation-1",
      message: messageRowToPayload(row),
    },
  });
});

test("agent-only events are excluded from visitor sockets", () => {
  const agent = createSocket(agentAttachment());
  const visitor = createSocket({
    ...agentAttachment(),
    kind: "visitor",
    subjectId: "visitor-1",
  });

  broadcastEventToSockets(
    [agent, visitor],
    {
      event: {
        type: "conversation:updated",
        conversationId: "conversation-1",
        updatedAt: 1,
      },
      audience: "agents",
    },
  );

  expect(agent.sent).toHaveLength(1);
  expect(visitor.sent).toHaveLength(0);
});

test("public replay includes equal-second peers after the cursor", async () => {
  const cursor = createMessageRow({ id: "public-z" });
  const rows = [
    cursor,
    createMessageRow({ id: "public-a" }),
    createMessageRow({
      id: "public-next",
      createdAt: new Date("2026-08-09T00:00:03.000Z"),
    }),
  ];
  const reader: ConversationReplayReader = {
    async getPublicMessageById(id) {
      return id === cursor.id ? cursor : null;
    },
    async getPublicMessagesSince(_conversationId, since) {
      return rows.filter((row) => row.createdAt.getTime() > since);
    },
  };
  const socket = createSocket(agentAttachment());

  await replayConversationMessages(
    socket,
    agentAttachment(),
    { lastPublicMessageId: cursor.id },
    reader,
  );

  expect(socket.sent.map((payload) => JSON.parse(payload).message.id)).toEqual([
    "public-a",
    "public-next",
  ]);
});
