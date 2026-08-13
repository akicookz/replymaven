import { describe, expect, test } from "bun:test";
import { createInitialChatState } from "../../../chat-runtime/types";
import { resolvePendingPublicContactUpdate } from "./public-human-mode";

describe("public Agent human-mode continuity", () => {
  test("extracts a pending name and email before the model turn", () => {
    expect(resolvePendingPublicContactUpdate({
      status: "active",
      chatState: {
        ...createInitialChatState(),
        awaitingContactFields: ["name", "email"],
      },
      message: "Ada, ada@example.com",
    })).toEqual({
      visitorName: "Ada",
      visitorEmail: "ada@example.com",
      awaitingContactFields: [],
      contactDeclined: false,
    });
  });

  test("records a decline but ignores ordinary replies and human-owned turns", () => {
    const pending = {
      ...createInitialChatState(),
      awaitingContactFields: ["email" as const],
    };
    expect(resolvePendingPublicContactUpdate({
      status: "active",
      chatState: pending,
      message: "I don't want to share that",
    })).toEqual({
      awaitingContactFields: [],
      contactDeclined: true,
    });
    expect(resolvePendingPublicContactUpdate({
      status: "active",
      chatState: pending,
      message: "Can you help me?",
    })).toBeNull();
    expect(resolvePendingPublicContactUpdate({
      status: "agent_replied",
      chatState: {
        ...pending,
        aiParticipation: "human_only",
      },
      message: "ada@example.com",
    })).toBeNull();
  });
});
