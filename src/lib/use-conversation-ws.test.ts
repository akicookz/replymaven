import { expect, test } from "bun:test";
import type { MessageRow } from "../../worker/db";
import { mapD1MessageRow } from "../../worker/conversations/d1-public-conversation-store";
import {
  broadcastEventToSockets,
  replayConversationMessages,
  type ConversationReplayReader,
  type RealtimeSocket,
  type SocketAttachment,
} from "../../worker/durable-objects/conversation-do";
import type { MessagePayload, ServerEvent } from "../../shared/ws-events";
import {
  createConversationResumeEvent,
  reduceConversationMessageEvent,
  type ConversationRealtimeMessageState,
} from "./use-conversation-ws";

function createPublicPayload(
  id: string,
  createdAt: number,
  content = id,
): MessagePayload {
  return {
    id,
    role: "visitor",
    content,
    imageUrl: null,
    sources: null,
    senderName: null,
    senderAvatar: null,
    createdAt,
  };
}

function createMessageRow(id: string, createdAt: number): MessageRow {
  return {
    id,
    conversationId: "conversation-1",
    role: "visitor",
    content: id,
    imageUrl: null,
    sources: null,
    senderName: null,
    senderAvatar: null,
    userId: null,
    createdAt: new Date(createdAt),
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
  };
}

function emptyState(): ConversationRealtimeMessageState {
  return { messages: [], cursor: null };
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

function createSocket(): RealtimeSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    deserializeAttachment: agentAttachment,
    send(payload) {
      sent.push(payload);
    },
    close() {},
  };
}

test("ignores unknown server frames", () => {
  const initial = reduceConversationMessageEvent(emptyState(), {
    type: "message:new",
    conversationId: "conversation-1",
    message: createPublicPayload("public-1", 1_000),
  });

  const next = reduceConversationMessageEvent(initial, {
    type: "internal:message",
    conversationId: "conversation-1",
    message: {
      id: "private-1",
      role: "bot",
      content: "private",
      createdAt: 2_000,
    },
  } as unknown as ServerEvent);

  expect(next).toBe(initial);
});

test("dedupes and orders public events without regressing the cursor", () => {
  const newer = {
    type: "message:new",
    conversationId: "conversation-1",
    message: createPublicPayload("public-c", 3_000, "newer"),
  } satisfies ServerEvent;
  const older = {
    type: "message:new",
    conversationId: "conversation-1",
    message: createPublicPayload("public-a", 1_000, "older"),
  } satisfies ServerEvent;

  let state = reduceConversationMessageEvent(emptyState(), newer);
  state = reduceConversationMessageEvent(state, older);
  state = reduceConversationMessageEvent(state, newer);

  expect(state.messages.map((message) => message.id)).toEqual([
    "public-a",
    "public-c",
  ]);
  expect(state.cursor).toEqual({ id: "public-c", createdAt: 3_000 });
});

test("reconciles a matching optimistic public message", () => {
  const optimistic = {
    ...createPublicPayload("optimistic-1", 1_000, "Hello"),
    createdAt: new Date(1_000).toISOString(),
    toolExecutions: [],
    _optimistic: true,
  };
  const next = reduceConversationMessageEvent(
    { messages: [optimistic], cursor: null },
    {
      type: "message:new",
      conversationId: "conversation-1",
      message: createPublicPayload("public-1", 2_000, "Hello"),
    },
  );

  expect(next.messages).toHaveLength(1);
  expect(next.messages[0]?.id).toBe("public-1");
});

test("resume protocol carries only the public message cursor", () => {
  expect(createConversationResumeEvent({ id: "public-1", createdAt: 1_000 }))
    .toEqual({ type: "resume", lastMessageId: "public-1" });
});

test("public replay is lossless across equal-second message IDs", async () => {
  const cursor = createMessageRow("public-z", 2_000);
  const rows = [
    cursor,
    createMessageRow("public-a", 2_000),
    createMessageRow("public-next", 3_000),
  ];
  const reader: ConversationReplayReader = {
    async getMessage(_projectId, _conversationId, id) {
      return id === cursor.id ? mapD1MessageRow(cursor) : null;
    },
    async getMessagesSince(_projectId, _conversationId, since) {
      return rows
        .filter((row) => row.createdAt.getTime() > since)
        .map(mapD1MessageRow);
    },
  };
  const socket = createSocket();

  await replayConversationMessages(
    socket,
    agentAttachment(),
    { lastMessageId: cursor.id },
    reader,
  );

  expect(socket.sent.map((payload) => JSON.parse(payload).message.id)).toEqual([
    "public-a",
    "public-next",
  ]);
});

test("agent-only public events stay hidden from visitor sockets", () => {
  const agent = createSocket();
  const visitor: RealtimeSocket & { sent: string[] } = {
    ...createSocket(),
    sent: [],
    deserializeAttachment() {
      return {
        ...agentAttachment(),
        kind: "visitor",
        subjectId: "visitor-1",
      };
    },
    send(payload) {
      this.sent.push(payload);
    },
  };

  broadcastEventToSockets([agent, visitor], {
    event: {
      type: "conversation:updated",
      conversationId: "conversation-1",
      updatedAt: 1,
    },
    audience: "agents",
  });

  expect(agent.sent).toHaveLength(1);
  expect(visitor.sent).toHaveLength(0);
});
