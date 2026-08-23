import { expect, test } from "bun:test";
import type { AgentChannelAdapter, AgentChannelInbound } from "./agent-channel";
import { runAgentChannelInbound } from "./run-agent-channel-inbound";

const inbound: AgentChannelInbound = {
  channel: "telegram",
  text: "@Maven close this",
  actorName: "Ada",
  commandId: "telegram:p:c:1",
  externalMessageId: "11",
  replyToExternalId: "9",
  replyToText: "Conversation: conv-1",
};

const conversation = {
  id: "conv-1",
  visitorId: "vis-1",
  visitorEmail: null,
  metadata: {},
};

function createAdapter(
  resolve: AgentChannelAdapter["resolveConversation"],
): { adapter: AgentChannelAdapter; confirms: string[] } {
  const confirms: string[] = [];
  return {
    confirms,
    adapter: {
      channel: "telegram",
      resolveConversation: resolve,
      async notifyEscalation() {
        return null;
      },
      async forwardVisitorMessage() {},
      async confirm(input) {
        confirms.push(input.text);
      },
    },
  };
}

test("confirms an ambiguous resolve and does not append", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "ambiguous",
    hint: "Multiple active conversations.",
  }));
  let appended = 0;
  await runAgentChannelInbound({
    adapter,
    inbound,
    botName: "Maven",
    getAgentModeConversations: async () => [{ id: "conv-1" }],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => conversation,
    executeCommand: async () => ({ handled: false }),
    appendHuman: async () => {
      appended += 1;
      return { id: "m1" };
    },
  });
  expect(confirms).toEqual(["Multiple active conversations."]);
  expect(appended).toBe(0);
});

test("does not append when resolve is none", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "none",
    reason: "not_a_reply",
  }));
  let appended = 0;
  await runAgentChannelInbound({
    adapter,
    inbound,
    botName: "Maven",
    getAgentModeConversations: async () => [],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => conversation,
    executeCommand: async () => ({ handled: false }),
    appendHuman: async () => {
      appended += 1;
      return { id: "m1" };
    },
  });
  expect(confirms).toEqual([]);
  expect(appended).toBe(0);
});

test("confirms a handled command", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "targeted",
    conversationId: "conv-1",
  }));
  let appended = 0;
  await runAgentChannelInbound({
    adapter,
    inbound,
    botName: "Maven",
    getAgentModeConversations: async () => [{ id: "conv-1" }],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => conversation,
    executeCommand: async () => ({
      handled: true,
      confirmation: "Bot resumed.",
    }),
    appendHuman: async () => {
      appended += 1;
      return { id: "m1" };
    },
  });
  expect(confirms).toEqual(["Bot resumed."]);
  expect(appended).toBe(0);
});

test("appends a normal telegram reply", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "targeted",
    conversationId: "conv-1",
  }));
  const appended: unknown[] = [];
  await runAgentChannelInbound({
    adapter,
    inbound: { ...inbound, text: "hello" },
    botName: "Maven",
    getAgentModeConversations: async () => [{ id: "conv-1" }],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => conversation,
    executeCommand: async () => ({ handled: false }),
    appendHuman: async (fields) => {
      appended.push(fields);
      return { id: "m1" };
    },
  });
  expect(confirms).toEqual([]);
  expect(appended).toEqual([{
    conversationId: "conv-1",
    content: "hello",
    senderName: "Ada",
    origin: "telegram",
    externalReplyTo: "9",
    idempotencyKey: "telegram:p:c:1",
  }]);
});

test("confirms when append fails", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "targeted",
    conversationId: "conv-1",
  }));
  await runAgentChannelInbound({
    adapter,
    inbound: { ...inbound, text: "hello" },
    botName: "Maven",
    getAgentModeConversations: async () => [{ id: "conv-1" }],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => conversation,
    executeCommand: async () => ({ handled: false }),
    appendHuman: async () => null,
  });
  expect(confirms).toEqual([
    "That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.",
  ]);
});

test("does not append when the conversation is missing", async () => {
  const { adapter, confirms } = createAdapter(async () => ({
    kind: "targeted",
    conversationId: "conv-1",
  }));
  let appended = 0;
  await runAgentChannelInbound({
    adapter,
    inbound,
    botName: "Maven",
    getAgentModeConversations: async () => [{ id: "conv-1" }],
    findByChannelThread: async () => null,
    getOperationalConversation: async () => null,
    executeCommand: async () => ({ handled: false }),
    appendHuman: async () => {
      appended += 1;
      return { id: "m1" };
    },
  });
  expect(confirms).toEqual([]);
  expect(appended).toBe(0);
});
