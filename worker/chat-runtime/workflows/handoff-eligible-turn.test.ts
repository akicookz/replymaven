import { describe, expect, test } from "bun:test";
import {
  detectClarificationLoop,
  detectExplicitEscalation,
  detectFrustration,
} from "./fast-paths";
import {
  createInitialChatState,
  type ConversationChatState,
} from "../types";

interface HandoffEligibility {
  handoffEligibleTurn: boolean;
  handoffEligibleReason: string | null;
}

function computeHandoffEligibility(
  message: string,
  chatState: ConversationChatState,
): HandoffEligibility {
  const explicitEscalation = detectExplicitEscalation(message);
  const visitorFrustrated = detectFrustration(message);
  const clarificationLoop = detectClarificationLoop({
    chatState,
    currentMessage: message,
    frustrated: visitorFrustrated,
  });

  const handoffEligibleTurn =
    explicitEscalation.matched ||
    visitorFrustrated ||
    clarificationLoop.shouldEscalate;

  const handoffEligibleReason = explicitEscalation.matched
    ? explicitEscalation.reason
    : clarificationLoop.shouldEscalate
      ? clarificationLoop.reason
      : visitorFrustrated
        ? "visitor_frustrated"
        : null;

  return { handoffEligibleTurn, handoffEligibleReason };
}

describe("handoff eligibility computation", () => {
  test("returns false for benign messages with no clarification history", () => {
    const result = computeHandoffEligibility(
      "How do I install the widget?",
      createInitialChatState(),
    );
    expect(result.handoffEligibleTurn).toBe(false);
    expect(result.handoffEligibleReason).toBe(null);
  });

  test("prioritizes explicit escalation reason over frustration and loop", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 3,
    };
    const result = computeHandoffEligibility(
      "this is ridiculous, can I speak to a human",
      chatState,
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe("explicit_escalation_keyword");
  });

  test("flags clarification loop when attempts exhausted", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 3,
    };
    const result = computeHandoffEligibility(
      "it still does not work",
      chatState,
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe(
      "clarification_attempts_exhausted",
    );
  });

  test("flags frustration even without explicit escalation or loop", () => {
    const result = computeHandoffEligibility(
      "this is useless",
      createInitialChatState(),
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe("visitor_frustrated");
  });

  test("clarification loop reason takes precedence over plain frustration", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 2,
    };
    const result = computeHandoffEligibility(
      "this is ridiculous",
      chatState,
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe(
      "clarification_with_frustration",
    );
  });

  test("does not flag turns where user politely asks a new question", () => {
    const chatState: ConversationChatState = {
      ...createInitialChatState(),
      clarificationAttempts: 1,
    };
    const result = computeHandoffEligibility(
      "thanks, one more question about pricing",
      chatState,
    );
    expect(result.handoffEligibleTurn).toBe(false);
    expect(result.handoffEligibleReason).toBe(null);
  });

  test("flags visitor requesting live agent", () => {
    const result = computeHandoffEligibility(
      "I need a live agent please",
      createInitialChatState(),
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe("explicit_escalation_keyword");
  });

  test("flags visitor saying it is urgent", () => {
    const result = computeHandoffEligibility(
      "this is urgent, please help",
      createInitialChatState(),
    );
    expect(result.handoffEligibleTurn).toBe(true);
    expect(result.handoffEligibleReason).toBe("explicit_escalation_keyword");
  });
});
