import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  hasVisibleSidechatAssistantText,
  resolveCompletedSidechatSummary,
  summarizeStreamFinish,
} from "./sidechat-turn-outcome";

function assistant(parts: UIMessage["parts"]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts };
}

describe("sidechat turn outcome", () => {
  test("treats only non-empty text parts as a visible answer", () => {
    expect(hasVisibleSidechatAssistantText(assistant([]))).toBe(false);
    expect(
      hasVisibleSidechatAssistantText(
        assistant([{ type: "text", text: "   " }]),
      ),
    ).toBe(false);
    expect(
      hasVisibleSidechatAssistantText(
        assistant([{ type: "reasoning", text: "thinking" } as UIMessage["parts"][number]]),
      ),
    ).toBe(false);
    expect(
      hasVisibleSidechatAssistantText(
        assistant([{ type: "text", text: "The visitor asked about billing." }]),
      ),
    ).toBe(true);
  });

  test("maps a completed turn to ready, idle, or failed", () => {
    expect(
      resolveCompletedSidechatSummary({
        publishedDraft: true,
        hasAssistantText: false,
      }),
    ).toBe("ready");
    expect(
      resolveCompletedSidechatSummary({
        publishedDraft: false,
        hasAssistantText: true,
      }),
    ).toBe("idle");
    expect(
      resolveCompletedSidechatSummary({
        publishedDraft: false,
        hasAssistantText: false,
      }),
    ).toBe("failed");
  });

  test("reads finishReason, usage, and text length from a stream finish event", () => {
    expect(summarizeStreamFinish(null)).toEqual({
      finishReason: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      textLength: 0,
      stepCount: null,
    });
    expect(
      summarizeStreamFinish({
        finishReason: "stop",
        text: "hello",
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        steps: [{}, {}],
      }),
    ).toEqual({
      finishReason: "stop",
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      textLength: 5,
      stepCount: 2,
    });
  });
});
