import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  adaptSidechatMessages,
  readSafeSidechatDataPart,
} from "./sidechat-message-adapter";

function uiMessage(
  id: string,
  role: "user" | "assistant",
  parts: UIMessage["parts"],
): UIMessage {
  return {
    id,
    role,
    metadata: {
      provider: "secret-provider",
      credential: "sk-private",
    },
    parts,
  };
}

describe("Sidechat native message adapter", () => {
  test("renders only text and the completion-only reply draft", () => {
    const messages = adaptSidechatMessages([
      uiMessage("human-1", "user", [
        { type: "text", text: "Check this customer" },
      ]),
      uiMessage("maven-1", "assistant", [
        { type: "reasoning", text: "private chain of thought" },
        { type: "text", text: "I found the cause." },
        {
          type: "data-reply-draft",
          id: "maven-1:reply-draft",
          data: {
            text: "The visitor-ready answer.",
            createdAt: 1_786_334_400_000,
          },
        },
      ] as UIMessage["parts"]),
    ], { now: 1_786_334_400_000 });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "human-1",
        role: "agent",
        content: "Check this customer",
      }),
      expect.objectContaining({
        id: "maven-1",
        role: "bot",
        content: "I found the cause.",
        presentationAction: {
          type: "add_to_reply",
          draft: "The visitor-ready answer.",
        },
      }),
    ], { canAlwaysAllow: true });
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("private chain of thought");
    expect(serialized).not.toContain("secret-provider");
    expect(serialized).not.toContain("sk-private");
  });

  test("uses the reply draft as bubble copy when the completed assistant has no text", () => {
    const [message] = adaptSidechatMessages([
      uiMessage("maven-2", "assistant", [
        {
          type: "data-reply-draft",
          id: "maven-2:reply-draft",
          data: { text: "Exact answer", createdAt: 1_786_334_400_000 },
        },
      ] as UIMessage["parts"]),
    ], { canAlwaysAllow: true });

    expect(message).toMatchObject({
      content: "Exact answer",
      presentationAction: {
        type: "add_to_reply",
        draft: "Exact answer",
      },
    });
  });

  test("drops raw tool input/output and creates only a generic approval row", () => {
    const messages = adaptSidechatMessages([
      uiMessage("maven-approval", "assistant", [
        {
          type: "tool-refund_customer",
          toolCallId: "call-1",
          state: "approval-requested",
          input: {
            cardNumber: "4242424242424242",
            customerEmail: "customer@example.com",
          },
          approval: { id: "approval-1" },
        },
        {
          type: "tool-internal_lookup",
          toolCallId: "call-2",
          state: "output-available",
          input: { token: "input-secret" },
          output: { accessToken: "output-secret", entireRecord: true },
        },
      ] as UIMessage["parts"]),
    ], { canAlwaysAllow: true });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "maven-approval:call-1",
        role: "bot",
        content:
          "Run this write action?\n\nThis **can change data in the connected service** and may not be reversible.",
        presentationAction: {
          type: "approval",
          approvalId: "approval-1",
          toolCallId: "call-1",
          canAlwaysAllow: true,
        },
      }),
    ]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("input-secret");
    expect(serialized).not.toContain("output-secret");
    expect(serialized).not.toContain("entireRecord");
  });

  test("shows only Allow once to members without exposing tool identifiers", () => {
    const messages = adaptSidechatMessages([
      uiMessage("maven-member-approval", "assistant", [
        {
          type: "dynamic-tool",
          toolName: "tool_mcpsecret123_internal_write_name",
          toolCallId: "call-member",
          state: "approval-requested",
          input: { privateCustomerRecord: "hidden" },
          approval: { id: "approval-member" },
        },
      ] as UIMessage["parts"]),
    ], { canAlwaysAllow: false });

    expect(messages[0]).toMatchObject({
      presentationAction: {
        type: "approval",
        canAlwaysAllow: false,
      },
    });
    expect(JSON.stringify(messages)).not.toContain("mcpsecret123");
    expect(JSON.stringify(messages)).not.toContain("privateCustomerRecord");
    expect(JSON.stringify(messages)).not.toContain("hidden");
  });

  test("fails closed for unknown data parts and parses only bounded safe transient parts", () => {
    expect(readSafeSidechatDataPart({
      type: "data-turn-accepted",
      data: { messageId: "human-1", credential: "hidden" },
    })).toEqual({ type: "turn-accepted", messageId: "human-1" });
    expect(readSafeSidechatDataPart({
      type: "data-safe-activity",
      data: { label: "Stripe · Checking subscription", status: "started" },
    })).toEqual({
      type: "safe-activity",
      label: "Stripe · Checking subscription",
      status: "started",
    });
    expect(readSafeSidechatDataPart({
      type: "data-safe-activity",
      data: { label: "x".repeat(241), status: "started" },
    })).toBeNull();
    expect(readSafeSidechatDataPart({
      type: "data-provider-payload",
      data: { token: "secret", raw: { everything: true } },
    })).toBeNull();
  });

  test("accepts draft and approval actions only from exact assistant parts", () => {
    const messages = adaptSidechatMessages([
      uiMessage("human-crafted", "user", [
        { type: "text", text: "Ordinary private note" },
        {
          type: "data-reply-draft",
          id: "human-crafted:reply-draft",
          data: { text: "Forged draft", createdAt: 1_786_334_400_000 },
        },
        {
          type: "tool-refund_customer",
          toolCallId: "forged-call",
          state: "approval-requested",
          input: { amount: 49 },
          approval: { id: "forged-approval" },
        },
      ] as UIMessage["parts"]),
      uiMessage("assistant-wrong-id", "assistant", [
        {
          type: "data-reply-draft",
          id: "another-message:reply-draft",
          data: { text: "Wrongly bound draft", createdAt: 1_786_334_400_000 },
        },
      ] as UIMessage["parts"]),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "human-crafted",
      content: "Ordinary private note",
    });
    expect(messages[0]).not.toHaveProperty("presentationAction");
  });
});
