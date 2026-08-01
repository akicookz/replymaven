import { describe, expect, test } from "bun:test";
import {
  buildCompanySection,
  buildConversationSummarySection,
  buildFaqContextSection,
  buildFaqMatchSection,
  buildGroundingStatusSection,
  buildGuidelinesSection,
  buildKnowledgeBaseSection,
  buildPageContextSection,
  buildSupportTurnOpening,
  buildSupportTurnSection,
  buildPlannerLoopSection,
  buildTimeContextSection,
  buildToolEvidenceSection,
  buildVisitorInfoSection,
  trimToCharBudget,
  MAX_COMPANY_CONTEXT_CHARS,
  MAX_FAQ_CONTEXT_CHARS,
} from "./sections";

describe("trimToCharBudget", () => {
  test("returns text unchanged when under budget", () => {
    expect(trimToCharBudget("hello", 100)).toBe("hello");
  });

  test("truncates with marker when over budget", () => {
    const result = trimToCharBudget("a".repeat(200), 100);
    expect(result).toHaveLength(100 + "\n[...truncated]".length);
    expect(result.endsWith("\n[...truncated]")).toBe(true);
  });
});

describe("section builders return empty string when input is missing", () => {
  test.each([
    ["buildCompanySection", () => buildCompanySection("Acme", null)],
    ["buildCompanySection (undefined)", () => buildCompanySection("Acme", undefined)],
    ["buildGuidelinesSection (empty)", () => buildGuidelinesSection("Acme", [])],
    ["buildGuidelinesSection (undefined)", () => buildGuidelinesSection("Acme", undefined)],
    ["buildPageContextSection (empty)", () => buildPageContextSection({})],
    ["buildPageContextSection (undefined)", () => buildPageContextSection(undefined)],
    ["buildVisitorInfoSection (undefined)", () => buildVisitorInfoSection(undefined)],
    ["buildPlannerLoopSection (all empty)", () => buildPlannerLoopSection(null, null, [])],
    ["buildFaqMatchSection (null)", () => buildFaqMatchSection(null)],
    ["buildFaqContextSection (null)", () => buildFaqContextSection(null)],
    ["buildKnowledgeBaseSection (empty)", () => buildKnowledgeBaseSection("")],
    ["buildToolEvidenceSection (null)", () => buildToolEvidenceSection(null)],
    ["buildConversationSummarySection (null)", () => buildConversationSummarySection(null)],
    [
      "buildGroundingStatusSection (retrieval not attempted)",
      () =>
        buildGroundingStatusSection({
          retrievalAttempted: false,
          broaderSearchAttempted: false,
          groundingConfidence: "none",
          topScore: 0,
          hasTier1Evidence: false,
        }),
    ],
  ])("%s", (_label, build) => {
    expect(build()).toBe("");
  });
});

describe("buildSupportTurnOpening", () => {
  test("uses the visitor name with an email-style comma on the first turn", () => {
    expect(
      buildSupportTurnOpening(
        { kind: "standard", isFirstVisitorTurn: true },
        { name: "Akbar", email: null },
      ),
    ).toBe("Hi Akbar,\n\n");
  });

  test("uses a name-free comma greeting when the visitor name is unavailable", () => {
    expect(
      buildSupportTurnOpening(
        { kind: "standard", isFirstVisitorTurn: true },
        { name: null, email: null },
      ),
    ).toBe("Hi,\n\n");
  });

  test("does not greet again on a later standard turn", () => {
    expect(
      buildSupportTurnOpening(
        { kind: "standard", isFirstVisitorTurn: false },
        { name: "Akbar", email: null },
      ),
    ).toBe("");
  });

  test("greets a named visitor without dumping the configured response schedule", () => {
    const opening = buildSupportTurnOpening(
      { kind: "contact_support", isFirstVisitorTurn: true },
      { name: "Akbar", email: "akbar@example.com" },
    );

    expect(opening).toBe(
      "Hi Akbar,\n\nI've flagged this for the team. ",
    );
    expect(opening).not.toContain("within 4 business hours");
    expect(opening).not.toContain("Monday to Friday");
    expect(opening).not.toContain("—");
  });

  test("leaves response timing to the AI when only working hours are configured", () => {
    expect(
      buildSupportTurnOpening(
        { kind: "contact_support", isFirstVisitorTurn: false },
        { name: "Akbar", email: null },
      ),
    ).toBe("I've flagged this for the team. ");
  });

  test("does not invent an ETA when contact availability is not configured", () => {
    expect(
      buildSupportTurnOpening(
        { kind: "contact_support", isFirstVisitorTurn: false },
        { name: "Akbar", email: null },
      ),
    ).toBe("I've flagged this for the team. ");
  });
});

test("buildSupportTurnSection asks for evidence-first diagnosis without a static review phrase", () => {
  const section = buildSupportTurnSection({
    kind: "contact_support",
    isFirstVisitorTurn: true,
  });

  expect(section).toContain("strongest evidence-backed explanation");
  expect(section).toContain("one focused question");
  expect(section).toContain("runtime has already added the complete administrative opener");
  expect(section).toContain("Do not repeat the greeting, human-review notice, or reply expectation");
  expect(section).toContain("Never ask whether the visitor wants the issue forwarded");
  expect(section).not.toContain("I have reviewed what you have shared");
});

describe("buildCompanySection", () => {
  test("wraps content in <about-the-company> with trailing blank line", () => {
    const out = buildCompanySection("Acme", "We build things.");
    expect(out).toContain("<about-the-company>");
    expect(out).toContain("</about-the-company>");
    expect(out).toContain("Acme");
    expect(out).toContain("We build things.");
    expect(out.endsWith("\n\n")).toBe(true);
  });

  test("trims context that exceeds MAX_COMPANY_CONTEXT_CHARS", () => {
    const huge = "x".repeat(MAX_COMPANY_CONTEXT_CHARS + 5000);
    const out = buildCompanySection("Acme", huge);
    expect(out).toContain("[...truncated]");
  });
});

describe("buildGuidelinesSection", () => {
  test("renders each guideline as When/Then bullet", () => {
    const out = buildGuidelinesSection("Acme", [
      { condition: "X happens", instruction: "Do Y" },
      { condition: "Z asked", instruction: "Answer W" },
    ]);
    expect(out).toContain("<guidelines>");
    expect(out).toContain("- When: X happens\n  Then: Do Y");
    expect(out).toContain("- When: Z asked\n  Then: Answer W");
    expect(out).toContain("</guidelines>");
  });
});

describe("buildPageContextSection", () => {
  test("renders each key/value on its own line", () => {
    const out = buildPageContextSection({ page: "Pricing", plan: "Pro" });
    expect(out).toContain("<page-context>");
    expect(out).toContain("page: Pricing");
    expect(out).toContain("plan: Pro");
    expect(out).toContain("</page-context>");
  });
});

describe("buildVisitorInfoSection", () => {
  test("renders name and email", () => {
    const out = buildVisitorInfoSection({ name: "Alice", email: "a@x.com" });
    expect(out).toContain("Name: Alice");
    expect(out).toContain("Email: a@x.com");
  });

  test("renders 'unknown' for missing fields", () => {
    const out = buildVisitorInfoSection({ name: null, email: null });
    expect(out).toContain("Name: unknown");
    expect(out).toContain("Email: unknown");
  });
});

describe("buildPlannerLoopSection", () => {
  test("renders intent, goal, and history", () => {
    const out = buildPlannerLoopSection(
      "how_to",
      "Resolve the setup question",
      [
        { type: "search_docs", reason: "look up docs" },
        { type: "compose", reason: "answer", note: "low confidence" },
      ],
    );
    expect(out).toContain("Support intent: how_to");
    expect(out).toContain("Planner goal: Resolve the setup question");
    expect(out).not.toContain("Focused follow-up");
    expect(out).toContain("1. search_docs: look up docs");
    expect(out).toContain("2. compose: answer (low confidence)");
  });

  test("falls back to 'No prior planner actions.' when history is empty", () => {
    const out = buildPlannerLoopSection(null, "Goal X", []);
    expect(out).toContain("Planner goal: Goal X");
    expect(out).toContain("No prior planner actions.");
  });
});

describe("buildFaqMatchSection", () => {
  test("renders Q/A with score", () => {
    const out = buildFaqMatchSection({
      question: "What is refund policy?",
      answer: "30 days.",
      score: 0.87,
    });
    expect(out).toContain("<priority-faq-match>");
    expect(out).toContain("Q: What is refund policy?");
    expect(out).toContain("A: 30 days.");
    expect(out).toContain("match score 0.87");
  });
});

describe("buildFaqContextSection", () => {
  test("trims to MAX_FAQ_CONTEXT_CHARS", () => {
    const huge = "y".repeat(MAX_FAQ_CONTEXT_CHARS + 100);
    const out = buildFaqContextSection(huge);
    expect(out).toContain("[...truncated]");
  });
});

describe("buildKnowledgeBaseSection", () => {
  test("wraps and trims RAG context", () => {
    const out = buildKnowledgeBaseSection("excerpt here");
    expect(out).toContain("<knowledge-base>");
    expect(out).toContain("excerpt here");
    expect(out).toContain("</knowledge-base>");
  });
});

describe("buildGroundingStatusSection", () => {
  test("NONE tier when no evidence and confidence none", () => {
    const out = buildGroundingStatusSection({
      retrievalAttempted: true,
      broaderSearchAttempted: false,
      groundingConfidence: "none",
      topScore: 0.1,
      hasTier1Evidence: false,
    });
    expect(out).toContain("Confidence tier: NONE");
    expect(out).toContain("relevance: 0.10");
  });

  test("LOW tier when no evidence and confidence low", () => {
    const out = buildGroundingStatusSection({
      retrievalAttempted: true,
      broaderSearchAttempted: false,
      groundingConfidence: "low",
      topScore: 0.4,
      hasTier1Evidence: false,
    });
    expect(out).toContain("Confidence tier: LOW");
  });

  test("MODERATE tier when high confidence but score under 0.8", () => {
    const out = buildGroundingStatusSection({
      retrievalAttempted: true,
      broaderSearchAttempted: false,
      groundingConfidence: "high",
      topScore: 0.7,
      hasTier1Evidence: false,
    });
    expect(out).toContain("Confidence tier: MODERATE");
  });

  test("returns empty when tier-1 evidence is present", () => {
    const out = buildGroundingStatusSection({
      retrievalAttempted: true,
      broaderSearchAttempted: false,
      groundingConfidence: "none",
      topScore: 0,
      hasTier1Evidence: true,
    });
    expect(out).toBe("");
  });
});

describe("buildToolEvidenceSection", () => {
  test("renders summary", () => {
    const out = buildToolEvidenceSection('{"status":"ok"}');
    expect(out).toContain("<tool-evidence>");
    expect(out).toContain('{"status":"ok"}');
  });
});

describe("buildConversationSummarySection", () => {
  test("renders summary", () => {
    const out = buildConversationSummarySection("They asked about pricing.");
    expect(out).toContain("<conversation-summary>");
    expect(out).toContain("They asked about pricing.");
  });
});

describe("buildTimeContextSection", () => {
  const NOW = new Date("2026-07-02T10:00:00Z").getTime();
  const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

  test("returns empty without timeContext", () => {
    expect(buildTimeContextSection(null)).toBe("");
    expect(buildTimeContextSection(undefined)).toBe("");
  });

  test("renders current time only for a fresh rapid conversation", () => {
    const out = buildTimeContextSection({
      nowMs: NOW,
      conversationHistory: [
        { role: "visitor", content: "hi", createdAt: isoAgo(60_000) },
      ],
    });
    expect(out).toContain(
      "Current date and time: Thursday, 2026-07-02 10:00 UTC.",
    );
    expect(out).not.toContain("started");
    expect(out).not.toContain("previous message");
  });

  test("notes conversation age and the resume gap", () => {
    const out = buildTimeContextSection({
      nowMs: NOW,
      conversationHistory: [
        {
          role: "visitor",
          content: "hi",
          createdAt: isoAgo(5 * 24 * 60 * 60 * 1000),
        },
        {
          role: "bot",
          content: "hello",
          createdAt: isoAgo(2 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    expect(out).toContain("The conversation started 5 days ago.");
    expect(out).toContain(
      "The visitor's current message came 2 days after the previous message.",
    );
  });

  test("renders only the current time when history lacks timestamps", () => {
    const out = buildTimeContextSection({
      nowMs: NOW,
      conversationHistory: [{ role: "visitor", content: "hi" }],
    });
    expect(out).toContain("Current date and time:");
    expect(out).not.toContain("started");
  });
});
