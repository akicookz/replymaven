import { describe, expect, test } from "bun:test";
import { buildCompiledFaqContext } from "./build-compiled-faq-context";

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
});
