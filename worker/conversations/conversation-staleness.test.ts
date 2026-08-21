import { describe, expect, test } from "bun:test";
import { canAutoCloseConversationStatus } from "./conversation-staleness";

describe("conversation auto-close status", () => {
  test("keeps human-owned statuses open", () => {
    expect(canAutoCloseConversationStatus("waiting_agent")).toBe(false);
    expect(canAutoCloseConversationStatus("agent_replied")).toBe(false);
  });

  test("does not close an already closed conversation", () => {
    expect(canAutoCloseConversationStatus("closed")).toBe(false);
  });

  test("allows active AI-owned conversations to auto-close", () => {
    expect(canAutoCloseConversationStatus("active")).toBe(true);
  });
});
