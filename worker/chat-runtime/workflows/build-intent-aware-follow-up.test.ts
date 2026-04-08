import { describe, expect, test } from "bun:test";
import {
  buildIntentAwareFollowUpQuestion,
  buildIntentAwareUnsupportedFallback,
} from "./build-intent-aware-follow-up";

describe("buildIntentAwareFollowUpQuestion", () => {
  test("uses pricing-specific clarification for discount questions", () => {
    expect(
      buildIntentAwareFollowUpQuestion({
        userMessage: "Could I get a discount code for the Pro plan?",
        intent: "policy",
      }),
    ).toContain("plan, pricing detail, or discount request");
  });

  test("asks for issue context first for human handoff requests", () => {
    expect(
      buildIntentAwareFollowUpQuestion({
        userMessage: "live agent",
        intent: "handoff",
      }),
    ).toContain("what you need help with");
  });
});

describe("buildIntentAwareUnsupportedFallback", () => {
  test("avoids troubleshooting wording for pricing fallback copy", () => {
    expect(
      buildIntentAwareUnsupportedFallback({
        userMessage: "Could I get a discount code for the Pro plan?",
        intent: "policy",
      }),
    ).not.toContain("feature, page, step, or error");
  });
});
