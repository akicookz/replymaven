import { describe, expect, test } from "bun:test";
import {
  buildRelevantContentSnippet,
  selectRefinementShortlist,
} from "./refinement-selection";

describe("selectRefinementShortlist", () => {
  test("prioritizes candidates that overlap with the conversation topic", () => {
    const shortlist = selectRefinementShortlist({
      messages: [
        {
          role: "visitor",
          content: "Can you clarify your refund window and refund eligibility?",
        },
      ],
      faqs: [
        {
          id: "faq-billing",
          title: "Billing FAQ",
          pairs: [
            {
              question: "How do refunds work?",
              answer: "Refunds are handled case by case.",
            },
          ],
        },
        {
          id: "faq-shipping",
          title: "Shipping FAQ",
          pairs: [
            {
              question: "How long does shipping take?",
              answer: "Shipping takes 3-5 business days.",
            },
          ],
        },
      ],
      sops: [
        {
          id: "sop-refund",
          condition: "When a visitor asks for a refund",
          instruction: "Explain the refund policy clearly.",
        },
      ],
      pdfs: [
        {
          id: "pdf-pricing",
          title: "Pricing Guide",
          content: "This document explains plans and invoices.",
        },
      ],
      webpages: [
        {
          pageId: "page-refunds",
          resourceId: "web-1",
          resourceTitle: "Help Center",
          pageTitle: "Refund Policy",
          url: "https://example.com/refunds",
        },
      ],
      pendingSuggestions: [],
    });

    expect(shortlist.faqCandidates[0]?.id).toBe("faq-billing");
    expect(shortlist.sopCandidates[0]?.id).toBe("sop-refund");
    expect(shortlist.webpageCandidates[0]?.pageId).toBe("page-refunds");
  });
});

describe("buildRelevantContentSnippet", () => {
  test("returns the chunk most relevant to the query", () => {
    const content = [
      "General overview\n\nThis section covers the company background.",
      "Refund policy\n\nCustomers can request a refund within 30 days of purchase.",
      "Support hours\n\nThe support team replies Monday to Friday.",
    ].join("\n\n");

    const snippet = buildRelevantContentSnippet(
      content,
      "refund window and refund policy",
      200,
    );

    expect(snippet).toContain("refund within 30 days");
    expect(snippet).not.toContain("support team replies");
  });
});
