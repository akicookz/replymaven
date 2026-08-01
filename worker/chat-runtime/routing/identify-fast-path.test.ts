import { describe, expect, test } from "bun:test";
import {
  identifyFastPath,
  identifyHardGate,
  parseVisitorAiInvocation,
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

test("lets AI keep helping while a team request is pending", () => {
  expect(
    identifyHardGate({
      status: "waiting_agent",
      closeReason: null,
      aiParticipation: "assist_until_agent",
      aiInvoked: false,
    }),
  ).toBeNull();
});

test.each(["waiting_agent", "agent_replied"])(
  "keeps AI silent in a human-owned %s conversation",
  (status) => {
    expect(
      identifyHardGate({
        status,
        closeReason: null,
        aiParticipation: "human_only",
        aiInvoked: false,
      }),
    ).toBe("agent_mode");
  },
);

test("allows one invoked AI turn in a human-owned conversation", () => {
  expect(
    identifyHardGate({
      status: "agent_replied",
      closeReason: null,
      aiParticipation: "human_only",
      aiInvoked: true,
    }),
  ).toBeNull();
});

test("keeps ordinary messages AI-silent when a human-owned thread was reopened", () => {
  expect(
    identifyHardGate({
      status: "active",
      closeReason: null,
      aiParticipation: "human_only",
      aiInvoked: false,
    }),
  ).toBe("agent_mode");
});

test("identifies spam as muted before agent mode", () => {
  expect(identifyHardGate({ status: "closed", closeReason: "spam" })).toBe(
    "muted",
  );
});

describe("parseVisitorAiInvocation", () => {
  test("strips a case-insensitive bot mention and returns the AI question", () => {
    expect(
      parseVisitorAiInvocation("@mAvEn why is checkout failing?", "Maven"),
    ).toEqual({ invoked: true, content: "why is checkout failing?" });
  });

  test.each(["@Maven, why is checkout failing?", "@Maven: why is checkout failing?"])(
    "accepts natural punctuation in %s",
    (message) => {
      expect(parseVisitorAiInvocation(message, "Maven")).toEqual({
        invoked: true,
        content: "why is checkout failing?",
      });
    },
  );

  test("does not invoke AI for an ordinary human conversation message", () => {
    expect(
      parseVisitorAiInvocation("why is checkout failing?", "Maven"),
    ).toEqual({ invoked: false, content: "why is checkout failing?" });
  });

  test("does not treat a bare mention as a usable AI turn", () => {
    expect(parseVisitorAiInvocation("@Maven", "Maven")).toEqual({
      invoked: false,
      content: "@Maven",
    });
  });
});
