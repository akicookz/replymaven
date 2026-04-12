import { describe, expect, test } from "bun:test";
import { promoteActionForHandoffOverride } from "./promote-action-for-handoff-override";
import { type HandoffSopDecision } from "../workflows/classify-handoff-sop";
import { type PlannerNextAction } from "../types";

const OVERRIDE_DECISION: HandoffSopDecision = {
  shouldOverride: true,
  trigger: "visitor_frustrated",
  reason: "visitor_frustrated",
  priority: "medium",
};

const NON_OVERRIDE_DECISION: HandoffSopDecision = {
  shouldOverride: false,
  trigger: "none",
  reason: "no_override_conditions_met",
  priority: "low",
};

describe("promoteActionForHandoffOverride", () => {
  test("returns action untouched when decision is null", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: null,
      missingContactFields: ["name", "email"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
    expect(result.promotionNote).toBeNull();
  });

  test("returns action untouched when decision is undefined", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: undefined,
      missingContactFields: [],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("returns action untouched when shouldOverride is false", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: NON_OVERRIDE_DECISION,
      missingContactFields: ["name"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("leaves offer_handoff untouched even when override is active", () => {
    const action: PlannerNextAction = {
      type: "offer_handoff",
      reason: "visitor asked",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["name", "email"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("leaves collect_contact untouched even when override is active", () => {
    const action: PlannerNextAction = {
      type: "collect_contact",
      reason: "need contact",
      missingFields: ["email"],
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["email"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("leaves create_inquiry untouched even when override is active", () => {
    const action: PlannerNextAction = {
      type: "create_inquiry",
      reason: "ready to forward",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: [],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("leaves ask_user untouched even when override is active", () => {
    const action: PlannerNextAction = {
      type: "ask_user",
      reason: "need detail",
      question: "Which plan?",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["name"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(false);
    expect(result.action).toBe(action);
  });

  test("promotes search_docs to collect_contact when fields are missing", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["name", "email"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(true);
    expect(result.action.type).toBe("collect_contact");
    if (result.action.type === "collect_contact") {
      expect(result.action.missingFields).toEqual(["name", "email"]);
      expect(result.action.reason).toContain("hard-promoted");
      expect(result.action.reason).toContain("visitor_frustrated");
    }
    expect(result.promotionNote).toContain("hard-promoted");
  });

  test("promotes compose to collect_contact when only email is missing", () => {
    const action: PlannerNextAction = {
      type: "compose",
      reason: "ready to answer",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["email"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(true);
    expect(result.action.type).toBe("collect_contact");
    if (result.action.type === "collect_contact") {
      expect(result.action.missingFields).toEqual(["email"]);
    }
  });

  test("promotes call_tool to create_inquiry when no fields are missing", () => {
    const action: PlannerNextAction = {
      type: "call_tool",
      reason: "check status",
      toolName: "lookup_order",
      input: { orderId: "123" },
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: [],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(true);
    expect(result.action.type).toBe("create_inquiry");
    if (result.action.type === "create_inquiry") {
      expect(result.action.reason).toContain("hard-promoted");
    }
  });

  test("promotes search_docs to create_inquiry when contact was declined", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: ["name", "email"],
      contactDeclined: true,
    });

    expect(result.promoted).toBe(true);
    expect(result.action.type).toBe("create_inquiry");
  });

  test("promotes stop to create_inquiry when nothing is missing", () => {
    const action: PlannerNextAction = {
      type: "stop",
      reason: "done",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: OVERRIDE_DECISION,
      missingContactFields: [],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(true);
    expect(result.action.type).toBe("create_inquiry");
  });

  test("promotion note includes the trigger for explicit_escalation", () => {
    const action: PlannerNextAction = {
      type: "search_docs",
      reason: "need docs",
      query: "pricing",
    };
    const result = promoteActionForHandoffOverride({
      action,
      handoffSopDecision: {
        shouldOverride: true,
        trigger: "explicit_escalation",
        reason: "user_asked_for_human",
        priority: "high",
      },
      missingContactFields: ["name"],
      contactDeclined: false,
    });

    expect(result.promoted).toBe(true);
    expect(result.promotionNote).toContain("explicit_escalation");
  });
});
