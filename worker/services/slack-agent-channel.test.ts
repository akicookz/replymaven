import { expect, test } from "bun:test";
import {
  readSlackMessageInbound,
  readSlackUrlVerification,
  resolveSlackConversation,
} from "./slack-agent-channel";
import { matchesSlackRequestSignature } from "./slack-secrets";

const inbound = {
  channel: "slack" as const,
  text: "@Maven close this",
  actorName: "U1",
  commandId: "slack:p:1.0",
  externalMessageId: "1.0",
  replyToExternalId: null,
  replyToText: null,
};

test("targets a Conversation id in the replied-to text", () => {
  expect(resolveSlackConversation({
    inbound: {
      ...inbound,
      replyToExternalId: "9.0",
      replyToText: "Conversation: conv-1",
    },
    agentModeConversationIds: ["conv-2"],
    botName: "Maven",
    threadConversationId: "conv-9",
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("targets the Slack thread conversation when no Conversation id is present", () => {
  expect(resolveSlackConversation({
    inbound: {
      ...inbound,
      replyToExternalId: "9.0",
    },
    agentModeConversationIds: ["conv-2"],
    botName: "Maven",
    threadConversationId: "conv-9",
  })).toEqual({ kind: "targeted", conversationId: "conv-9" });
});

test("targets the only agent-mode conversation for a standalone command", () => {
  expect(resolveSlackConversation({
    inbound,
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
    threadConversationId: null,
  })).toEqual({ kind: "targeted", conversationId: "conv-1" });
});

test("is ambiguous when several agent-mode conversations exist", () => {
  const result = resolveSlackConversation({
    inbound,
    agentModeConversationIds: ["conv-1", "conv-2"],
    botName: "Maven",
    threadConversationId: null,
  });
  expect(result.kind).toBe("ambiguous");
});

test("is none for a non-command with no thread", () => {
  expect(resolveSlackConversation({
    inbound: { ...inbound, text: "hello" },
    agentModeConversationIds: ["conv-1"],
    botName: "Maven",
    threadConversationId: null,
  })).toEqual({ kind: "none", reason: "not_a_reply" });
});

test("url_verification returns the challenge", () => {
  expect(readSlackUrlVerification({
    type: "url_verification",
    challenge: "abc",
  })).toBe("abc");
});

test("reads a slack message event into inbound", () => {
  expect(readSlackMessageInbound({
    type: "event_callback",
    event: {
      type: "message",
      text: "hello",
      ts: "12.3",
      thread_ts: "10.1",
      channel: "C1",
      user: "U9",
    },
  }, "project-1")).toEqual({
    channelId: "C1",
    inbound: {
      channel: "slack",
      text: "hello",
      actorName: "U9",
      commandId: "slack:project-1:12.3",
      externalMessageId: "12.3",
      replyToExternalId: "10.1",
      replyToText: null,
    },
  });
});

test("rejects a slack signature that does not match", async () => {
  const trusted = await matchesSlackRequestSignature({
    signingSecret: "secret",
    timestamp: String(Math.floor(Date.now() / 1000)),
    signature: "v0=deadbeef",
    rawBody: "{\"ok\":true}",
  });
  expect(trusted).toBe(false);
});

test("accepts a matching slack signature", async () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "{\"type\":\"event_callback\"}";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const trusted = await matchesSlackRequestSignature({
    signingSecret: "secret",
    timestamp,
    signature: `v0=${hex}`,
    rawBody,
  });
  expect(trusted).toBe(true);
});
