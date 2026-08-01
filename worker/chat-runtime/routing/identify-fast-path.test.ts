import { describe, expect, test } from "bun:test";
import {
  identifyFastPath,
  identifyHardGate,
  parseVisitorAiInvocation,
} from "./identify-fast-path";

describe("fast-path routing", () => {
  test("bypasses planning only for a whole-turn greeting", () => {
    expect(
      identifyFastPath({ message: "hello", scopeDecision: null, faqMatch: null }),
    ).toMatchObject({ kind: "small_talk" });
    expect(
      identifyFastPath({
        message: "hello, the widget is broken",
        scopeDecision: null,
        faqMatch: null,
      }),
    ).toBeNull();
  });

  test("keeps non-simple turns on the planner path", () => {
    const base = { message: "thanks", scopeDecision: null, faqMatch: null };
    expect(identifyFastPath({ ...base, hasPendingWorkflow: true })).toBeNull();
    expect(identifyFastPath({ ...base, hasImage: true })).toBeNull();
  });

  test("gives a scope decision priority over FAQ evidence", () => {
    expect(
      identifyFastPath({
        message: "unrelated request",
        scopeDecision: {
          kind: "out_of_scope_general",
          reason: "general_creative_request",
        },
        faqMatch: {
          question: "Unrelated request",
          answer: "Answer",
          score: 1,
          precision: 1,
          recall: 1,
          margin: 1,
          authoritative: true,
          matchKind: "exact",
        },
      }),
    ).toMatchObject({ kind: "scope_blocked" });
  });

  test("uses FAQ evidence only when it is authoritative and has no higher-priority instruction", () => {
    const faqMatch = {
      question: "Question",
      answer: "Answer",
      score: 1,
      precision: 1,
      recall: 1,
      margin: 1,
      authoritative: true,
      matchKind: "exact" as const,
    };
    const base = { message: "Question", scopeDecision: null, faqMatch };

    expect(identifyFastPath(base)).toMatchObject({ kind: "authoritative_faq" });
    expect(
      identifyFastPath({ ...base, faqMatch: { ...faqMatch, authoritative: false } }),
    ).toBeNull();
    expect(identifyFastPath({ ...base, hasPriorityInstructions: true })).toBeNull();
  });
});

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

  test("mutes spam before considering agent mode", () => {
    expect(identifyHardGate({ status: "closed", closeReason: "spam" })).toBe("muted");
  });
});

test("AI invocation requires a non-empty leading bot mention", () => {
  expect(parseVisitorAiInvocation("@mAvEn, investigate this", "Maven")).toEqual({
    invoked: true,
    content: "investigate this",
  });
  expect(parseVisitorAiInvocation("investigate this", "Maven").invoked).toBe(false);
  expect(parseVisitorAiInvocation("@Maven", "Maven").invoked).toBe(false);
});
