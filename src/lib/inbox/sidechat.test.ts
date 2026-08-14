import { describe, expect, test } from "bun:test";
import {
  deriveAddToReplyIntent,
  deriveComposerShiftTabIntent,
  deriveConversationInteractionState,
  deriveMessageActions,
  deriveMessagePresentation,
  deriveSidechatPaneMode,
  deriveSidechatPresentation,
  deriveSidechatStatusDot,
  isSidechatToolRunning,
} from "./sidechat";

function keyboardInput(overrides: Partial<Parameters<
  typeof deriveComposerShiftTabIntent
>[0]> = {}) {
  return {
    contract: "public" as const,
    hasDraft: false,
    key: "Tab",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

describe("Sidechat presentation helpers", () => {
  test("aligns Sidechat as a private conversation between You and Maven", () => {
    expect(deriveMessagePresentation(
      "sidechat",
      "agent",
      "Ada",
      "Visitor",
    )).toEqual({ isReceived: false, senderLabel: "You" });
    expect(deriveMessagePresentation(
      "sidechat",
      "bot",
      "Maven",
      "Visitor",
    )).toEqual({ isReceived: true, senderLabel: "Maven" });
  });

  test("keeps public sender labels unchanged", () => {
    expect(deriveMessagePresentation(
      "public",
      "visitor",
      null,
      "Luis",
    )).toEqual({ isReceived: true, senderLabel: "Luis" });
    expect(deriveMessagePresentation(
      "public",
      "bot",
      "Maven",
      "Luis",
    )).toEqual({ isReceived: false, senderLabel: "Maven · AI" });
  });

  test("reserves unmodified Shift+Tab for the public composer only", () => {
    expect(deriveComposerShiftTabIntent(keyboardInput())).toBe(
      "start_sidechat",
    );
    expect(deriveComposerShiftTabIntent(keyboardInput({
      contract: "sidechat",
    }))).toBeNull();
    for (const blocked of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      { repeat: true },
    ]) {
      expect(deriveComposerShiftTabIntent(keyboardInput(blocked))).toBeNull();
    }
  });

  test("shows message actions only for Sidechat presentation messages", () => {
    expect(deriveMessageActions(
      "sidechat",
      { type: "add_to_reply", draft: "Draft" },
      false,
    )).toEqual({
      addToReply: true,
      approveAlways: false,
      approveOnce: false,
    });
    expect(deriveMessageActions(
      "sidechat",
      {
        type: "approval",
        approvalId: "approval-1",
        toolCallId: "call-1",
        canAlwaysAllow: true,
      },
      false,
    )).toEqual({
      addToReply: false,
      approveAlways: true,
      approveOnce: true,
    });
    expect(deriveMessageActions(
      "public",
      {
        type: "approval",
        approvalId: "approval-1",
        toolCallId: "call-1",
        canAlwaysAllow: true,
      },
      false,
    ).approveOnce).toBe(false);
    expect(deriveMessageActions(
      "sidechat",
      {
        type: "approval",
        approvalId: "approval-1",
        toolCallId: "call-1",
        canAlwaysAllow: true,
      },
      true,
    ).approveOnce).toBe(false);
  });

  test("Add to reply is replace, focus-at-end, keep-open, and never-send", () => {
    expect(deriveAddToReplyIntent("Exact draft")).toEqual({
      draft: "Exact draft",
      draftMode: "replace",
      focusPublicComposer: true,
      caret: "end",
      send: false,
      keepSidechatOpen: true,
      focusTiming: "immediate",
    });
    expect(deriveAddToReplyIntent("Exact draft", 390)).toMatchObject({
      keepSidechatOpen: false,
      focusTiming: "after_pane_close",
    });
  });

  test("maps the exact responsive pane modes", () => {
    expect(deriveSidechatPaneMode(1536)).toBe("desktop");
    expect(deriveSidechatPaneMode(768)).toBe("compact");
    expect(deriveSidechatPaneMode(767)).toBe("mobile");
  });

  test("archives make the shell read-only", () => {
    expect(deriveConversationInteractionState(null)).toEqual({
      readOnly: false,
      showComposer: true,
      showMessageActions: true,
    });
    expect(deriveConversationInteractionState("2026-08-09T00:00:00.000Z"))
      .toEqual({
        readOnly: true,
        showComposer: false,
        showMessageActions: false,
      });
  });

  test("surfaces a server-side turn failure the client stream never saw", () => {
    // Stuck state: continuation died server-side, client still shows busy.
    expect(deriveSidechatPresentation({
      uiStatus: "streaming",
      rawStatus: "streaming",
      summaryStatus: "failed",
      hasApproval: false,
      hasReplyDraft: false,
    })).toEqual({
      status: "error",
      presentationStatus: "failed",
      serverFailure: true,
    });
  });

  test("does not override an optimistic send or a pending approval with a stale failure", () => {
    expect(deriveSidechatPresentation({
      uiStatus: "streaming",
      rawStatus: "submitted",
      summaryStatus: "failed",
      hasApproval: false,
      hasReplyDraft: false,
    })).toEqual({
      status: "streaming",
      presentationStatus: "working",
      serverFailure: false,
    });
    expect(deriveSidechatPresentation({
      uiStatus: "ready",
      rawStatus: "ready",
      summaryStatus: "failed",
      hasApproval: true,
      hasReplyDraft: false,
    })).toEqual({
      status: "ready",
      presentationStatus: "waiting_approval",
      serverFailure: false,
    });
  });

  test("keeps the existing presentation ladder when the summary is healthy", () => {
    expect(deriveSidechatPresentation({
      uiStatus: "error",
      rawStatus: "error",
      summaryStatus: "working",
      hasApproval: false,
      hasReplyDraft: false,
    })).toEqual({
      status: "error",
      presentationStatus: "failed",
      serverFailure: false,
    });
    expect(deriveSidechatPresentation({
      uiStatus: "streaming",
      rawStatus: "streaming",
      summaryStatus: "working",
      hasApproval: false,
      hasReplyDraft: false,
    })).toEqual({
      status: "streaming",
      presentationStatus: "working",
      serverFailure: false,
    });
    expect(deriveSidechatPresentation({
      uiStatus: "ready",
      rawStatus: "ready",
      summaryStatus: "idle",
      hasApproval: false,
      hasReplyDraft: true,
    })).toEqual({
      status: "ready",
      presentationStatus: "ready",
      serverFailure: false,
    });
    expect(deriveSidechatPresentation({
      uiStatus: "ready",
      rawStatus: "ready",
      summaryStatus: "idle",
      hasApproval: false,
      hasReplyDraft: false,
    })).toEqual({
      status: "ready",
      presentationStatus: "idle",
      serverFailure: false,
    });
  });

  test("marks executing tool states as running, including approved continuations", () => {
    expect(isSidechatToolRunning("input-streaming")).toBe(true);
    expect(isSidechatToolRunning("input-available")).toBe(true);
    expect(isSidechatToolRunning("approval-responded")).toBe(true);
    expect(isSidechatToolRunning("approval-requested")).toBe(false);
    expect(isSidechatToolRunning("output-available")).toBe(false);
    expect(isSidechatToolRunning("output-error")).toBe(false);
    expect(isSidechatToolRunning("output-denied")).toBe(false);
  });

  test("retains isolated future status-dot presentation", () => {
    expect(deriveSidechatStatusDot("idle")).toBeNull();
    expect(deriveSidechatStatusDot("working")).toMatchObject({
      colorClass: "bg-dot-blue",
      motionClass: "motion-safe:animate-pulse",
    });
    expect(deriveSidechatStatusDot("waiting_approval")?.colorClass)
      .toBe("bg-dot-orange");
    expect(deriveSidechatStatusDot("ready")?.colorClass).toBe("bg-dot-green");
    expect(deriveSidechatStatusDot("failed")?.colorClass)
      .toBe("bg-destructive");
  });
});
