import { describe, expect, test } from "bun:test";
import { AiService, parseAndFilterPlans, type KnowledgeRefinementContext } from "./ai-service";

const baseContext: KnowledgeRefinementContext = {
  companyContext: "Test company",
  faqCandidates: [
    {
      id: "faq-1",
      title: "General FAQ",
      pairs: [{ question: "What do you do?", answer: "We do things." }],
    },
  ],
  guidelineCandidates: [
    { id: "guide-1", condition: "When asked about pricing", instruction: "Refer to pricing page" },
  ],
  pdfCandidates: [
    { id: "pdf-1", title: "User Manual", excerpt: "Getting started..." },
  ],
  webpageCandidates: [
    {
      pageId: "page-1",
      resourceId: "res-1",
      resourceTitle: "Docs",
      pageTitle: "Getting Started",
      url: "https://example.com/docs",
    },
  ],
  pendingSuggestions: [],
};

const emptyFaqContext: KnowledgeRefinementContext = {
  ...baseContext,
  faqCandidates: [],
};

describe("parseAndFilterPlans", () => {
  test("returns [] for empty string", () => {
    expect(parseAndFilterPlans("", baseContext)).toEqual([]);
  });

  test("returns [] for '[]'", () => {
    expect(parseAndFilterPlans("[]", baseContext)).toEqual([]);
  });

  test("returns [] for 'null'", () => {
    expect(parseAndFilterPlans("null", baseContext)).toEqual([]);
  });

  test("returns [] for whitespace-only input", () => {
    expect(parseAndFilterPlans("   \n  ", baseContext)).toEqual([]);
  });

  test("returns [] for malformed JSON", () => {
    expect(parseAndFilterPlans("not json at all", baseContext)).toEqual([]);
  });

  test("parses markdown-wrapped JSON", () => {
    const raw = '```json\n[{"type":"add_sop","reasoning":"Add SOP"}]\n```';
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });

  test("filters out invalid types", () => {
    const raw = JSON.stringify([
      { type: "invalid_type", reasoning: "Bad" },
      { type: "add_sop", reasoning: "Valid" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });

  test("filters entries missing reasoning", () => {
    const raw = JSON.stringify([{ type: "add_sop" }]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("filters entries with non-string type", () => {
    const raw = JSON.stringify([{ type: 123, reasoning: "Bad" }]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("returns at most 1 plan even with multiple valid entries", () => {
    const raw = JSON.stringify([
      { type: "add_sop", reasoning: "First" },
      { type: "new_sop", reasoning: "Second" },
      { type: "update_context", reasoning: "Third" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });

  test("blocks new_faq when existing FAQs exist", () => {
    const raw = JSON.stringify([{ type: "new_faq", reasoning: "Create FAQ" }]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("allows new_faq when no existing FAQs", () => {
    const raw = JSON.stringify([{ type: "new_faq", reasoning: "Create FAQ" }]);
    const plans = parseAndFilterPlans(raw, emptyFaqContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("new_faq");
  });

  test("validates targetResourceId for add_faq_pair", () => {
    const raw = JSON.stringify([
      { type: "add_faq_pair", targetResourceId: "nonexistent", reasoning: "Bad ref" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("accepts valid targetResourceId for add_faq_pair", () => {
    const raw = JSON.stringify([
      { type: "add_faq_pair", targetResourceId: "faq-1", reasoning: "Good ref" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].targetResourceId).toBe("faq-1");
  });

  test("validates targetResourceId for refine_faq_pair", () => {
    const raw = JSON.stringify([
      { type: "refine_faq_pair", targetResourceId: "nonexistent", reasoning: "Bad" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("requires targetResourceId for faq types", () => {
    const raw = JSON.stringify([
      { type: "add_faq_pair", reasoning: "No target" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("validates targetGuidelineId for refine_sop", () => {
    const raw = JSON.stringify([
      { type: "refine_sop", targetGuidelineId: "nonexistent", reasoning: "Bad" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("accepts valid targetGuidelineId for refine_sop", () => {
    const raw = JSON.stringify([
      { type: "refine_sop", targetGuidelineId: "guide-1", reasoning: "Good" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].targetGuidelineId).toBe("guide-1");
  });

  test("validates targetResourceId for update_pdf", () => {
    const raw = JSON.stringify([
      { type: "update_pdf", targetResourceId: "nonexistent", reasoning: "Bad" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("accepts valid targetResourceId for update_pdf", () => {
    const raw = JSON.stringify([
      { type: "update_pdf", targetResourceId: "pdf-1", reasoning: "Good" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].targetResourceId).toBe("pdf-1");
  });

  test("validates pageId + resourceId match for update_webpage", () => {
    const raw = JSON.stringify([
      { type: "update_webpage", targetPageId: "page-1", targetResourceId: "wrong-res", reasoning: "Bad" },
    ]);
    expect(parseAndFilterPlans(raw, baseContext)).toEqual([]);
  });

  test("accepts valid pageId + resourceId for update_webpage", () => {
    const raw = JSON.stringify([
      { type: "update_webpage", targetPageId: "page-1", targetResourceId: "res-1", reasoning: "Good" },
    ]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].targetPageId).toBe("page-1");
    expect(plans[0].targetResourceId).toBe("res-1");
  });

  test("add_sop does not require targetGuidelineId", () => {
    const raw = JSON.stringify([{ type: "add_sop", reasoning: "New guideline" }]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("add_sop");
  });

  test("update_context passes through without resource validation", () => {
    const raw = JSON.stringify([{ type: "update_context", reasoning: "Add context" }]);
    const plans = parseAndFilterPlans(raw, baseContext);
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe("update_context");
  });
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const hasKey = !!GEMINI_API_KEY;
const llmDescribe = hasKey ? describe : describe.skip;

function createService() {
  return new AiService({
    model: "gemini-3-flash-preview",
    geminiApiKey: GEMINI_API_KEY!,
    openaiApiKey: "",
  });
}

const messages = [
  { role: "visitor", content: "How do refunds work?" },
  { role: "bot", content: "I'm not sure about our refund policy." },
];

llmDescribe("planKnowledgeRefinement (LLM integration)", () => {
  test("returns at most 1 plan", async () => {
    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeLessThanOrEqual(1);
  }, 15_000);

  test("returns empty array for casual conversation", async () => {
    const service = createService();
    const plans = await service.planKnowledgeRefinement(
      [
        { role: "visitor", content: "Hello!" },
        { role: "bot", content: "Hi there! How can I help?" },
      ],
      baseContext,
    );

    expect(plans).toEqual([]);
  }, 15_000);

  test("every returned plan has a valid type", async () => {
    const service = createService();
    const plans = await service.planKnowledgeRefinement(messages, baseContext);

    expect(Array.isArray(plans)).toBe(true);
    const validTypes = new Set([
      "add_faq_pair",
      "refine_faq_pair",
      "new_sop",
      "add_sop",
      "refine_sop",
      "update_pdf",
      "update_webpage",
      "update_context",
    ]);
    for (const plan of plans) {
      expect(validTypes.has(plan.type)).toBe(true);
    }
  }, 15_000);
});
