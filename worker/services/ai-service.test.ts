import { describe, expect, test, mock } from "bun:test";
import { AiService } from "./ai-service";

const mockGenerateText = mock();

mock.module("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

function createService() {
  return new AiService({
    model: "gemini-test",
    geminiApiKey: "test-key",
    openaiApiKey: "test-key",
  });
}

const baseContext = {
  companyContext: "Test company",
  faqCandidates: [
    {
      id: "faq-1",
      title: "General FAQ",
      pairs: [{ question: "What do you do?", answer: "We do things." }],
    },
  ],
  guidelineCandidates: [],
  pdfCandidates: [],
  webpageCandidates: [],
  pendingSuggestions: [],
};

const messages = [
  { role: "visitor", content: "How do refunds work?" },
  { role: "bot", content: "I'm not sure about our refund policy." },
];

describe("planKnowledgeRefinement", () => {
  test("returns at most 1 plan even if AI returns multiple", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "add_faq_pair",
          targetResourceId: "faq-1",
          reasoning: "Add refund FAQ",
        },
        {
          type: "add_sop",
          reasoning: "Add refund SOP",
        },
        {
          type: "update_context",
          reasoning: "Update company context with refund info",
        },
      ]),
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_faq_pair");
  });

  test("returns empty array when AI returns empty", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "[]" });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans).toEqual([]);
  });

  test("returns empty array when AI returns null", async () => {
    mockGenerateText.mockResolvedValueOnce({ text: "null" });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans).toEqual([]);
  });

  test("returns empty array when AI call fails", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API error"));

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans).toEqual([]);
  });

  test("filters out invalid types", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "invalid_type",
          reasoning: "Bad plan",
        },
        {
          type: "add_sop",
          reasoning: "Valid SOP plan",
        },
      ]),
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });

  test("validates targetResourceId exists in candidates for FAQ types", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "add_faq_pair",
          targetResourceId: "nonexistent-faq",
          reasoning: "Should be filtered out",
        },
      ]),
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans).toEqual([]);
  });

  test("blocks new_faq when existing FAQs exist", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "new_faq",
          reasoning: "Should not be allowed when FAQs exist",
        },
      ]),
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans).toEqual([]);
  });

  test("allows new_faq when no existing FAQs", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          type: "new_faq",
          reasoning: "Create first FAQ",
        },
      ]),
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, {
      ...baseContext,
      faqCandidates: [],
    });

    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("new_faq");
  });

  test("handles AI response wrapped in markdown code block", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '```json\n[{"type":"add_sop","reasoning":"Add SOP"}]\n```',
    });

    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });
});
