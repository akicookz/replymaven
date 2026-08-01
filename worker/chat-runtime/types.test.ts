import { describe, expect, test } from "bun:test";
import {
  applyChatOwnershipEvent,
  canPersistAiOutput,
  createInitialChatState,
  fallbackAiParticipationForStatus,
  isChatOwnershipSnapshotCurrent,
  mergeChatStateForPersistence,
  parseChatState,
} from "./types";

describe("conversation AI participation", () => {
  test("starts new conversations with continuous AI participation", () => {
    expect(createInitialChatState().aiParticipation).toBe("continuous");
  });

  test("preserves an explicit assist-until-agent mode", () => {
    const parsed = parseChatState(
      JSON.stringify({ aiParticipation: "assist_until_agent" }),
    );

    expect(parsed.aiParticipation).toBe("assist_until_agent");
  });

  test("uses human-only fallback for legacy agent conversations", () => {
    const parsed = parseChatState(JSON.stringify({ state: "agent_mode" }), {
      fallbackAiParticipation: "human_only",
    });

    expect(parsed.aiParticipation).toBe("human_only");
  });
});

describe("applyChatOwnershipEvent", () => {
  test("moves an AI-owned thread into assist mode when the team is requested", () => {
    const next = applyChatOwnershipEvent(
      createInitialChatState(),
      "team_requested",
    );

    expect(next.aiParticipation).toBe("assist_until_agent");
  });

  test("does not reactivate AI when a team request is submitted after a human joined", () => {
    const humanState = applyChatOwnershipEvent(
      createInitialChatState(),
      "human_joined",
    );

    expect(
      applyChatOwnershipEvent(humanState, "team_requested").aiParticipation,
    ).toBe("human_only");
  });

  test("human reply silences AI until an explicit handback", () => {
    const humanState = applyChatOwnershipEvent(
      createInitialChatState(),
      "human_joined",
    );
    const handedBack = applyChatOwnershipEvent(humanState, "ai_handed_back");

    expect(humanState).toMatchObject({
      state: "agent_mode",
      aiParticipation: "human_only",
    });
    expect(handedBack).toMatchObject({
      state: "active",
      aiParticipation: "continuous",
    });
  });
});

test.each([
  ["active", "continuous"],
  ["closed", "continuous"],
  ["waiting_agent", "assist_until_agent"],
  ["agent_replied", "human_only"],
] as const)(
  "legacy %s conversations default to %s AI participation",
  (status, expected) => {
    expect(fallbackAiParticipationForStatus(status)).toBe(expected);
  },
);

test("an in-flight AI turn cannot overwrite a human takeover", () => {
  const humanState = applyChatOwnershipEvent(
    createInitialChatState(),
    "human_joined",
  );
  const staleAiState = applyChatOwnershipEvent(
    createInitialChatState(),
    "team_requested",
  );

  expect(
    mergeChatStateForPersistence(humanState, staleAiState),
  ).toMatchObject({
    state: "agent_mode",
    aiParticipation: "human_only",
  });
});

test("a one-shot AI turn leaves the conversation in human-owned agent mode", () => {
  const humanState = applyChatOwnershipEvent(
    createInitialChatState(),
    "human_joined",
  );
  const oneShotResult = {
    ...humanState,
    state: "answering" as const,
    lastIntent: "troubleshoot",
  };

  expect(mergeChatStateForPersistence(humanState, oneShotResult)).toMatchObject({
    state: "agent_mode",
    aiParticipation: "human_only",
    lastIntent: "troubleshoot",
  });
});

test("a completed handback cannot be overwritten by stale one-shot AI state", () => {
  const handedBackState = applyChatOwnershipEvent(
    applyChatOwnershipEvent(createInitialChatState(), "human_joined"),
    "ai_handed_back",
  );
  const staleOneShotState = applyChatOwnershipEvent(
    createInitialChatState(),
    "human_joined",
  );

  expect(
    mergeChatStateForPersistence(handedBackState, staleOneShotState),
  ).toMatchObject({
    state: "active",
    aiParticipation: "continuous",
  });
});

describe("canPersistAiOutput", () => {
  test("suppresses an assist-mode reply when a human joined during the turn", () => {
    expect(
      canPersistAiOutput({
        participationAtTurnStart: "assist_until_agent",
        currentParticipation: "human_only",
        currentStatus: "agent_replied",
        aiInvoked: false,
        resolvedByThisTurn: false,
      }),
    ).toBe(false);
  });

  test("allows the explicitly invoked one-shot reply to finish", () => {
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

  test("denies ordinary AI output after the conversation was closed", () => {
    expect(
      canPersistAiOutput({
        participationAtTurnStart: "continuous",
        currentParticipation: "continuous",
        currentStatus: "closed",
        aiInvoked: false,
        resolvedByThisTurn: false,
      }),
    ).toBe(false);
  });
});

test("ownership events advance the ownership revision", () => {
  const initial = createInitialChatState();
  const next = applyChatOwnershipEvent(initial, "human_joined");

  expect(next.ownershipRevision).toBe(initial.ownershipRevision + 1);
});

test("an invoked AI turn cannot adopt a newer human ownership revision", () => {
  expect(
    isChatOwnershipSnapshotCurrent(
      { status: "agent_replied", chatState: '{"ownershipRevision":2}' },
      { status: "agent_replied", chatState: '{"ownershipRevision":3}' },
    ),
  ).toBe(false);
});
