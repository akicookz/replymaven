import { describe, expect, test } from "bun:test";
import {
  identifyFastPath,
  identifyHardGate,
} from "./identify-fast-path";

describe("identifyFastPath", () => {
  test("returns a greeting only for the whole message", () => {
    expect(
      identifyFastPath({
        message: "hello!",
        scopeDecision: null,
        faqMatch: null,
      }),
    ).toMatchObject({ kind: "small_talk", composeKind: "greeting" });
    expect(
      identifyFastPath({
        message: "hello, how much is Pro?",
        scopeDecision: null,
        faqMatch: null,
      }),
    ).toBeNull();
  });

  test("does not close a turn with unresolved language", () => {
    expect(
      identifyFastPath({
        message: "thanks, but I still cannot log in",
        scopeDecision: null,
        faqMatch: null,
      }),
    ).toBeNull();
  });

  test("does not fast-path while a persisted workflow is pending", () => {
    expect(
      identifyFastPath({
        message: "thanks",
        scopeDecision: null,
        faqMatch: null,
        hasPendingWorkflow: true,
      }),
    ).toBeNull();
  });

  test("does not fast-path image turns", () => {
    expect(
      identifyFastPath({
        message: "hello",
        scopeDecision: null,
        faqMatch: null,
        hasImage: true,
      }),
    ).toBeNull();
  });

  test("scope block takes precedence over FAQ evidence", () => {
    expect(
      identifyFastPath({
        message: "tell me a joke",
        scopeDecision: {
          kind: "out_of_scope_general",
          reason: "general_creative_request",
          response: "Support questions only.",
        },
        faqMatch: {
          question: "Tell me a joke",
          answer: "No.",
          score: 1,
          precision: 1,
          recall: 1,
          margin: 1,
          authoritative: true,
          matchKind: "exact",
        },
      }),
    ).toEqual({
      kind: "scope_blocked",
      reason: "general_creative_request",
      response: "Support questions only.",
    });
  });

  test("returns only authoritative FAQ matches", () => {
    const baseMatch = {
      question: "How do I invite a team member?",
      answer: "Open Dashboard > Team.",
      score: 0.9,
      precision: 0.9,
      recall: 0.9,
      margin: 0.2,
      matchKind: "lexical" as const,
    };

    expect(
      identifyFastPath({
        message: "How do I invite a team member?",
        scopeDecision: null,
        faqMatch: { ...baseMatch, authoritative: true },
      }),
    ).toMatchObject({ kind: "authoritative_faq" });

    expect(
      identifyFastPath({
        message: "Invite someone and restrict their domain",
        scopeDecision: null,
        faqMatch: { ...baseMatch, authoritative: false },
      }),
    ).toBeNull();
  });

  test("keeps FAQ turns on the planner path when priority instructions exist", () => {
    expect(
      identifyFastPath({
        message: "How do I invite a team member?",
        scopeDecision: null,
        faqMatch: {
          question: "How do I invite a team member?",
          answer: "Open Dashboard > Team.",
          score: 1,
          precision: 1,
          recall: 1,
          margin: 1,
          authoritative: true,
          matchKind: "exact",
        },
        hasPriorityInstructions: true,
      }),
    ).toBeNull();
  });
});

test.each(["waiting_agent", "agent_replied"])(
  "always identifies %s as agent mode",
  (status) => {
    expect(identifyHardGate({ status, closeReason: null })).toBe("agent_mode");
  },
);

test("identifies spam as muted before agent mode", () => {
  expect(identifyHardGate({ status: "closed", closeReason: "spam" })).toBe(
    "muted",
  );
});
