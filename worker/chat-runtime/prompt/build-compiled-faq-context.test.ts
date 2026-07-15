import { describe, expect, test } from "bun:test";
import {
  buildCompiledFaqContext,
  findBestFaqMatch,
} from "./build-compiled-faq-context";

describe("buildCompiledFaqContext", () => {
  test("formats structured FAQ resources into a single tier-1 block", () => {
    const context = buildCompiledFaqContext([
      {
        title: "Billing FAQ",
        content: JSON.stringify([
          {
            question: " Do you offer discounts? ",
            answer: "Discount requests are reviewed manually.",
          },
          {
            question: "How long is the trial?",
            answer: "The free trial lasts 14 days.",
          },
        ]),
      },
    ]);

    expect(context).toContain("FAQ: Billing FAQ");
    expect(context).toContain("- Q: Do you offer discounts?");
    expect(context).toContain("A: Discount requests are reviewed manually.");
    expect(context).toContain("- Q: How long is the trial?");
  });

  test("deduplicates repeated FAQ pairs across resources", () => {
    const context = buildCompiledFaqContext([
      {
        title: "Billing FAQ",
        content: JSON.stringify([
          {
            question: "Do you offer discounts?",
            answer: "Discount requests are reviewed manually.",
          },
        ]),
      },
      {
        title: "Sales FAQ",
        content: JSON.stringify([
          {
            question: "Do you offer discounts?",
            answer: "Discount requests are reviewed manually.",
          },
        ]),
      },
    ]);

    expect(context.match(/Do you offer discounts\?/g)?.length ?? 0).toBe(1);
  });

  test("falls back to raw FAQ content when the resource is not structured JSON", () => {
    const context = buildCompiledFaqContext([
      {
        title: "Legacy FAQ",
        content:
          "Q: How do I cancel?\nA: Open Billing, then click Cancel subscription.",
      },
    ]);

    expect(context).toContain("FAQ: Legacy FAQ");
    expect(context).toContain("Q: How do I cancel?");
    expect(context).toContain("A: Open Billing, then click Cancel subscription.");
  });

  test("truncates a too-large section instead of returning empty", () => {
    const longAnswer = "x".repeat(45_000);
    const context = buildCompiledFaqContext([
      {
        title: "Massive FAQ",
        content: JSON.stringify([{ question: "Q?", answer: longAnswer }]),
      },
    ]);

    expect(context.length).toBeGreaterThan(0);
    expect(context).toContain("FAQ: Massive FAQ");
    expect(context).toContain("[...truncated]");
  });

});

describe("findBestFaqMatch", () => {
  const resources = [
    {
      title: "Team FAQ",
      content: JSON.stringify([
        {
          question: "How can I invite a team member?",
          answer:
            "It's in Dashboard > Team. You can invite a member as a viewer, editor, or admin.",
        },
        {
          question: "How do I cancel my subscription?",
          answer: "Open Billing, then click Cancel subscription.",
        },
      ]),
    },
  ];

  test("matches paraphrased questions above the lowered threshold", () => {
    const match = findBestFaqMatch(resources, "how do I invite a developer?");
    expect(match).not.toBeNull();
    expect(match?.question).toBe("How can I invite a team member?");
    expect(match?.score).toBeGreaterThanOrEqual(0.35);
  });

  test("does not treat a short contained FAQ as authoritative", () => {
    const match = findBestFaqMatch(
      resources,
      "Can I invite a team member, restrict them to one domain, and what will it cost?",
    );

    expect(match).not.toBeNull();
    expect(match?.authoritative).toBe(false);
    expect(match?.precision).toBeLessThan(0.8);
  });

  test("marks an exact normalized FAQ question authoritative", () => {
    const match = findBestFaqMatch(
      resources,
      "  HOW CAN I INVITE A TEAM MEMBER?! ",
    );

    expect(match).toMatchObject({
      question: "How can I invite a team member?",
      authoritative: true,
      matchKind: "exact",
      score: 1,
    });
  });

  test("rejects an otherwise strong match when the runner-up is too close", () => {
    const ambiguousResources = [
      {
        title: "Team FAQ",
        content: JSON.stringify([
          { question: "How do I invite a team member?", answer: "Open Team." },
          { question: "How do I remove a team member?", answer: "Open Team." },
        ]),
      },
    ];

    const match = findBestFaqMatch(
      ambiguousResources,
      "How do I manage a team member?",
    );
    expect(match?.authoritative).toBe(false);
    expect(match?.margin).toBeLessThan(0.15);
  });

  test("does not fast-path multi-intent wording", () => {
    const match = findBestFaqMatch(
      resources,
      "How can I invite a team member and cancel my subscription?",
    );

    expect(match?.authoritative).toBe(false);
  });

  test("does not fast-path duplicate questions with conflicting answers", () => {
    const conflictingResources = [
      {
        title: "Old FAQ",
        content: JSON.stringify([
          {
            question: "How long is the trial?",
            answer: "The trial is 7 days.",
          },
        ]),
      },
      {
        title: "New FAQ",
        content: JSON.stringify([
          {
            question: "How long is the trial?",
            answer: "The trial is 14 days.",
          },
        ]),
      },
    ];

    const match = findBestFaqMatch(
      conflictingResources,
      "How long is the trial?",
    );
    expect(match?.authoritative).toBe(false);
  });

  test("does not treat different non-Latin questions as an exact match", () => {
    expect(
      findBestFaqMatch(
        [
          {
            title: "Localized FAQ",
            content: JSON.stringify([
              { question: "料金はいくらですか", answer: "月額です。" },
            ]),
          },
        ],
        "비밀번호를 어떻게 변경하나요",
      ),
    ).toBeNull();
  });

  test("returns null when the message has too few content tokens", () => {
    const match = findBestFaqMatch(resources, "help?");
    expect(match).toBeNull();
  });

  test("returns null when no question shares enough content", () => {
    const match = findBestFaqMatch(resources, "what is your pricing?");
    expect(match).toBeNull();
  });
});
