import { describe, expect, test } from "bun:test";
import {
  normalizeConversationHistory,
  withCurrentTurn,
} from "./normalize-history";

describe("normalizeConversationHistory", () => {
  test("passes prior turns through unchanged", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "how do I embed the widget?" },
        { role: "bot", content: "Add the script tag to your site." },
      ],
      currentMessage: "it did not work",
    });
    expect(result).toEqual([
      { role: "visitor", content: "how do I embed the widget?" },
      { role: "bot", content: "Add the script tag to your site." },
    ]);
  });

  test("drops a trailing entry that duplicates the current message", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "hi" },
        { role: "bot", content: "Hello!" },
        { role: "visitor", content: "it did not work" },
      ],
      currentMessage: "it did not work",
    });
    expect(result).toEqual([
      { role: "visitor", content: "hi" },
      { role: "bot", content: "Hello!" },
    ]);
  });

  test("keeps an identical earlier visitor message that is not trailing", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "help" },
        { role: "bot", content: "With what?" },
      ],
      currentMessage: "help",
    });
    expect(result).toHaveLength(2);
  });

  test("filters empty bot messages and caps at 10 entries", () => {
    const rawHistory = [
      { role: "bot", content: "" },
      ...Array.from({ length: 14 }, (_, i) => ({
        role: i % 2 === 0 ? "visitor" : "bot",
        content: `m${i}`,
      })),
    ];
    const result = normalizeConversationHistory({
      rawHistory,
      currentMessage: "current",
    });
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("m4");
  });
});

describe("withCurrentTurn", () => {
  test("appends the current message as a visitor turn", () => {
    const history = [{ role: "bot" as const, content: "Hello!" }];
    expect(withCurrentTurn(history, "thanks")).toEqual([
      { role: "bot", content: "Hello!" },
      { role: "visitor", content: "thanks" },
    ]);
  });
});
