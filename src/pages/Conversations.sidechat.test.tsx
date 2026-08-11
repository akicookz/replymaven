import { describe, expect, test } from "bun:test";
import type { MavenProjectState } from "../../shared/sidechat-agent";
import {
  mergeSidechatSummaryStatuses,
  planSidechatEntry,
  shouldClearAcceptedPublicDraft,
} from "@/lib/inbox/sidechat";
import {
  planInitialSidechatSubmission,
  reduceAcceptedSidechatTransfer,
} from "@/hooks/use-sidechat-agent";

describe("Conversations native Sidechat orchestration", () => {
  test("opens an existing child without creating another initial transfer", () => {
    expect(planSidechatEntry({
      archived: false,
      exists: true,
      conversationId: "conversation-1",
      messageId: "human-2",
      publicDraft: "Do not submit this again",
    })).toEqual({ open: true, transfer: null });
    expect(planSidechatEntry({
      archived: true,
      exists: false,
      conversationId: "conversation-1",
      messageId: "human-3",
      publicDraft: "Cannot start archived work",
    })).toBeNull();
  });

  test("opens an existing child without submitting public composer text", () => {
    expect(planInitialSidechatSubmission({
      session: {
        parentAgent: "MavenProjectAgent",
        parentName: "project-1",
        childAgent: "MavenChatAgent",
        childName: "sc_conversation-1",
        token: "token",
        expiresAt: 2_000,
        created: false,
      },
      messageId: "human-1",
      publicTextSnapshot: "Keep this in the public composer",
      trustedDefault: "Help me respond to Ada.",
    })).toBeNull();
  });

  test("a matching acceptance never clears a different conversation or edited text", () => {
    expect(shouldClearAcceptedPublicDraft({
      transferConversationId: "conversation-1",
      selectedConversationId: "conversation-2",
      capturedText: "Investigate",
      currentText: "New reply",
    })).toBe(false);
    expect(reduceAcceptedSidechatTransfer({
      transfer: {
        conversationId: "conversation-1",
        messageId: "human-1",
        textSnapshot: "Investigate",
      },
      acceptedMessageId: "human-1",
      selectedConversationId: "conversation-2",
      currentPublicDraft: "New reply",
    })).toEqual({ nextDraft: "New reply", transfer: null });
  });

  test("live parent state overrides seeded statuses without inventing D1 state", () => {
    const live: MavenProjectState = {
      sidechats: {
        "conversation-1": {
          conversationId: "conversation-1",
          childName: "sc_conversation-1",
          status: "ready",
          updatedAt: 20,
        },
      },
    };
    expect(mergeSidechatSummaryStatuses([
      {
        conversationId: "conversation-1",
        childName: "sc_conversation-1",
        status: "working",
        updatedAt: 10,
      },
      {
        conversationId: "conversation-2",
        childName: "sc_conversation-2",
        status: "failed",
        updatedAt: 10,
      },
    ], live)).toEqual({
      "conversation-1": "ready",
      "conversation-2": "failed",
    });
    expect(mergeSidechatSummaryStatuses([
      {
        conversationId: "conversation-1",
        childName: "sc_conversation-1",
        status: "ready",
        updatedAt: 30,
      },
    ], {
      sidechats: {
        "conversation-1": {
          ...live.sidechats["conversation-1"],
          status: "working",
        },
      },
    })).toEqual({
      "conversation-1": "ready",
    });
  });
});
