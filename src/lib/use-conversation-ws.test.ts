import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
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
  mergeConversationWithSidechatSnapshot,
  mergeConversationDetailFetchWithSidechatAuthority,
  reduceSidechatAcceptedConversation,
  reduceSidechatEphemeralEvent,
  reduceSidechatEphemeralTerminalEvent,
  reduceSidechatAcceptedSnapshot,
  reduceSidechatStatusSnapshot,
  reconcileSidechatCoordinationQueryCaches,
  selectAuthoritativeSidechatCoordinationFromCaches,
  synchronizeSidechatCoordinationQueryCaches,
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
  role: "agent" | "bot" = "bot",
): SidechatMessagePayload {
  return {
    id,
    role,
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

test("sidechat delivery replaces its matching optimistic human row", () => {
  const state = emptyState();
  state.sidechatMessages = [
    {
      id: "optimistic-request-1",
      role: "agent",
      content: "Investigate order 42",
      kind: "text",
      metadata: null,
      senderName: null,
      createdAt: "2026-08-09T00:00:00.000Z",
      _optimistic: true,
    },
  ];

  const next = reduceConversationMessageEvent(state, {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: createSidechatPayload(
      "sidechat-message-1",
      Date.parse("2026-08-09T00:00:00.100Z"),
      "Investigate order 42",
      "agent",
    ),
  });

  expect(next.sidechatMessages).toHaveLength(1);
  expect(next.sidechatMessages[0]?.id).toBe("sidechat-message-1");
  expect(next.sidechatMessages[0]?._optimistic).toBeUndefined();
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
    async getSidechatCoordinationSnapshot() {
      return null;
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

test("a delayed old durable row cannot clear a newer run's ephemeral state", () => {
  const store = new Map([
    ["run-old", { delta: "Old partial", activity: null }],
    ["run-new", { delta: "New partial", activity: null }],
  ]);
  const afterOldRow = reduceSidechatEphemeralTerminalEvent(store, {
    type: "sidechat:message",
    conversationId: "conversation-1",
    message: createSidechatPayload("old-durable", 3_000),
  });
  expect(afterOldRow).toBe(store);
  expect(afterOldRow.has("run-new")).toBe(true);

  const afterOldTerminal = reduceSidechatEphemeralTerminalEvent(
    afterOldRow,
    {
      type: "sidechat:status",
      conversationId: "conversation-1",
      status: "ready",
      runId: "run-old",
      revision: 3,
      updatedAt: 3_000,
    },
  );
  expect([...afterOldTerminal.keys()]).toEqual(["run-new"]);
});

test("a delayed old terminal status cannot replace the active newer run", () => {
  expect(
    reduceSidechatStatusSnapshot(
      {
        status: "working",
        runId: "run-new",
        revision: 8,
        updatedAt: 8_000,
      },
      {
        status: "ready",
        runId: null,
        revision: 7,
        updatedAt: 7_000,
      },
    ),
  ).toEqual({
    status: "working",
    runId: "run-new",
    revision: 8,
    updatedAt: 8_000,
  });
  expect(
    reduceSidechatStatusSnapshot(
      {
        status: "working",
        runId: "run-new",
        revision: 8,
        updatedAt: 8_000,
      },
      {
        status: "ready",
        runId: null,
        revision: 9,
        updatedAt: 9_000,
      },
    ),
  ).toEqual({
    status: "ready",
    runId: null,
    revision: 9,
    updatedAt: 9_000,
  });
});

test("authoritative fetch snapshots recover missed terminals without resurrecting them", () => {
  const missedTerminal = reduceSidechatStatusSnapshot(
    {
      status: "working",
      runId: "run-1",
      revision: 2,
      updatedAt: 2_000,
    },
    {
      status: "failed",
      runId: null,
      revision: 3,
      updatedAt: 3_000,
    },
  );
  expect(missedTerminal).toEqual({
    status: "failed",
    runId: null,
    revision: 3,
    updatedAt: 3_000,
  });

  expect(reduceSidechatStatusSnapshot(missedTerminal, {
    status: "working",
    runId: "run-1",
    revision: 2,
    updatedAt: 2_000,
  })).toBe(missedTerminal);
  expect(reduceSidechatStatusSnapshot(missedTerminal, {
    status: "working",
    runId: "run-1",
    revision: 3,
    updatedAt: 3_000,
  })).toBe(missedTerminal);
});

test("an unselected list row recovers a newer cross-client Sidechat status", () => {
  const current = {
    id: "conversation-unselected",
    visitorName: "Alice",
    sidechatStatus: "working" as const,
    sidechatRunId: "run-old",
    sidechatRevision: 5,
    sidechatUpdatedAt: "2026-08-10T00:00:05.000Z",
  };
  const recovered = mergeConversationWithSidechatSnapshot(current, {
    visitorName: "Alice Updated",
    sidechatStatus: "failed",
    sidechatRunId: null,
    sidechatRevision: 6,
    sidechatUpdatedAt: "2026-08-10T00:00:06.000Z",
  });
  expect(recovered).toEqual({
    ...current,
    visitorName: "Alice Updated",
    sidechatStatus: "failed",
    sidechatRunId: null,
    sidechatRevision: 6,
    sidechatUpdatedAt: "2026-08-10T00:00:06.000Z",
  });
  expect(mergeConversationWithSidechatSnapshot(recovered, {
    sidechatStatus: "working",
    sidechatRunId: "run-old",
    sidechatRevision: 5,
    sidechatUpdatedAt: "2026-08-10T00:00:05.000Z",
  })).toEqual({
    ...recovered,
  });
});

test("terminal then detail refetch then 202 cannot resurrect the completed run", () => {
  const terminal = {
    status: "ready" as const,
    runId: null,
    revision: 8,
    updatedAt: 8_000,
  };
  expect(
    reduceSidechatAcceptedSnapshot(
      terminal,
      {
        status: "working",
        runId: "run-fast",
        revision: 7,
        updatedAt: 7_000,
      },
    ),
  ).toBe(terminal);
  expect(
    reduceSidechatAcceptedSnapshot(
      terminal,
      {
        status: "working",
        runId: "run-next",
        revision: 9,
        updatedAt: 9_000,
      },
    ),
  ).toEqual({
    status: "working",
    runId: "run-next",
    revision: 9,
    updatedAt: 9_000,
  });
});

test("terminal then detail refetch then delayed retry 202 cannot resurrect working", () => {
  const terminalDetail = {
    id: "conversation-1",
    sidechatStatus: "ready" as const,
    sidechatRunId: null,
    sidechatRevision: 8,
    sidechatUpdatedAt: "2026-08-10T00:00:08.000Z",
  };

  expect(
    reduceSidechatAcceptedConversation(
      terminalDetail,
      {
        status: "working",
        runId: "run-retry-fast",
        revision: 7,
        updatedAt: Date.parse("2026-08-10T00:00:07.000Z"),
      },
    ),
  ).toBe(terminalDetail);
  expect(
    reduceSidechatAcceptedConversation(
      terminalDetail,
      {
        status: "working",
        runId: "run-retry-live",
        revision: 9,
        updatedAt: Date.parse("2026-08-10T00:00:09.000Z"),
      },
    ),
  ).toEqual({
    ...terminalDetail,
    sidechatStatus: "working",
    sidechatRunId: "run-retry-live",
    sidechatRevision: 9,
    sidechatUpdatedAt: "2026-08-10T00:00:09.000Z",
  });
});

function seedCoordinationCaches(
  queryClient: QueryClient,
  snapshots: {
    detail?: { revision: number; status: "working" | "ready" | "failed"; runId: string | null };
    list?: { revision: number; status: "working" | "ready" | "failed"; runId: string | null };
    history?: { revision: number; status: "working" | "ready" | "failed"; runId: string | null };
  },
): void {
  if (snapshots.detail) {
    queryClient.setQueryData(["conversation-detail", "conversation-1"], {
      conversation: {
        id: "conversation-1",
        status: "active",
        closeReason: null,
        updatedAt: "2026-08-10T00:00:00.000Z",
        sidechatStatus: snapshots.detail.status,
        sidechatRunId: snapshots.detail.runId,
        sidechatRevision: snapshots.detail.revision,
        sidechatUpdatedAt: `2026-08-10T00:00:0${snapshots.detail.revision}.000Z`,
      },
      messages: [],
    });
  }
  if (snapshots.list) {
    queryClient.setQueryData(["conversations", "project-1", "all"], {
      conversations: [{
        id: "conversation-1",
        sidechatStatus: snapshots.list.status,
        sidechatRunId: snapshots.list.runId,
        sidechatRevision: snapshots.list.revision,
        sidechatUpdatedAt: `2026-08-10T00:00:0${snapshots.list.revision}.000Z`,
      }],
    });
  }
  if (snapshots.history) {
    queryClient.setQueryData(["sidechat", "project-1", "conversation-1"], {
      messages: [],
      hasMore: false,
      coordination: {
        status: snapshots.history.status,
        runId: snapshots.history.runId,
        revision: snapshots.history.revision,
        updatedAt: snapshots.history.revision * 1_000,
      },
    });
  }
}

test("cross-cache max rejects an older terminal everywhere without clearing a newer run", () => {
  const queryClient = new QueryClient();
  seedCoordinationCaches(queryClient, {
    detail: { revision: 7, status: "working", runId: "run-7" },
    list: { revision: 9, status: "working", runId: "run-9" },
    history: { revision: 7, status: "working", runId: "run-7" },
  });
  const ephemeral = new Map([
    ["run-8", { delta: "old", activity: null }],
    ["run-9", { delta: "new", activity: null }],
  ]);
  queryClient.setQueryData(
    ["sidechat-ephemeral", "project-1", "conversation-1"],
    ephemeral,
  );

  const result = reconcileSidechatCoordinationQueryCaches(
    queryClient,
    "project-1",
    "conversation-1",
    { status: "ready", runId: null, revision: 8, updatedAt: 8_000 },
  );

  expect(result.accepted).toBe(false);
  expect(queryClient.getQueryData(["conversation-detail", "conversation-1"]))
    .toMatchObject({ conversation: { sidechatRevision: 7, sidechatRunId: "run-7" } });
  expect(queryClient.getQueryData(["conversations", "project-1", "all"]))
    .toMatchObject({ conversations: [{ sidechatRevision: 9, sidechatRunId: "run-9" }] });
  expect(queryClient.getQueryData(
    ["sidechat-ephemeral", "project-1", "conversation-1"],
  )).toBe(ephemeral);
});

test("poll terminal advances detail list and history and clears only the superseded run", () => {
  const queryClient = new QueryClient();
  seedCoordinationCaches(queryClient, {
    detail: { revision: 7, status: "working", runId: "run-7" },
    list: { revision: 7, status: "working", runId: "run-7" },
    history: { revision: 7, status: "working", runId: "run-7" },
  });
  queryClient.setQueryData(
    ["sidechat-ephemeral", "project-1", "conversation-1"],
    new Map([
      ["run-7", { delta: "completed", activity: null }],
      ["run-9", { delta: "unrelated", activity: null }],
    ]),
  );

  expect(reconcileSidechatCoordinationQueryCaches(
    queryClient,
    "project-1",
    "conversation-1",
    { status: "failed", runId: null, revision: 8, updatedAt: 8_000 },
  ).accepted).toBe(true);

  expect(queryClient.getQueryData(["conversation-detail", "conversation-1"]))
    .toMatchObject({ conversation: { sidechatRevision: 8, sidechatStatus: "failed", sidechatRunId: null } });
  expect(queryClient.getQueryData(["conversations", "project-1", "all"]))
    .toMatchObject({ conversations: [{ sidechatRevision: 8, sidechatStatus: "failed", sidechatRunId: null }] });
  expect(queryClient.getQueryData(["sidechat", "project-1", "conversation-1"]))
    .toMatchObject({ coordination: { revision: 8, status: "failed", runId: null } });
  expect([
    ...(queryClient.getQueryData<SidechatEphemeralStore>(
      ["sidechat-ephemeral", "project-1", "conversation-1"],
    )?.keys() ?? []),
  ]).toEqual(["run-9"]);
});

test("accepted live terminal clears its exact prior run and preserves another ephemeral run", () => {
  const queryClient = new QueryClient();
  seedCoordinationCaches(queryClient, {
    detail: { revision: 7, status: "working", runId: "run-7" },
  });
  queryClient.setQueryData(
    ["sidechat-ephemeral", "project-1", "conversation-1"],
    new Map([
      ["run-7", { delta: "completed", activity: null }],
      ["run-9", { delta: "newer stream", activity: null }],
    ]),
  );

  reconcileSidechatCoordinationQueryCaches(
    queryClient,
    "project-1",
    "conversation-1",
    { status: "ready", runId: null, revision: 8, updatedAt: 8_000 },
  );

  expect([
    ...(queryClient.getQueryData<SidechatEphemeralStore>(
      ["sidechat-ephemeral", "project-1", "conversation-1"],
    )?.keys() ?? []),
  ]).toEqual(["run-9"]);
});

test("unselected polling snapshot remains authoritative when stale detail and history later load", () => {
  const queryClient = new QueryClient();
  seedCoordinationCaches(queryClient, {
    list: { revision: 9, status: "ready", runId: null },
    detail: { revision: 7, status: "working", runId: "run-7" },
    history: { revision: 8, status: "failed", runId: null },
  });

  expect(selectAuthoritativeSidechatCoordinationFromCaches(
    queryClient,
    "project-1",
    "conversation-1",
  )).toEqual({
    status: "ready",
    runId: null,
    revision: 9,
    updatedAt: Date.parse("2026-08-10T00:00:09.000Z"),
  });

  expect(synchronizeSidechatCoordinationQueryCaches(
    queryClient,
    "project-1",
    "conversation-1",
  )).toMatchObject({ revision: 9, status: "ready", runId: null });
  expect(queryClient.getQueryData(["conversation-detail", "conversation-1"]))
    .toMatchObject({
      conversation: {
        sidechatRevision: 9,
        sidechatStatus: "ready",
        sidechatRunId: null,
      },
    });
  expect(queryClient.getQueryData([
    "sidechat",
    "project-1",
    "conversation-1",
  ])).toMatchObject({
    coordination: { revision: 9, status: "ready", runId: null },
  });
});

interface DetailCommitFixture {
  conversation: {
    id: string;
    status: string;
    closeReason: string | null;
    updatedAt: string;
    visitorName: string;
    sidechatStatus: "idle" | "working" | "ready" | "failed";
    sidechatRunId: string | null;
    sidechatRevision: number;
    sidechatUpdatedAt: string | null;
  };
  messages: Array<{ id: string; content: string }>;
  marker: string;
}

function createFetchedDetail(revision: number): DetailCommitFixture {
  return {
    conversation: {
      id: "conversation-1",
      status: "active",
      closeReason: null,
      updatedAt: "2026-08-10T00:00:07.000Z",
      visitorName: "Fetched visitor",
      sidechatStatus: revision === 0 ? "idle" : "ready",
      sidechatRunId: null,
      sidechatRevision: revision,
      sidechatUpdatedAt: revision === 0
        ? null
        : `2026-08-10T00:00:0${revision}.000Z`,
    },
    messages: [{ id: "public-1", content: "Fetched transcript" }],
    marker: "fetched-detail",
  };
}

test("first deferred detail commit exposes the cached global revision without a stale render", async () => {
  const queryClient = new QueryClient();
  seedCoordinationCaches(queryClient, {
    list: { revision: 9, status: "working", runId: "run-9" },
    history: { revision: 9, status: "working", runId: "run-9" },
  });
  const deferred = createDeferred<DetailCommitFixture>();
  const observedRevisions: number[] = [];
  const observer = new QueryObserver<DetailCommitFixture>(queryClient, {
    queryKey: ["conversation-detail", "conversation-1"],
    queryFn: async () => deferred.promise,
    structuralSharing: (current, incoming) =>
      mergeConversationDetailFetchWithSidechatAuthority(
        queryClient,
        "project-1",
        current,
        incoming,
      ),
  });
  const unsubscribe = observer.subscribe((result) => {
    if (result.data) {
      observedRevisions.push(result.data.conversation.sidechatRevision);
    }
  });

  const pending = observer.refetch();
  deferred.resolve(createFetchedDetail(7));
  await pending;
  unsubscribe();

  expect(observedRevisions).toEqual([9]);
  expect(queryClient.getQueryData<DetailCommitFixture>([
    "conversation-detail",
    "conversation-1",
  ])).toEqual({
    conversation: {
      id: "conversation-1",
      status: "active",
      closeReason: null,
      updatedAt: "2026-08-10T00:00:07.000Z",
      visitorName: "Fetched visitor",
      sidechatStatus: "working",
      sidechatRunId: "run-9",
      sidechatRevision: 9,
      sidechatUpdatedAt: "2026-08-10T00:00:09.000Z",
    },
    messages: [{ id: "public-1", content: "Fetched transcript" }],
    marker: "fetched-detail",
  });
});

test("first detail commit keeps fetched legacy coordination when no authority is cached", () => {
  for (const revision of [0, 7]) {
    const fetched = createFetchedDetail(revision);
    expect(mergeConversationDetailFetchWithSidechatAuthority(
      new QueryClient(),
      "project-1",
      undefined,
      fetched,
    )).toBe(fetched);
  }
});
