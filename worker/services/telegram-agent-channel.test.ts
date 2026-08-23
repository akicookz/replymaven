import { expect, test } from "bun:test";
import { resolveTelegramConversation } from "./telegram-agent-channel";

const inbound = {
  channel: "telegram" as const,
  text: "@Maven close this",
  actorName: "Ada",
  commandId: "telegram:p:c:1",
  externalMessageId: "1",
  replyToExternalId: null,
  replyToText: null,
};

test("targets a Conversation id in the replied-to text", () => {
  expect(resolveTelegramConversation({
    inbound: {
      ...inbound,
      replyToExternalId: "9",
      replyToText: "Conversation: conv-1",
    },
    agentModeConversationIds: ["conv-2"],
    botName: "Maven",
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("targets the only agent-mode conversation for a standalone command", () => {
  expect(resolveTelegramConversation({
    inbound,
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("is ambiguous when several agent-mode conversations exist", () => {
  const result = resolveTelegramConversation({
    inbound,
    agentModeConversationIds: ["conv-1", "conv-2"],
    botName: "Maven",
  });
  expect(result.kind).toBe("ambiguous");
});

test("is none for a non-command with no reply", () => {
  expect(resolveTelegramConversation({
    inbound: { ...inbound, text: "hello" },
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
  })).toEqual({ kind: "none", reason: "not_a_reply" });
});
