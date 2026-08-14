import { describe, expect, test } from "bun:test";
import { Chat } from "@ai-sdk/react";
import type { ChatTransport, UIMessage } from "ai";
import type { SidechatSessionResponse } from "../../shared/sidechat-agent";
import {
  buildSidechatAgentConnectionOptions,
  buildSidechatChatOptions,
  buildSidechatSendRequest,
  buildSidechatSendBody,
  fetchSidechatSession,
  deriveNativeSidechatUiStatus,
  planFailedSidechatRetry,
  planInitialSidechatSubmission,
  reduceAcceptedSidechatTransfer,
  sidechatSessionRefreshInterval,
  submitSidechatApproval,
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
    canApproveOnce: true,
    canAlwaysAllow: true,
    ...overrides,
  };
}

describe("native Sidechat client contract", () => {
  test("appends a new human message through the native AI SDK contract", async () => {
    const requests: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0][] = [];
    const transport: ChatTransport<UIMessage> = {
      async sendMessages(request) {
        requests.push(request);
        return new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      },
      async reconnectToStream() {
        return null;
      },
    };
    const chat = new Chat<UIMessage>({ id: "sidechat-1", transport });
    const request = buildSidechatSendRequest(
      "signed-token",
      "Check the renewal date",
      "human-1",
    );

    await chat.sendMessage(request.message, request.options);

    expect(chat.messages).toEqual([{
      id: "human-1",
      role: "user",
      parts: [{ type: "text", text: "Check the renewal date" }],
    }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messageId).toBeUndefined();
    expect(requests[0]?.body).toEqual({
      token: "signed-token",
      submittedMessageId: "human-1",
    });
  });

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
    expect(sidechatSessionRefreshInterval(session(), 1_900_000)).toBe(50_000);
    expect(sidechatSessionRefreshInterval(session(), 1_995_000)).toBe(5_000);
    expect(sidechatSessionRefreshInterval(session(), 2_100_000)).toBe(5_000);
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
    })).toEqual({
      messageId: "human-1",
      text: "Please investigate this",
    });
    // No captured draft: open the pane empty, never auto-send a default.
    expect(planInitialSidechatSubmission({
      session: session({ created: true }),
      messageId: "human-2",
      publicTextSnapshot: "   ",
    })).toBeNull();
    expect(planInitialSidechatSubmission({
      session: session({ created: false }),
      messageId: "human-3",
      publicTextSnapshot: "Do not send this again",
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
    })).toEqual({
      kind: "resubmit",
      messageId: "human-1",
      text: "Investigate billing",
    });
    expect(planFailedSidechatRetry({
      transfer,
      persistedMessageIds: new Set(["human-1"]),
    })).toEqual({
      kind: "regenerate",
      acceptedMessageId: "human-1",
    });
    expect(planFailedSidechatRetry({
      transfer: { ...transfer, textSnapshot: "   " },
      persistedMessageIds: new Set(),
    })).toEqual({ kind: "regenerate" });
    expect(planFailedSidechatRetry({
      transfer: null,
      persistedMessageIds: new Set(),
    })).toEqual({ kind: "regenerate" });
  });

  test("submits native Allow once without creating persistent policy", async () => {
    const requests: string[] = [];
    const approveNative = async (approvalId: string) => {
      requests.push(`native:${approvalId}`);
    };
    await submitSidechatApproval({
      mode: "once",
      projectId: "project-1",
      conversationId: "conversation-1",
      approvalId: "approval-1",
      toolCallId: "call-1",
      approveNative,
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests).toEqual(["native:approval-1"]);
  });

  test("persists Always allow before native approval and stops on a stale grant", async () => {
    const order: string[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      order.push(`grant:${String(input)}:${String(init?.body)}`);
      return new Response(null, { status: 204 });
    };
    await submitSidechatApproval({
      mode: "always",
      projectId: "project / one",
      conversationId: "conversation / one",
      approvalId: "approval / one",
      toolCallId: "call-1",
      approveNative: async (approvalId) => {
        order.push(`native:${approvalId}`);
      },
      fetcher,
    });
    expect(order).toEqual([
      'grant:/api/projects/project%20%2F%20one/conversations/conversation%20%2F%20one/sidechat/approvals/approval%20%2F%20one/always:{"toolCallId":"call-1"}',
      "native:approval / one",
    ]);

    let approved = false;
    await expect(submitSidechatApproval({
      mode: "always",
      projectId: "project-1",
      conversationId: "conversation-1",
      approvalId: "approval-stale",
      toolCallId: "call-stale",
      approveNative: async () => {
        approved = true;
      },
      fetcher: async () => Response.json(
        { error: "approval_stale" },
        { status: 409 },
      ),
    })).rejects.toThrow("approval_stale");
    expect(approved).toBe(false);
  });
});
