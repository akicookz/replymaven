import { describe, expect, test } from "bun:test";
import type {
  MavenConversationSummary,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import {
  buildConversationDirectoryAgentOptions,
  readMavenProjectEvent,
  summaryToDashboardConversation,
} from "./use-conversation-directory-agent";

function session(): SidechatSummarySessionResponse {
  return {
    summaries: [],
    parentAgent: "MavenProjectAgent",
    parentName: "project-1",
    token: "signed-parent-token",
    expiresAt: 2_000,
  };
}

function summary(): MavenConversationSummary {
  return {
    conversationId: "conversation-1",
    publicChildName: "pub_conversation-1",
    sidechatChildName: null,
    sidechatStatus: null,
    customerId: null,
    visitorId: "visitor-1",
    visitorName: "Ada",
    visitorEmail: "ada@example.com",
    telegramThreadId: null,
    status: "waiting_agent",
    closeReason: null,
    metadata: { country: "KR" },
    priority: "high",
    assigneeId: "user-1",
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    visitorLastSeenAt: 90,
    visitorPresence: "active",
    visitorLastOnlineAt: 95,
    lastMessageId: "message-1",
    lastMessageAuthor: "visitor",
    lastMessagePreview: "Need help",
    lastMessageSenderName: "Ada",
    lastMessageEmailedAt: null,
    lastMessageCreatedAt: 99,
    lastActivityAt: 100,
    messageCount: 1,
    botMessageCount: 0,
    childRevision: 2,
    createdAt: 50,
    updatedAt: 100,
  };
}

describe("conversation directory Agent client", () => {
  test("connects to the project parent with its short-lived read token", () => {
    expect(buildConversationDirectoryAgentOptions(session())).toEqual({
      agent: "MavenProjectAgent",
      name: "project-1",
      query: { token: "signed-parent-token" },
      queryDeps: ["signed-parent-token"],
    });
  });

  test("accepts only bounded parent summary and inbox-count events", () => {
    const event = { type: "conversation-summary", summary: summary() };
    expect(readMavenProjectEvent(JSON.stringify(event))).toEqual(event);
    expect(readMavenProjectEvent(JSON.stringify({
      type: "inbox-counts",
      counts: {
        "needs-you": 1,
        all: 2,
        snoozed: 0,
        resolved: 1,
        archived: 0,
        flagged: 0,
      },
    }))).toMatchObject({ type: "inbox-counts" });
    expect(readMavenProjectEvent("not-json")).toBeNull();
    expect(readMavenProjectEvent(JSON.stringify({
      type: "conversation-summary",
      summary: { conversationId: "forged" },
    }))).toBeNull();
  });

  test("converts a parent summary to the existing dashboard wire shape", () => {
    expect(summaryToDashboardConversation(summary())).toMatchObject({
      id: "conversation-1",
      metadata: '{"country":"KR"}',
      status: "waiting_agent",
      priority: "high",
      createdAt: "1970-01-01T00:00:00.050Z",
      updatedAt: "1970-01-01T00:00:00.100Z",
      lastMessage: {
        id: "message-1",
        role: "visitor",
        content: "Need help",
        senderName: "Ada",
        createdAt: "1970-01-01T00:00:00.099Z",
      },
    });
  });
});
