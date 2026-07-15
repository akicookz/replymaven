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

  test("drops system messages from model history", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "system", content: "internal note" },
        { role: "visitor", content: "hello" },
      ],
      currentMessage: "next question",
    });

    expect(result).toEqual([{ role: "visitor", content: "hello" }]);
  });
});

describe("withCurrentTurn", () => {
  test("appends the current message as a visitor turn stamped with now", () => {
    const history = [{ role: "bot" as const, content: "Hello!" }];
    const result = withCurrentTurn(history, "thanks");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ role: "visitor", content: "thanks" });
    const stampedMs = new Date(result[1].createdAt ?? "").getTime();
    expect(Math.abs(Date.now() - stampedMs)).toBeLessThan(5_000);
  });
});

describe("timestamp normalization", () => {
  test("maps Date and ISO-string createdAt to ISO strings, drops junk", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        {
          role: "visitor",
          content: "a",
          createdAt: new Date("2026-07-01T09:00:00Z"),
        },
        { role: "bot", content: "b", createdAt: "2026-07-01T09:01:00Z" },
        { role: "visitor", content: "c", createdAt: "garbage" },
        { role: "bot", content: "d" },
      ],
      currentMessage: "current",
    });
    expect(result[0].createdAt).toBe("2026-07-01T09:00:00.000Z");
    expect(result[1].createdAt).toBe("2026-07-01T09:01:00.000Z");
    expect(result[2].createdAt).toBeUndefined();
    expect(result[3].createdAt).toBeUndefined();
  });
});
