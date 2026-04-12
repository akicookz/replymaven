import { type ConversationChatState } from "../types";
import {
  detectClarificationLoop,
  detectExplicitEscalation,
  detectFrustration,
} from "./fast-paths";

export type HandoffSopTrigger =
  | "explicit_escalation"
  | "visitor_frustrated"
  | "clarification_exhausted"
  | "clarification_with_frustration"
  | "unresolved_after_retrieval"
  | "none";

export interface HandoffSopDecision {
  shouldOverride: boolean;
  trigger: HandoffSopTrigger;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface ClassifyHandoffSopInput {
  message: string;
  chatState: ConversationChatState;
  retrievalAttempted: boolean;
  groundingConfidence: "high" | "low" | "none";
  handoffEligibleTurn: boolean;
  handoffEligibleReason: string | null;
}

export function classifyHandoffSop(
  input: ClassifyHandoffSopInput,
): HandoffSopDecision {
  const explicitEscalation = detectExplicitEscalation(input.message);
  if (explicitEscalation.matched) {
    return {
      shouldOverride: true,
      trigger: "explicit_escalation",
      reason: explicitEscalation.reason,
      priority: "high",
    };
  }

  const frustrated = detectFrustration(input.message);
  const clarificationLoop = detectClarificationLoop({
    chatState: input.chatState,
    currentMessage: input.message,
    frustrated,
  });

  if (
    clarificationLoop.shouldEscalate &&
    clarificationLoop.reason === "clarification_attempts_exhausted"
  ) {
    return {
      shouldOverride: true,
      trigger: "clarification_exhausted",
      reason: "clarification_attempts_exhausted",
      priority: "high",
    };
  }

  if (
    clarificationLoop.shouldEscalate &&
    clarificationLoop.reason === "clarification_with_frustration"
  ) {
    return {
      shouldOverride: true,
      trigger: "clarification_with_frustration",
      reason: "clarification_with_frustration",
      priority: "high",
    };
  }

  if (frustrated) {
    return {
      shouldOverride: true,
      trigger: "visitor_frustrated",
      reason: "visitor_frustrated",
      priority: "medium",
    };
  }

  if (
    input.retrievalAttempted &&
    input.groundingConfidence === "none" &&
    input.chatState.clarificationAttempts >= 2
  ) {
    return {
      shouldOverride: true,
      trigger: "unresolved_after_retrieval",
      reason: "no_grounding_after_retrieval_and_clarification",
      priority: "medium",
    };
  }

  if (input.handoffEligibleTurn && input.handoffEligibleReason) {
    return {
      shouldOverride: true,
      trigger: "explicit_escalation",
      reason: input.handoffEligibleReason,
      priority: "low",
    };
  }

  return {
    shouldOverride: false,
    trigger: "none",
    reason: "no_override_conditions_met",
    priority: "low",
  };
}
