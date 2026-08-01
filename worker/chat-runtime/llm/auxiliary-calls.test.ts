import { describe, expect, test } from "bun:test";
import { type LanguageModel } from "ai";
import { reformulateSearchQueries, selectFaqSets } from "./auxiliary-calls";

const unusableModel = {} as unknown as LanguageModel;

describe("model-call short circuits", () => {
  test("does not call a model when there are no failed searches to reformulate", async () => {
    const result = await reformulateSearchQueries(unusableModel, {
      conversationHistory: [],
      currentMessage: "anything",
      failedQueries: [],
    });

    expect(result).toEqual([]);
  });

  test("does not call a model to select zero or one FAQ set", async () => {
    const none = await selectFaqSets(unusableModel, {
      conversationHistory: [],
      currentMessage: "anything",
      faqSets: [],
    });
    const one = await selectFaqSets(unusableModel, {
      conversationHistory: [],
      currentMessage: "anything",
      faqSets: [{ id: "faq", title: "FAQ", description: null }],
    });

    expect(none).toEqual([]);
    expect(one).toEqual(["faq"]);
  });
});

test("FAQ selection degrades safely by default but surfaces failures when requested", async () => {
  const params = {
    conversationHistory: [],
    currentMessage: "anything",
    faqSets: [
      { id: "a", title: "A", description: null },
      { id: "b", title: "B", description: null },
    ],
  };

  expect(await selectFaqSets(unusableModel, params)).toEqual([]);
  await expect(selectFaqSets(unusableModel, params, { throwOnModelError: true })).rejects.toThrow();
});
