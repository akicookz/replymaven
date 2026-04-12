import { describe, expect, test } from "bun:test";
import { classifyHandoffSop } from "./classify-handoff-sop";
import {
  createInitialChatState,
  type ConversationChatState,
} from "../types";

function baseInput(overrides: {
  message: string;
  chatState?: ConversationChatState;
  retrievalAttempted?: boolean;
  groundingConfidence?: "high" | "low" | "none";
  handoffEligibleTurn?: boolean;
  handoffEligibleReason?: string | null;
}) {
  return {
    message: overrides.message,
    chatState: overrides.chatState ?? createInitialChatState(),
    retrievalAttempted: overrides.retrievalAttempted ?? false,
    groundingConfidence: overrides.groundingConfidence ?? "high",
    handoffEligibleTurn: overrides.handoffEligibleTurn ?? false,
    handoffEligibleReason: overrides.handoffEligibleReason ?? null,
  } as const;
}

describe("classifyHandoffSop", () => {
  test("returns high-priority explicit_escalation when visitor asks for a human", () => {
    const decision = classifyHandoffSop(
      baseInput({ message: "Can I speak to a human please?" }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("explicit_escalation");
    expect(decision.reason).toBe("explicit_escalation_keyword");
    expect(decision.priority).toBe("high");
  });

  test("returns high-priority explicit_escalation when visitor says it is urgent", () => {
    const decision = classifyHandoffSop(
      baseInput({ message: "this is urgent, I need help" }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("explicit_escalation");
    expect(decision.priority).toBe("high");
  });

  test("returns high-priority clarification_exhausted after 3 attempts", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 3,
    };
    const decision = classifyHandoffSop(
      baseInput({ message: "it still does not work", chatState }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("clarification_exhausted");
    expect(decision.reason).toBe("clarification_attempts_exhausted");
    expect(decision.priority).toBe("high");
  });

  test("returns high-priority clarification_with_frustration at 2 attempts + frustration", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({ message: "this is ridiculous", chatState }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("clarification_with_frustration");
    expect(decision.reason).toBe("clarification_with_frustration");
    expect(decision.priority).toBe("high");
  });

  test("returns medium-priority visitor_frustrated on plain frustration", () => {
    const decision = classifyHandoffSop(
      baseInput({ message: "this is useless" }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("visitor_frustrated");
    expect(decision.reason).toBe("visitor_frustrated");
    expect(decision.priority).toBe("medium");
  });

  test("returns medium-priority unresolved_after_retrieval when grounding fails after 2 clarifications", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "I still need help with something",
        chatState,
        retrievalAttempted: true,
        groundingConfidence: "none",
      }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("unresolved_after_retrieval");
    expect(decision.reason).toBe("no_grounding_after_retrieval_and_clarification");
    expect(decision.priority).toBe("medium");
  });

  test("does not trigger unresolved_after_retrieval when grounding is low (not none)", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "help me figure this out",
        chatState,
        retrievalAttempted: true,
        groundingConfidence: "low",
      }),
    );
    expect(decision.shouldOverride).toBe(false);
    expect(decision.trigger).toBe("none");
  });

  test("does not trigger unresolved_after_retrieval when retrieval was not attempted", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "help me figure this out",
        chatState,
        retrievalAttempted: false,
        groundingConfidence: "none",
      }),
    );
    expect(decision.shouldOverride).toBe(false);
    expect(decision.trigger).toBe("none");
  });

  test("does not trigger unresolved_after_retrieval with only 1 clarification attempt", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 1,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "help me figure this out",
        chatState,
        retrievalAttempted: true,
        groundingConfidence: "none",
      }),
    );
    expect(decision.shouldOverride).toBe(false);
    expect(decision.trigger).toBe("none");
  });

  test("returns low-priority fallback when handoffEligibleTurn is set with a reason", () => {
    const decision = classifyHandoffSop(
      baseInput({
        message: "hello there",
        handoffEligibleTurn: true,
        handoffEligibleReason: "upstream_signal_reason",
      }),
    );
    expect(decision.shouldOverride).toBe(true);
    expect(decision.trigger).toBe("explicit_escalation");
    expect(decision.reason).toBe("upstream_signal_reason");
    expect(decision.priority).toBe("low");
  });

  test("does not trigger fallback when handoffEligibleTurn is true but reason is null", () => {
    const decision = classifyHandoffSop(
      baseInput({
        message: "hello there",
        handoffEligibleTurn: true,
        handoffEligibleReason: null,
      }),
    );
    expect(decision.shouldOverride).toBe(false);
    expect(decision.trigger).toBe("none");
  });

  test("returns no override for benign messages with no triggers", () => {
    const decision = classifyHandoffSop(
      baseInput({ message: "How do I install the widget?" }),
    );
    expect(decision.shouldOverride).toBe(false);
    expect(decision.trigger).toBe("none");
    expect(decision.reason).toBe("no_override_conditions_met");
    expect(decision.priority).toBe("low");
  });

  test("prioritizes explicit escalation over clarification loop", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 3,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "can I speak to a human",
        chatState,
      }),
    );
    expect(decision.trigger).toBe("explicit_escalation");
    expect(decision.priority).toBe("high");
  });

  test("prioritizes clarification_exhausted over plain frustration", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 3,
    };
    const decision = classifyHandoffSop(
      baseInput({ message: "this is useless", chatState }),
    );
    expect(decision.trigger).toBe("clarification_exhausted");
    expect(decision.priority).toBe("high");
  });

  test("prioritizes clarification_with_frustration over visitor_frustrated alone", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({ message: "this is ridiculous", chatState }),
    );
    expect(decision.trigger).toBe("clarification_with_frustration");
  });

  test("prioritizes frustration over upstream handoffEligibleTurn fallback", () => {
    const decision = classifyHandoffSop(
      baseInput({
        message: "this is useless",
        handoffEligibleTurn: true,
        handoffEligibleReason: "some_upstream_reason",
      }),
    );
    expect(decision.trigger).toBe("visitor_frustrated");
    expect(decision.priority).toBe("medium");
  });

  test("prioritizes unresolved_after_retrieval over upstream fallback", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const decision = classifyHandoffSop(
      baseInput({
        message: "help me please",
        chatState,
        retrievalAttempted: true,
        groundingConfidence: "none",
        handoffEligibleTurn: true,
        handoffEligibleReason: "some_upstream_reason",
      }),
    );
    expect(decision.trigger).toBe("unresolved_after_retrieval");
    expect(decision.priority).toBe("medium");
  });
});
