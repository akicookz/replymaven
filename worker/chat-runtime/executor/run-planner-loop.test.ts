import { describe, expect, test } from "bun:test";
import {
  buildComposerFaqEvidence,
  buildFastPathPlannerDecision,
} from "./run-planner-loop";

describe("buildComposerFaqEvidence", () => {
  test("preserves both curated and retrieved FAQ evidence", () => {
    const curated = '<source type="faq-curated">Curated answer</source>';
    const retrieved = '<source type="faq-retrieved">Retrieved answer</source>';

    expect(
      buildComposerFaqEvidence({
        compiledFaqContext: curated,
        retrievedFaqContext: retrieved,
      }),
    ).toBe(`${curated}\n\n${retrieved}`);
  });

  test("deduplicates the same FAQ source block", () => {
    const source = '<source type="faq">Shared answer</source>';

    expect(
      buildComposerFaqEvidence({
        compiledFaqContext: source,
        retrievedFaqContext: source,
      }),
    ).toBe(source);
  });
});

describe("buildFastPathPlannerDecision", () => {
  test("translates a greeting into a compose decision", () => {
    expect(
      buildFastPathPlannerDecision({
        goal: "Help the visitor.",
        decision: {
          kind: "small_talk",
          reason: "pure_greeting",
          composeKind: "greeting",
        },
      }),
    ).toEqual({
      goal: "Help the visitor.",
      intent: "smalltalk",
      nextAction: {
        type: "compose",
        reason: "pure_greeting",
        composeKind: "greeting",
      },
    });
  });

  test("translates an FAQ into a grounded compose decision", () => {
    expect(
      buildFastPathPlannerDecision({
        goal: "Answer from the curated FAQ.",
        decision: {
          kind: "authoritative_faq",
          reason: "exact_faq",
          faq: {
            question: "How do I invite a team member?",
            answer: "Open Dashboard > Team.",
            score: 1,
          },
        },
      }),
    ).toMatchObject({
      nextAction: { type: "compose", composeKind: "grounded" },
    });
  });

  test("returns null for scope responses handled by the outer handler", () => {
    expect(
      buildFastPathPlannerDecision({
        goal: "Redirect unrelated requests.",
        decision: {
          kind: "scope_blocked",
          reason: "general_creative_request",
          response: "Support questions only.",
        },
      }),
    ).toBeNull();
  });
});
