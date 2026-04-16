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

  test("matches wording that only shares content tokens", () => {
    const match = findBestFaqMatch(
      resources,
      "can I invite a team member and give access to a single domain?",
    );
    expect(match?.question).toBe("How can I invite a team member?");
    expect(match?.score).toBe(1);
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
