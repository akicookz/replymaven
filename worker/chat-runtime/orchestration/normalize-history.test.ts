import { expect, test } from "bun:test";
import { normalizeConversationHistory } from "./normalize-history";

test("normalizes stored history into bounded prior model turns", () => {
  const history = normalizeConversationHistory({
    rawHistory: [
      { role: "system", content: "internal instruction" },
      { role: "bot", content: "" },
      { role: "agent", content: "I am checking." },
      { role: "visitor", content: "@Maven investigate this" },
    ],
    currentMessage: "investigate this",
    persistedCurrentMessage: "@Maven investigate this",
  });

  expect(history).toEqual([{ role: "agent", content: "I am checking.", createdAt: undefined }]);
});

test("keeps only the newest ten usable turns and normalizes valid timestamps", () => {
  const history = normalizeConversationHistory({
    rawHistory: Array.from({ length: 12 }, (_, index) => ({
      role: "visitor",
      content: `turn-${index}`,
      createdAt: index === 0 ? new Date("2026-07-01T09:00:00Z") : undefined,
    })),
    currentMessage: "current",
  });

  expect(history).toHaveLength(10);
  expect(history[0].content).toBe("turn-2");
});
