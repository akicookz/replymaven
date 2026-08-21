import { describe, expect, test } from "bun:test";
import {
  identifyHardGate,
  parseAgentBotNameCommand,
  parseVisitorAiInvocation,
} from "./public-turn-gates";

describe("human ownership gate", () => {
  test("silences ordinary turns in human-owned conversations but permits an explicit AI invocation", () => {
    expect(
      identifyHardGate({
        status: "active",
        closeReason: null,
        aiParticipation: "human_only",
        aiInvoked: false,
      }),
    ).toBe("agent_mode");
    expect(
      identifyHardGate({
        status: "agent_replied",
        closeReason: null,
        aiParticipation: "human_only",
        aiInvoked: true,
      }),
    ).toBeNull();
  });

  test("blocks closed conversations and mutes spam before agent mode", () => {
    expect(identifyHardGate({ status: "closed", closeReason: null })).toBe(
      "closed",
    );
    expect(identifyHardGate({ status: "closed", closeReason: "spam" })).toBe(
      "muted",
    );
  });
});

test("AI invocation requires a non-empty leading bot mention", () => {
  expect(parseVisitorAiInvocation("@mAvEn, investigate this", "Maven")).toEqual({
    invoked: true,
    content: "investigate this",
  });
  expect(parseVisitorAiInvocation("investigate this", "Maven").invoked).toBe(
    false,
  );
  expect(parseVisitorAiInvocation("@Maven", "Maven").invoked).toBe(false);
});

test("agent @BotName commands allow a bare mention", () => {
  expect(parseAgentBotNameCommand("@Maven", "Maven")).toEqual({
    isCommand: true,
    commandText: "",
  });
  expect(parseAgentBotNameCommand(
    "@Maven, this is yours when they come back",
    "Maven",
  )).toEqual({
    isCommand: true,
    commandText: "this is yours when they come back",
  });
  expect(parseAgentBotNameCommand("Hi Maven, how can I verify?", "Maven"))
    .toEqual({
      isCommand: false,
      commandText: "Hi Maven, how can I verify?",
    });
});
