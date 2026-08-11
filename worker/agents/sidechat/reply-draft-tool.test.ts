import { describe, expect, mock, test } from "bun:test";
import type { UIMessage } from "ai";
import type { ChatResponseResult } from "@cloudflare/ai-chat";
import {
  createReplyDraftTool,
  persistCompletedReplyDraft,
  replyDraftInputSchema,
} from "./reply-draft-tool";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts };
}

function result(
  status: ChatResponseResult["status"],
  parts: UIMessage["parts"],
): ChatResponseResult {
  return {
    message: assistantMessage(parts),
    requestId: "request-1",
    continuation: false,
    status,
  };
}

function settledDraftPart(text: string): UIMessage["parts"][number] {
  return {
    type: "tool-present_reply_draft",
    toolCallId: "call-1",
    state: "output-available",
    input: { text },
    output: { accepted: true },
  } as UIMessage["parts"][number];
}

describe("reply draft tool", () => {
  test("accepts only trimmed visitor-ready text from 1 through 5000 characters", () => {
    expect(replyDraftInputSchema.parse({ text: "  Ready reply  " })).toEqual({
      text: "Ready reply",
    });
    expect(replyDraftInputSchema.safeParse({ text: "   " }).success).toBe(
      false,
    );
    expect(
      replyDraftInputSchema.safeParse({ text: "x".repeat(5_001) }).success,
    ).toBe(false);
  });

  test("returns only an acceptance acknowledgement while the turn is streaming", async () => {
    const definition = createReplyDraftTool();

    await expect(
      definition.execute?.(
        { text: "Visitor-ready answer" },
        {} as never,
      ),
    ).resolves.toEqual({ accepted: true });
    expect(Object.keys(definition)).not.toContain("pendingDraft");
    expect(Object.keys(definition)).not.toContain("getDraft");
  });

  test("an early stream return after tool execution has no publishable outward draft", async () => {
    const definition = createReplyDraftTool();
    const persistMessages = mock(async () => undefined);

    await definition.execute?.(
      { text: "A draft from an interrupted stream" },
      {} as never,
    );

    expect(persistMessages).not.toHaveBeenCalled();
    expect(Object.keys(definition)).toEqual([
      "description",
      "inputSchema",
      "execute",
    ]);
  });

  test.each(["error", "aborted"] as const)(
    "publishes no draft when the native turn ends as %s",
    async (status) => {
      const persistMessages = mock(async () => undefined);
      const messages = [result(status, [settledDraftPart("Unsafe")]).message];

      await persistCompletedReplyDraft({
        result: result(status, [settledDraftPart("Unsafe")]),
        messages,
        persistMessages,
        now: () => 123,
      });

      expect(persistMessages).not.toHaveBeenCalled();
    },
  );

  test("publishes no draft for an unfinished or approval-pending tool part", async () => {
    const persistMessages = mock(async () => undefined);
    const pendingPart = {
      type: "tool-present_reply_draft",
      toolCallId: "call-1",
      state: "approval-requested",
      input: { text: "Not settled" },
      approval: { id: "approval-1" },
    } as UIMessage["parts"][number];
    const completed = result("completed", [pendingPart]);

    await persistCompletedReplyDraft({
      result: completed,
      messages: [completed.message],
      persistMessages,
      now: () => 123,
    });

    expect(persistMessages).not.toHaveBeenCalled();
  });

  test("attaches exactly one persistent reply draft after natural completion", async () => {
    const persistMessages = mock(async () => undefined);
    const completed = result("completed", [
      settledDraftPart("  Final visitor reply  "),
    ]);
    const messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Help" }] },
      completed.message,
    ] as UIMessage[];

    await persistCompletedReplyDraft({
      result: completed,
      messages,
      persistMessages,
      now: () => 123,
    });

    expect(persistMessages).toHaveBeenCalledTimes(1);
    const persisted = persistMessages.mock.calls[0]?.[0] as UIMessage[];
    expect(persisted[1]?.parts).toContainEqual({
      type: "data-reply-draft",
      id: "assistant-1:reply-draft",
      data: { text: "Final visitor reply", createdAt: 123 },
    });

    await persistCompletedReplyDraft({
      result: {
        ...completed,
        message: persisted[1]!,
      },
      messages: persisted,
      persistMessages,
      now: () => 456,
    });
    expect(persistMessages).toHaveBeenCalledTimes(1);
  });
});
