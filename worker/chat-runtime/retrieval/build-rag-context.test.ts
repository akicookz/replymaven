import { describe, expect, test } from "bun:test";
import { buildRagContext } from "./build-rag-context";
import { type PreparedRagChunk } from "../types";
import { type SourceReference } from "../../services/resource-service";

describe("buildRagContext", () => {
  test("separates faq context from lower-tier knowledge base context", () => {
    const chunks: PreparedRagChunk[] = [
      {
        key: "proj/faq-billing.md",
        score: 0.62,
        text: "FAQ: Discount codes are reviewed manually by the team.",
      },
      {
        key: "proj/pricing-page.md",
        score: 0.91,
        text: "Website copy mentioning general pricing details.",
      },
    ];

    const sourceReferenceMap = new Map<string, SourceReference>([
      [
        "proj/faq-billing.md",
        { title: "Billing FAQ", url: null, type: "faq" },
      ],
      [
        "proj/pricing-page.md",
        {
          title: "Pricing",
          url: "https://example.com/pricing",
          type: "webpage",
        },
      ],
    ]);

    const result = buildRagContext(chunks, sourceReferenceMap);

    expect(result.faqContext).toContain("faq-billing.md");
    expect(result.faqContext).toContain("Discount codes");
    expect(result.knowledgeBaseContext).toContain("pricing-page.md");
    expect(result.knowledgeBaseContext).toContain("Website copy");
    expect(result.context.indexOf("faq-billing.md")).toBeLessThan(
      result.context.indexOf("pricing-page.md"),
    );
  });
});
