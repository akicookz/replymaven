import { describe, expect, test } from "bun:test";
import { buildAutoSuggestTurnInput } from "./handle-copilot-turn";

const FALLBACK = "Draft a friendly opening based on what's known.";

describe("buildAutoSuggestTurnInput", () => {
  // The bug: routing on a synthetic "draft a reply" string (with no visitor
  // content) made the planner ask the agent to "share the visitor's message".
  // The latest visitor message must become the message routing reasons about.
  test("uses the latest visitor message as the current message", () => {
    const { currentMessage, conversationHistory } = buildAutoSuggestTurnInput(
      [
        { role: "visitor", content: "Hi" },
        { role: "bot", content: "Hello! How can I help?" },
        { role: "visitor", content: "What are your refund terms?" },
      ],
      FALLBACK,
    );
    expect(currentMessage).toBe("What are your refund terms?");
    // History is everything before that latest visitor message, mapped into
    // the planner's visitor/bot vocabulary.
    expect(conversationHistory).toEqual([
      { role: "visitor", content: "Hi" },
      { role: "bot", content: "Hello! How can I help?" },
    ]);
  });

  test("treats agent replies as bot turns in history", () => {
    const { conversationHistory } = buildAutoSuggestTurnInput(
      [
        { role: "visitor", content: "Is it down?" },
        { role: "agent", content: "Checking now." },
        { role: "visitor", content: "Any update?" },
      ],
      FALLBACK,
    );
    expect(conversationHistory).toEqual([
      { role: "visitor", content: "Is it down?" },
      { role: "bot", content: "Checking now." },
    ]);
  });

  test("skips a trailing empty visitor message (e.g. image-only)", () => {
    const { currentMessage } = buildAutoSuggestTurnInput(
      [
        { role: "visitor", content: "My order is late" },
        { role: "visitor", content: "   " },
      ],
      FALLBACK,
    );
    expect(currentMessage).toBe("My order is late");
  });

  test("falls back to the instruction when there is no visitor message yet", () => {
    const { currentMessage, conversationHistory } = buildAutoSuggestTurnInput(
      [{ role: "bot", content: "Hi there 👋" }],
      FALLBACK,
    );
    expect(currentMessage).toBe(FALLBACK);
    expect(conversationHistory).toEqual([{ role: "bot", content: "Hi there 👋" }]);
  });

  test("falls back on an empty transcript", () => {
    const { currentMessage, conversationHistory } = buildAutoSuggestTurnInput(
      [],
      FALLBACK,
    );
    expect(currentMessage).toBe(FALLBACK);
    expect(conversationHistory).toEqual([]);
  });
});
