import { expect, test } from "bun:test";
import type { MessageRow } from "../../worker/db";
import {
  broadcastEventToSockets,
  replayConversationMessages,
  type ConversationReplayReader,
  type RealtimeSocket,
  type SocketAttachment,
} from "../../worker/durable-objects/conversation-do";
import type {
  MessagePayload,
  ServerEvent,
  SidechatMessagePayload,
} from "../../shared/ws-events";
import {
  reduceConversationMessageEvent,
  reduceSidechatEphemeralEvent,
  type ConversationRealtimeMessageState,
  type SidechatEphemeralStore,
} from "./use-conversation-ws";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

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

function createSidechatPayload(
  id: string,
  createdAt: number,
  content = id,
): SidechatMessagePayload {
  return {
    id,
    role: "bot",
    content,
    kind: "text",
    metadata: null,
    senderName: "Maven",
    createdAt,
  };
}

function createMessageRow(
  id: string,
  createdAt: number,
): MessageRow {
  return {
    id,
    conversationId: "conversation-1",
    role: "visitor",
    content: id,
    channel: "public",
    kind: "text",
    metadata: null,
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
  return {
    publicMessages: [],
    sidechatMessages: [],
    publicCursor: null,
    sidechatCursor: null,
  };
}

test("message reducer keeps public and sidechat caches isolated", () => {
  const initial = emptyState();
  const withPublic = reduceConversationMessageEvent(initial, {
    type: "message:new",
    conversationId: "conversation-1",
    message: createPublicPayload("public-1", 1_000),
  });
  const withSidechat = reduceConversationMessageEvent(withPublic, {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: createSidechatPayload("sidechat-1", 2_000),
  });

  expect(withSidechat.publicMessages.map((message) => message.id)).toEqual([
    "public-1",
  ]);
  expect(withSidechat.sidechatMessages.map((message) => message.id)).toEqual([
    "sidechat-1",
  ]);
  expect(withSidechat.publicCursor?.id).toBe("public-1");
  expect(withSidechat.sidechatCursor?.id).toBe("sidechat-1");
});

test("message reducer dedupes and orders out-of-order events without regressing cursors", () => {
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

  expect(state.publicMessages.map((message) => message.id)).toEqual([
    "public-a",
    "public-c",
  ]);
  expect(state.publicMessages).toHaveLength(2);
  expect(state.publicCursor).toEqual({ id: "public-c", createdAt: 3_000 });
});

test("message reducer uses message IDs as the stable equal-time tie-breaker", () => {
  let state = reduceConversationMessageEvent(emptyState(), {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: createSidechatPayload("sidechat-z", 2_000),
  });
  state = reduceConversationMessageEvent(state, {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: createSidechatPayload("sidechat-a", 2_000),
  });

  expect(state.sidechatMessages.map((message) => message.id)).toEqual([
    "sidechat-a",
    "sidechat-z",
  ]);
  expect(state.sidechatCursor).toEqual({
    id: "sidechat-z",
    createdAt: 2_000,
  });
});

test("newer live delivery stays the cursor when an older deferred replay arrives", async () => {
  const deferredRows = createDeferred<MessageRow[]>();
  const attachment: SocketAttachment = {
    kind: "agent",
    subjectId: "agent-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    roomKind: "conversation",
  };
  const frames: string[] = [];
  const socket: RealtimeSocket = {
    deserializeAttachment() {
      return attachment;
    },
    send(payload) {
      frames.push(payload);
    },
    close() {},
  };
  const reader: ConversationReplayReader = {
    async getMessageByIdForChannel() {
      return null;
    },
    async getPublicMessagesSince() {
      return deferredRows.promise;
    },
    async getSidechatMessagesSince() {
      return [];
    },
  };
  const replay = replayConversationMessages(
    socket,
    attachment,
    { lastPublicMessageId: null, lastSidechatMessageId: null },
    reader,
  );

  broadcastEventToSockets([socket], {
    event: {
      type: "message:new",
      conversationId: "conversation-1",
      message: createPublicPayload("public-new", 3_000),
    },
  });
  deferredRows.resolve([createMessageRow("public-old", 1_000)]);
  await replay;

  let state = emptyState();
  for (const frame of frames) {
    state = reduceConversationMessageEvent(
      state,
      JSON.parse(frame) as ServerEvent,
    );
  }
  expect(frames.map((frame) => JSON.parse(frame).message.id)).toEqual([
    "public-new",
    "public-old",
  ]);
  expect(state.publicMessages.map((message) => message.id)).toEqual([
    "public-old",
    "public-new",
  ]);
  expect(state.publicCursor).toEqual({
    id: "public-new",
    createdAt: 3_000,
  });
});

test("ephemeral reducer bounds run count, delta length, and activity labels", () => {
  let store: SidechatEphemeralStore | undefined;
  for (let index = 0; index < 10; index += 1) {
    store = reduceSidechatEphemeralEvent(store, {
      type: "sidechat:activity",
      conversationId: "conversation-1",
      runId: `run-${index}`,
      label: index === 9 ? "x".repeat(510) : `Activity ${index}`,
      phase: "start",
    });
  }
  store = reduceSidechatEphemeralEvent(store, {
    type: "sidechat:delta",
    conversationId: "conversation-1",
    runId: "run-9",
    delta: "d".repeat(50_010),
  });

  expect(store.size).toBe(8);
  expect(store.has("run-0")).toBe(false);
  expect(store.has("run-1")).toBe(false);
  expect(store.get("run-9")?.delta).toHaveLength(50_000);
  expect(store.get("run-9")?.activity?.label).toHaveLength(500);
});
