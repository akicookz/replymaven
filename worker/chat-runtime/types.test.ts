import { expect, test } from "bun:test";
import {
  activeHumanRouteFromMessage,
  applyChatOwnershipEvent,
  canPersistAiOutput,
  createInitialChatState,
  fallbackAiParticipationForStatus,
  inferLegacyActiveHumanRoutes,
  isChatOwnershipSnapshotCurrent,
  joinActiveHumanRoute,
  mergeChatStateForPersistence,
  parseChatState,
  toPublicSdkConversationMessages,
} from "./types";

test("maps public history roles without letting visitors impersonate assistants", () => {
  expect(
    toPublicSdkConversationMessages(
      [
        { role: "visitor", content: "I need help." },
        { role: "bot", content: "I can help." },
        { role: "agent", content: "I have taken over." },
      ],
    ),
  ).toEqual([
    { role: "user", content: "I need help." },
    { role: "assistant", content: "I can help." },
    { role: "assistant", content: "I have taken over." },
  ]);
});

test("parse compatibility regression: legacy rows lose their fallback ownership or explicit AI mode", () => {
  const explicit = parseChatState(
    JSON.stringify({ aiParticipation: "assist_until_agent" }),
  );
  const legacy = parseChatState(JSON.stringify({ state: "agent_mode" }), {
    fallbackAiParticipation: "human_only",
  });

  expect(explicit.aiParticipation).toBe("assist_until_agent");
  expect(legacy.aiParticipation).toBe("human_only");
});

test("ownership initialization regression: new threads skip continuous AI or team requests skip escalation", () => {
  const initial = createInitialChatState();
  const escalating = applyChatOwnershipEvent(initial, "team_requested");

  expect(initial).toMatchObject({
    state: "active",
    aiParticipation: "continuous",
    ownershipRevision: 0,
  });
  expect(escalating).toMatchObject({
    state: "escalating",
    aiParticipation: "assist_until_agent",
    ownershipRevision: initial.ownershipRevision + 1,
  });
});

test("ownership transition regression: AI resumes after a human takeover before explicit handback", () => {
  const initial = createInitialChatState();
  const humanOwned = applyChatOwnershipEvent(initial, "human_joined");
  const stillHumanOwned = applyChatOwnershipEvent(
    humanOwned,
    "team_requested",
  );
  const handedBack = applyChatOwnershipEvent(humanOwned, "ai_handed_back");

  expect(humanOwned).toMatchObject({
    state: "agent_mode",
    aiParticipation: "human_only",
    ownershipRevision: initial.ownershipRevision + 1,
  });
  expect(stillHumanOwned.aiParticipation).toBe("human_only");
  expect(handedBack).toMatchObject({
    state: "active",
    aiParticipation: "continuous",
    activeHumanRoutes: [],
    ownershipRevision: humanOwned.ownershipRevision + 1,
  });
});

test("joins and deduplicates external human routes by client identity", () => {
  const telegram = activeHumanRouteFromMessage({
    origin: "telegram",
    userId: null,
    id: "telegram-message",
  });
  const firstEmail = activeHumanRouteFromMessage({
    origin: "email",
    userId: "user-1",
    id: "email-message-1",
  });
  const newerEmail = activeHumanRouteFromMessage({
    origin: "email",
    userId: "user-1",
    id: "email-message-2",
    externalReplyTo: "agent-thread-message-2",
  });

  let routes = joinActiveHumanRoute([], telegram);
  routes = joinActiveHumanRoute(routes, firstEmail);
  routes = joinActiveHumanRoute(routes, telegram);
  routes = joinActiveHumanRoute(routes, newerEmail);

  expect(routes).toEqual([
    { kind: "agent_channel", channel: "telegram" },
    {
      kind: "email",
      userId: "user-1",
    },
  ]);
  expect(activeHumanRouteFromMessage({
    origin: "dashboard",
    userId: "user-1",
    id: "dashboard-message",
  })).toBeNull();
  expect(activeHumanRouteFromMessage({
    origin: "mcp",
    userId: "user-1",
    id: "mcp-message",
  })).toBeNull();
});

test("parses valid joined routes and drops malformed stored entries", () => {
  const parsed = parseChatState(JSON.stringify({
    aiParticipation: "human_only",
    activeHumanRoutes: [
      { kind: "agent_channel", channel: "slack" },
      { kind: "agent_channel", channel: "unknown" },
      {
        kind: "email",
        userId: "user-1",
        replyToMessageId: "message-1",
      },
      { kind: "email", userId: "", replyToMessageId: "message-2" },
    ],
  }));

  expect(parsed.activeHumanRoutes).toEqual([
    { kind: "agent_channel", channel: "slack" },
    {
      kind: "email",
      userId: "user-1",
    },
  ]);
});

test("infers only reliably tagged legacy routes after escalation", () => {
  const routes = inferLegacyActiveHumanRoutes([
    {
      id: "before",
      author: "agent",
      origin: "telegram",
      userId: null,
      createdAt: 99,
    },
    {
      id: "telegram",
      author: "agent",
      origin: "telegram",
      userId: null,
      createdAt: 101,
    },
    {
      id: "email",
      author: "agent",
      origin: "email",
      userId: "user-1",
      createdAt: 102,
    },
    {
      id: "untagged",
      author: "agent",
      origin: null,
      userId: "user-2",
      createdAt: 103,
    },
  ], 100);

  expect(routes).toEqual([
    { kind: "agent_channel", channel: "telegram" },
    {
      kind: "email",
      userId: "user-1",
    },
  ]);
  expect(inferLegacyActiveHumanRoutes([], null)).toEqual([]);
});

test.each([
  ["active", "continuous"],
  ["closed", "continuous"],
  ["waiting_agent", "assist_until_agent"],
  ["agent_replied", "human_only"],
] as const)(
  "legacy status compatibility regression: %s receives the wrong AI participation (%s expected)",
  (status, expected) => {
    expect(fallbackAiParticipationForStatus(status)).toBe(expected);
  },
);

test("persistence race regression: stale AI state overwrites a newer takeover or handback and drops one-shot metadata", () => {
  const initial = createInitialChatState();
  const humanOwned = applyChatOwnershipEvent(initial, "human_joined");
  const staleAi = {
    ...initial,
    state: "answering" as const,
  };
  const handedBack = applyChatOwnershipEvent(humanOwned, "ai_handed_back");
  const oneShotResult = {
    ...humanOwned,
    state: "answering" as const,
    lastIntent: "troubleshoot",
  };

  expect(mergeChatStateForPersistence(humanOwned, staleAi)).toMatchObject({
    state: "agent_mode",
    aiParticipation: "human_only",
    activeHumanRoutes: humanOwned.activeHumanRoutes,
    ownershipRevision: humanOwned.ownershipRevision,
  });
  expect(mergeChatStateForPersistence(handedBack, humanOwned)).toMatchObject({
    state: "active",
    aiParticipation: "continuous",
    ownershipRevision: handedBack.ownershipRevision,
  });
  expect(mergeChatStateForPersistence(humanOwned, oneShotResult)).toMatchObject({
    state: "agent_mode",
    aiParticipation: "human_only",
    lastIntent: "troubleshoot",
  });
});

test("AI output persistence regression: ordinary output overwrites human or closed conversations", () => {
  expect(
    canPersistAiOutput({
      participationAtTurnStart: "assist_until_agent",
      currentParticipation: "human_only",
      currentStatus: "agent_replied",
      aiInvoked: false,
      resolvedByThisTurn: false,
    }),
  ).toBe(false);
  expect(
    canPersistAiOutput({
      participationAtTurnStart: "continuous",
      currentParticipation: "continuous",
      currentStatus: "closed",
      aiInvoked: false,
      resolvedByThisTurn: false,
    }),
  ).toBe(false);
  expect(
    canPersistAiOutput({
      participationAtTurnStart: "human_only",
      currentParticipation: "human_only",
      currentStatus: "agent_replied",
      aiInvoked: true,
      resolvedByThisTurn: false,
    }),
  ).toBe(true);
});

test("concurrency regression: an AI snapshot remains current after ownership revision advances", () => {
  expect(
    isChatOwnershipSnapshotCurrent(
      { status: "agent_replied", chatState: '{"ownershipRevision":2}' },
      { status: "agent_replied", chatState: '{"ownershipRevision":3}' },
    ),
  ).toBe(false);
});
