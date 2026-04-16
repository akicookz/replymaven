import { describe, expect, test } from "bun:test";
import {
  dedupeReformulatedQueries,
  fallbackClassifySupportTurn,
  reformulateSearchQueries,
  selectFaqSets,
} from "./auxiliary-calls";
import { createLanguageModel } from "./create-language-model";
import { type LanguageModel } from "ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const hasGeminiKey = !!GEMINI_API_KEY;
const llmDescribe = hasGeminiKey ? describe : describe.skip;

describe("auxiliary-calls - industry agnostic", () => {
  describe("fallbackClassifySupportTurn", () => {
    test("fallback handles unclear messages by asking for clarification", () => {
      const result = fallbackClassifySupportTurn(
        "my project timeline isn't updating"
      );
      // The fallback is simple and can't determine context without LLM
      expect(result.intent).toBe("clarify");
      expect(result.followUpQuestion).toBeNull();
    });

    test("fallback recognizes explicit handoff request", () => {
      const result = fallbackClassifySupportTurn(
        "I need to speak with a human"
      );
      expect(result.intent).toBe("handoff");
      expect(result.retrievalQueries).toEqual([]);
    });

    test("fallback recognizes policy/pricing questions", () => {
      const result = fallbackClassifySupportTurn(
        "what are your refund policies"
      );
      expect(result.intent).toBe("policy");
      expect(result.retrievalQueries).toContain("what are your refund policies");
    });

    test("fallback recognizes how-to questions", () => {
      const result = fallbackClassifySupportTurn(
        "how do I configure settings"
      );
      expect(result.intent).toBe("how_to");
      expect(result.retrievalQueries).toContain("how do I configure settings");
    });

    test("fallback handles account lookup requests", () => {
      const result = fallbackClassifySupportTurn(
        "check my order status"
      );
      expect(result.intent).toBe("lookup");
      expect(result.retrievalQueries).toEqual([]);
    });

    test("fallback asks for clarification on vague messages", () => {
      const result = fallbackClassifySupportTurn(
        "help"
      );
      expect(result.intent).toBe("clarify");
      expect(result.followUpQuestion).toBeNull();
    });
  });
});

describe("dedupeReformulatedQueries", () => {
  test("returns empty array when no candidates", () => {
    expect(dedupeReformulatedQueries([], ["billing"])).toEqual([]);
  });

  test("removes exact duplicates of failed queries", () => {
    const result = dedupeReformulatedQueries(
      ["billing", "invoice history"],
      ["billing"],
    );
    expect(result).toEqual(["invoice history"]);
  });

  test("matches failed queries case-insensitively", () => {
    const result = dedupeReformulatedQueries(
      ["BILLING", "Billing", "Payment History"],
      ["billing"],
    );
    expect(result).toEqual(["Payment History"]);
  });

  test("matches failed queries ignoring surrounding whitespace", () => {
    const result = dedupeReformulatedQueries(
      ["  billing  ", "refund policy"],
      ["billing"],
    );
    expect(result).toEqual(["refund policy"]);
  });

  test("dedupes candidates against each other", () => {
    const result = dedupeReformulatedQueries(
      ["invoice", "INVOICE", "Invoice", "payment"],
      [],
    );
    expect(result).toEqual(["invoice", "payment"]);
  });

  test("drops empty and whitespace-only candidates", () => {
    const result = dedupeReformulatedQueries(
      ["", "   ", "refund", "\t\n"],
      [],
    );
    expect(result).toEqual(["refund"]);
  });

  test("trims whitespace on retained candidates", () => {
    const result = dedupeReformulatedQueries(
      ["  refund policy  "],
      [],
    );
    expect(result).toEqual(["refund policy"]);
  });

  test("preserves order of first occurrence", () => {
    const result = dedupeReformulatedQueries(
      ["a", "b", "c", "A", "B", "d"],
      [],
    );
    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  test("returns empty array when every candidate is a failed query", () => {
    const result = dedupeReformulatedQueries(
      ["billing", "invoice"],
      ["billing", "invoice"],
    );
    expect(result).toEqual([]);
  });
});

describe("reformulateSearchQueries - short-circuit", () => {
  test("returns empty array when failedQueries is empty without calling the model", async () => {
    // Passing a null model proves the short-circuit runs before any LLM call.
    const result = await reformulateSearchQueries(
      null as never,
      {
        conversationHistory: [],
        currentMessage: "anything",
        failedQueries: [],
      },
    );
    expect(result).toEqual([]);
  });
});

llmDescribe("reformulateSearchQueries (LLM integration)", () => {
  function createModel() {
    return createLanguageModel({
      model: "gemini-3-flash-preview",
      geminiApiKey: GEMINI_API_KEY!,
      openaiApiKey: null,
    });
  }

  test("returns queries that differ from every failed query", async () => {
    const failedQueries = ["billing page", "payment issues"];
    const result = await reformulateSearchQueries(
      createModel(),
      {
        conversationHistory: [
          { role: "visitor", content: "I was charged twice last month." },
        ],
        currentMessage: "I was charged twice last month.",
        failedQueries,
        intent: "policy",
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);

    const failedSet = new Set(failedQueries.map((q) => q.toLowerCase()));
    for (const query of result) {
      expect(failedSet.has(query.toLowerCase())).toBe(false);
      expect(query.length).toBeGreaterThan(0);
    }
  }, 15_000);

  test("returns [] and does not throw when model fails (default options)", async () => {
    const result = await reformulateSearchQueries(
      createLanguageModel({
        model: "gemini-3-flash-preview",
        geminiApiKey: "invalid-key",
        openaiApiKey: null,
      }),
      {
        conversationHistory: [],
        currentMessage: "test",
        failedQueries: ["something"],
      },
    );
    expect(result).toEqual([]);
  }, 15_000);

  test("throws when throwOnModelError is true and model fails", async () => {
    let threw = false;
    try {
      await reformulateSearchQueries(
        createLanguageModel({
          model: "gemini-3-flash-preview",
          geminiApiKey: "invalid-key",
          openaiApiKey: null,
        }),
        {
          conversationHistory: [],
          currentMessage: "test",
          failedQueries: ["something"],
        },
        { throwOnModelError: true },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  }, 15_000);
});

describe("selectFaqSets - short-circuits and failure modes", () => {
  const stubModel = {} as unknown as LanguageModel;

  test("returns empty array when no FAQ sets exist", async () => {
    const result = await selectFaqSets(stubModel, {
      conversationHistory: [],
      currentMessage: "any",
      faqSets: [],
    });
    expect(result).toEqual([]);
  });

  test("returns single id without calling model when only one set exists", async () => {
    const result = await selectFaqSets(stubModel, {
      conversationHistory: [],
      currentMessage: "any",
      faqSets: [
        { id: "only-set", title: "Only FAQ", description: null },
      ],
    });
    expect(result).toEqual(["only-set"]);
  });

  test("swallows model errors and returns [] by default", async () => {
    const throwingModel = {} as unknown as LanguageModel;
    const result = await selectFaqSets(throwingModel, {
      conversationHistory: [],
      currentMessage: "any",
      faqSets: [
        { id: "a", title: "A", description: "alpha topics" },
        { id: "b", title: "B", description: "beta topics" },
      ],
    });
    expect(result).toEqual([]);
  });

  test("throws when throwOnModelError is true and model is unusable", async () => {
    const throwingModel = {} as unknown as LanguageModel;
    let threw = false;
    try {
      await selectFaqSets(
        throwingModel,
        {
          conversationHistory: [],
          currentMessage: "any",
          faqSets: [
            { id: "a", title: "A", description: "alpha topics" },
            { id: "b", title: "B", description: "beta topics" },
          ],
        },
        { throwOnModelError: true },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});