import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import type { PublicMessageMetadata } from "../../../shared/maven-conversation";
import {
  adaptPublicMessages,
  reconcilePublicMessages,
} from "./public-message-adapter";

function metadata(
  author: PublicMessageMetadata["author"],
  overrides: Partial<PublicMessageMetadata> = {},
): PublicMessageMetadata {
  return {
    v: 1,
    channel: "public",
    projectId: "project-1",
    conversationId: "conversation-1",
    author,
    senderName: null,
    senderAvatar: null,
    userId: null,
    imageUrls: [],
    sources: [],
    createdAt: 1_786_334_400_000,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
    systemKind: null,
    ...overrides,
  };
}

function message(
  id: string,
  role: UIMessage["role"],
  value: PublicMessageMetadata,
  text: string,
): UIMessage {
  return {
    id,
    role,
    metadata: value,
    parts: [{ type: "text", text }],
  };
}

describe("public Agent message adapter", () => {
  test("preserves every dashboard-visible public message field", () => {
    const messages = adaptPublicMessages([
      message("visitor-1", "user", metadata("visitor", {
        senderName: "Ada",
        imageUrls: ["https://uploads.test/one.png", "https://uploads.test/two.png"],
        deliveredAt: 1_786_334_401_000,
        readAt: 1_786_334_402_000,
      }), "Can you help?"),
      message("bot-1", "assistant", metadata("bot", {
        senderName: "Maven",
        sources: [{ title: "Pricing", url: "https://example.test/pricing", type: "webpage" }],
      }), "The Pro plan includes this."),
      message("agent-1", "assistant", metadata("agent", {
        senderName: "Grace",
        senderAvatar: "https://example.test/grace.png",
        userId: "user-1",
        emailedAt: 1_786_334_403_000,
      }), "I can take it from here."),
      message("system-1", "system", metadata("system", {
        systemKind: "snoozed",
      }), "Snoozed until tomorrow"),
    ], "project-1", "conversation-1");

    expect(messages).toEqual([
      expect.objectContaining({
        id: "visitor-1",
        role: "visitor",
        content: "Can you help?",
        imageUrl: '["https://uploads.test/one.png","https://uploads.test/two.png"]',
        senderName: "Ada",
        deliveredAt: "2026-08-10T04:00:01.000Z",
        readAt: "2026-08-10T04:00:02.000Z",
      }),
      expect.objectContaining({
        id: "bot-1",
        role: "bot",
        content: "The Pro plan includes this.",
        sources: '[{"title":"Pricing","url":"https://example.test/pricing","type":"webpage"}]',
      }),
      expect.objectContaining({
        id: "agent-1",
        role: "agent",
        senderName: "Grace",
        senderAvatar: "https://example.test/grace.png",
        userId: "user-1",
        emailedAt: "2026-08-10T04:00:03.000Z",
      }),
      expect.objectContaining({
        id: "system-1",
        role: "system",
        sources: '{"systemKind":"snoozed"}',
      }),
    ]);
  });

  test("drops messages with foreign, malformed, or role-mismatched metadata", () => {
    const valid = message("valid", "assistant", metadata("bot"), "Safe");
    const foreign = message("foreign", "assistant", metadata("bot", {
      conversationId: "conversation-2",
    }), "Wrong conversation");
    const forged = message("forged", "assistant", metadata("visitor"), "Wrong role");
    const malformed = {
      id: "malformed",
      role: "assistant",
      metadata: { channel: "public" },
      parts: [{ type: "text", text: "No contract" }],
    } as UIMessage;

    expect(adaptPublicMessages(
      [valid, foreign, forged, malformed],
      "project-1",
      "conversation-1",
    )).toEqual([expect.objectContaining({ id: "valid" })]);
  });

  test("replaces a matching optimistic reply and retains unmatched pending replies", () => {
    const authoritative = adaptPublicMessages([
      message("reply-1", "assistant", metadata("agent", {
        imageUrls: ["https://uploads.test/one.png"],
      }), "Sent reply"),
    ], "project-1", "conversation-1");
    const existing = [
      {
        id: "reply-1",
        role: "agent" as const,
        content: "Sent reply",
        imageUrl: "https://uploads.test/one.png",
        createdAt: "2026-08-10T04:00:00.000Z",
        _optimistic: true,
      },
      {
        id: "reply-2",
        role: "agent" as const,
        content: "Still pending",
        imageUrl: null,
        createdAt: "2026-08-10T04:00:04.000Z",
        _optimistic: true,
      },
    ];

    expect(reconcilePublicMessages(authoritative, existing)).toEqual([
      expect.objectContaining({ id: "reply-1", content: "Sent reply" }),
      expect.objectContaining({ id: "reply-2", _optimistic: true }),
    ]);
  });
});
