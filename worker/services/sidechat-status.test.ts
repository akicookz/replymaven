import { expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  hasSettledReplyDraft,
  readLastSidechatTurnOrigin,
  sidechatPingText,
} from "./sidechat-status";

test("names messenger pings for Sidechat status", () => {
  expect(sidechatPingText("working")).toBe("Maven is looking into that.");
  expect(sidechatPingText("waiting_approval")).toBe(
    "Maven needs approval in the dashboard.",
  );
  expect(sidechatPingText("ready")).toBe("Maven has a draft in the dashboard.");
  expect(sidechatPingText("failed")).toBe(
    "Maven could not finish. Open Sidechat in the dashboard.",
  );
  expect(sidechatPingText("idle")).toBeNull();
});

test("reads only telegram and slack investigate origins", () => {
  expect(readLastSidechatTurnOrigin({ lastSidechatTurnOrigin: "telegram" }))
    .toBe("telegram");
  expect(readLastSidechatTurnOrigin({ lastSidechatTurnOrigin: "slack" }))
    .toBe("slack");
  expect(readLastSidechatTurnOrigin({ lastSidechatTurnOrigin: "mcp" }))
    .toBeNull();
  expect(readLastSidechatTurnOrigin({})).toBeNull();
});

test("detects a settled reply draft on the latest assistant", () => {
  const messages: UIMessage[] = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "check billing" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{
        type: "tool-present_reply_draft",
        toolCallId: "draft-1",
        state: "output-available",
        input: { text: "hidden" },
        output: { accepted: true },
      }],
    },
  ];
  expect(hasSettledReplyDraft(messages)).toBe(true);
  expect(hasSettledReplyDraft([
    ...messages,
    {
      id: "assistant-2",
      role: "assistant",
      parts: [{ type: "text", text: "still looking" }],
    },
  ])).toBe(false);
  expect(hasSettledReplyDraft([{
    id: "assistant-3",
    role: "assistant",
    parts: [{
      type: "data-reply-draft",
      id: "assistant-3:reply-draft",
      data: { text: "hidden", createdAt: 1 },
    }],
  }])).toBe(true);
});
