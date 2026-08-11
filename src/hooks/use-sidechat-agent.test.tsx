import { describe, expect, test } from "bun:test";
import type { SidechatSessionResponse } from "../../shared/sidechat-agent";
import {
  buildSidechatAgentConnectionOptions,
  buildSidechatChatOptions,
  buildSidechatSendBody,
  fetchSidechatSession,
  deriveNativeSidechatUiStatus,
  isSidechatSessionUsable,
  planFailedSidechatRetry,
  planInitialSidechatSubmission,
  reduceAcceptedSidechatTransfer,
  sidechatSessionRefreshInterval,
} from "./use-sidechat-agent";

function session(overrides: Partial<SidechatSessionResponse> = {}) {
  return {
    parentAgent: "MavenProjectAgent" as const,
    parentName: "project-1",
    childAgent: "MavenChatAgent" as const,
    childName: "sc_conversation-1",
    token: "signed-token",
    expiresAt: 2_000,
    created: true,
    ...overrides,
  };
}

describe("native Sidechat client contract", () => {
  test("requests the exact authenticated project conversation session", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchSidechatSession(
      "project / one",
      "conversation / one",
      async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json(session());
      },
    );

    expect(result.childName).toBe("sc_conversation-1");
    expect(requests).toEqual([{
      input:
        "/api/projects/project%20%2F%20one/conversations/conversation%20%2F%20one/sidechat/session",
      init: { method: "POST" },
    }]);
  });

  test("connects directly to the registered child with the short-lived token", () => {
    expect(buildSidechatAgentConnectionOptions(session())).toEqual({
      agent: "MavenProjectAgent",
      name: "project-1",
      sub: [{ agent: "MavenChatAgent", name: "sc_conversation-1" }],
      query: { token: "signed-token" },
      queryDeps: ["signed-token"],
    });
    expect(sidechatSessionRefreshInterval(session(), 1_900_000)).toBe(85_000);
    expect(sidechatSessionRefreshInterval(session(), 1_995_000)).toBe(5_000);
    expect(isSidechatSessionUsable(session(), 1_984_999)).toBe(true);
    expect(isSidechatSessionUsable(session(), 1_985_000)).toBe(false);
  });

  test("resumes and syncs native chat without cancelling work on local cleanup", () => {
    const options = buildSidechatChatOptions("signed-token", () => undefined);
    expect(options.resume).toBe(true);
    expect(options.cancelOnClientAbort).toBe(false);
    expect(options.body()).toEqual({ token: "signed-token" });
    expect(buildSidechatSendBody("signed-token", "human-1")).toEqual({
      token: "signed-token",
      submittedMessageId: "human-1",
    });
    expect(deriveNativeSidechatUiStatus({
      status: "ready",
      isServerStreaming: true,
      isRecovering: false,
    })).toBe("streaming");
    expect(deriveNativeSidechatUiStatus({
      status: "ready",
      isServerStreaming: false,
      isRecovering: true,
    })).toBe("streaming");
  });

  test("submits a captured public draft only for a newly-created child", () => {
    expect(planInitialSidechatSubmission({
      session: session({ created: true }),
      messageId: "human-1",
      publicTextSnapshot: "  Please investigate this  ",
      trustedDefault: "Help me respond to Ada.",
    })).toEqual({
      messageId: "human-1",
      text: "Please investigate this",
    });
    expect(planInitialSidechatSubmission({
      session: session({ created: true }),
      messageId: "human-2",
      publicTextSnapshot: "   ",
      trustedDefault: "Help me respond to Ada.",
    })).toEqual({
      messageId: "human-2",
      text: "Help me respond to Ada.",
    });
    expect(planInitialSidechatSubmission({
      session: session({ created: false }),
      messageId: "human-3",
      publicTextSnapshot: "Do not send this again",
      trustedDefault: "Help me respond to Ada.",
    })).toBeNull();
  });

  test("clears only the unchanged captured public text after matching acceptance", () => {
    const transfer = {
      conversationId: "conversation-1",
      messageId: "human-1",
      textSnapshot: "Investigate billing",
    };
    expect(reduceAcceptedSidechatTransfer({
      transfer,
      acceptedMessageId: "human-1",
      selectedConversationId: "conversation-1",
      currentPublicDraft: "Investigate billing",
    })).toEqual({ nextDraft: "", transfer: null });
    expect(reduceAcceptedSidechatTransfer({
      transfer,
      acceptedMessageId: "human-1",
      selectedConversationId: "conversation-1",
      currentPublicDraft: "Investigate billing, urgently",
    })).toEqual({
      nextDraft: "Investigate billing, urgently",
      transfer: null,
    });
    expect(reduceAcceptedSidechatTransfer({
      transfer,
      acceptedMessageId: "different-message",
      selectedConversationId: "conversation-1",
      currentPublicDraft: "Investigate billing",
    })).toEqual({
      nextDraft: "Investigate billing",
      transfer,
    });
  });

  test("retries a failed pre-acceptance send without discarding the public draft", () => {
    const transfer = {
      conversationId: "conversation-1",
      messageId: "human-1",
      textSnapshot: "Investigate billing",
      submitted: true,
    };
    expect(planFailedSidechatRetry({
      transfer,
      persistedMessageIds: new Set(),
      trustedDefault: "Help me respond to Ada.",
    })).toEqual({
      kind: "resubmit",
      messageId: "human-1",
      text: "Investigate billing",
    });
    expect(planFailedSidechatRetry({
      transfer,
      persistedMessageIds: new Set(["human-1"]),
      trustedDefault: "Help me respond to Ada.",
    })).toEqual({
      kind: "regenerate",
      acceptedMessageId: "human-1",
    });
    expect(planFailedSidechatRetry({
      transfer: null,
      persistedMessageIds: new Set(),
      trustedDefault: "Help me respond to Ada.",
    })).toEqual({ kind: "regenerate" });
  });
});
