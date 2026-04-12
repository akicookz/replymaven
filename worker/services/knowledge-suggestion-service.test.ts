import { describe, expect, test } from "bun:test";
import { isSemanticallyDuplicate } from "./knowledge-suggestion-service";

describe("isSemanticallyDuplicate", () => {
  test("detects duplicate when suggestion has same topic with different wording", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_faq_pair",
        suggestion: JSON.stringify({
          pair: {
            question: "What is the refund policy?",
            answer: "Refunds are processed within 14 days.",
          },
        }),
        reasoning: "Customer asked about refund policy but no FAQ covers it",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: JSON.stringify({
            pair: {
              question: "How do I get a refund?",
              answer: "You can request a refund within 14 days of purchase.",
            },
          }),
          reasoning: "Missing FAQ about the refund process",
        },
      ],
    );

    expect(result).toBe(true);
  });

  test("returns false for genuinely different topics", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_faq_pair",
        suggestion: JSON.stringify({
          pair: {
            question: "What are your shipping options?",
            answer: "We offer standard and express shipping.",
          },
        }),
        reasoning: "Customer asked about shipping but no FAQ covers it",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: JSON.stringify({
            pair: {
              question: "What is the refund policy?",
              answer: "Refunds are processed within 14 days.",
            },
          }),
          reasoning: "Missing FAQ about refund process",
        },
      ],
    );

    expect(result).toBe(false);
  });

  test("returns false when no existing suggestions", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_sop",
        suggestion: JSON.stringify({
          condition: "When visitor asks about pricing",
          instruction: "Direct them to the pricing page",
        }),
        reasoning: "Need pricing SOP",
      },
      [],
    );

    expect(result).toBe(false);
  });

  test("detects duplicate across different suggestion types with same topic", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_sop",
        suggestion: JSON.stringify({
          condition: "When visitor asks about subscription pricing tiers",
          instruction: "Explain the pricing tiers and monthly costs",
        }),
        reasoning: "Missing SOP for pricing tier questions",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: JSON.stringify({
            pair: {
              question: "What are the pricing tiers?",
              answer: "We have three pricing tiers with different monthly costs.",
            },
          }),
          reasoning: "FAQ about pricing tiers and monthly costs needed",
        },
      ],
    );

    expect(result).toBe(true);
  });

  test("handles suggestion as object instead of string", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_faq_pair",
        suggestion: {
          pair: {
            question: "What payment methods do you accept?",
            answer: "We accept credit cards and PayPal.",
          },
        },
        reasoning: "Missing payment FAQ",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: JSON.stringify({
            pair: {
              question: "Which payment methods are available?",
              answer: "We support credit cards, debit cards, and PayPal.",
            },
          }),
          reasoning: "Need FAQ about payment methods",
        },
      ],
    );

    expect(result).toBe(true);
  });

  test("respects custom threshold", () => {
    const newSuggestion = {
      type: "add_faq_pair",
      suggestion: JSON.stringify({
        pair: {
          question: "What is the refund policy?",
          answer: "Refunds within 14 days.",
        },
      }),
      reasoning: "Refund FAQ needed",
    };
    const existing = [
      {
        type: "add_faq_pair",
        suggestion: JSON.stringify({
          pair: {
            question: "How do refunds work?",
            answer: "Refunds are case by case.",
          },
        }),
        reasoning: "Refund process FAQ",
      },
    ];

    const strictResult = isSemanticallyDuplicate(
      newSuggestion,
      existing,
      0.95,
    );
    expect(strictResult).toBe(false);

    const looseResult = isSemanticallyDuplicate(
      newSuggestion,
      existing,
      0.3,
    );
    expect(looseResult).toBe(true);
  });

  test("handles malformed JSON in suggestion string gracefully", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_faq_pair",
        suggestion: "not valid json",
        reasoning: "Customer asked about refund processing timeline",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: "also not valid json",
          reasoning: "Need FAQ about international shipping rates and delivery",
        },
      ],
    );

    expect(result).toBe(false);
  });

  test("detects duplicate when only reasoning overlaps significantly", () => {
    const result = isSemanticallyDuplicate(
      {
        type: "add_sop",
        suggestion: JSON.stringify({ condition: "x", instruction: "y" }),
        reasoning:
          "The conversation revealed customers frequently ask about international shipping rates and delivery times to Europe",
      },
      [
        {
          type: "add_faq_pair",
          suggestion: JSON.stringify({
            pair: { question: "q", answer: "a" },
          }),
          reasoning:
            "Customers are asking about international shipping rates and estimated delivery times for European countries",
        },
      ],
    );

    expect(result).toBe(true);
  });
});
