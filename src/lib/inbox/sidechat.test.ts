import { describe, expect, test } from "bun:test";
import {
  deriveAddToReplyIntent,
  deriveConversationInteractionState,
  deriveMessageActions,
  deriveMessagePresentation,
  deriveSidechatPaneMode,
  deriveSidechatStatusDot,
  transitionPublicDraftAfterSidechatAccept,
} from "./sidechat";

describe("shared chat perspectives", () => {
  test("aligns public visitor messages as received and public replies as sent", () => {
    expect(
      deriveMessagePresentation("public", "visitor", null, "Ada Lovelace"),
    ).toEqual({ isReceived: true, senderLabel: "Ada Lovelace" });
    expect(
      deriveMessagePresentation("public", "bot", null, "Ada Lovelace"),
    ).toEqual({ isReceived: false, senderLabel: "Maven · AI" });
    expect(
      deriveMessagePresentation("public", "agent", "Akbar", "Ada Lovelace"),
    ).toEqual({ isReceived: false, senderLabel: "Akbar" });
  });

  test("aligns Sidechat Maven messages as received and labels the human as You", () => {
    expect(
      deriveMessagePresentation("sidechat", "bot", null, "Ada Lovelace"),
    ).toEqual({ isReceived: true, senderLabel: "Maven" });
    expect(
      deriveMessagePresentation("sidechat", "agent", "Akbar", "Ada Lovelace"),
    ).toEqual({ isReceived: false, senderLabel: "You" });
  });
});

describe("Sidechat message actions", () => {
  test("shows only Add to reply for a writable Sidechat reply draft", () => {
    expect(deriveMessageActions("sidechat", "reply_draft", false)).toEqual({
      addToReply: true,
      approveAlways: false,
      approveOnce: false,
    });
  });

  test("shows only approval actions for a writable Sidechat approval", () => {
    expect(deriveMessageActions("sidechat", "approval", false)).toEqual({
      addToReply: false,
      approveAlways: true,
      approveOnce: true,
    });
  });

  test("shows no Sidechat-only actions for text, public, or read-only messages", () => {
    expect(deriveMessageActions("sidechat", "text", false)).toEqual({
      addToReply: false,
      approveAlways: false,
      approveOnce: false,
    });
    expect(deriveMessageActions("public", "reply_draft", false)).toEqual({
      addToReply: false,
      approveAlways: false,
      approveOnce: false,
    });
    expect(deriveMessageActions("sidechat", "approval", true)).toEqual({
      addToReply: false,
      approveAlways: false,
      approveOnce: false,
    });
  });
});

describe("public composer transitions", () => {
  test("clears the submitted public draft only after Sidechat accepts it", () => {
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "Check the refund status",
        submittedDraft: "Check the refund status",
        accepted: false,
      }),
    ).toBe("Check the refund status");
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "Check the refund status",
        submittedDraft: "Check the refund status",
        accepted: true,
      }),
    ).toBe("");
  });

  test("does not erase edits typed while the accepted request was pending", () => {
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "A newer public reply",
        submittedDraft: "Check the refund status",
        accepted: true,
      }),
    ).toBe("A newer public reply");
  });

  test("Add to reply replaces exactly, focuses the caret at the end, and never sends", () => {
    expect(deriveAddToReplyIntent("Exact visitor-ready draft.")).toEqual({
      draft: "Exact visitor-ready draft.",
      draftMode: "replace",
      focusPublicComposer: true,
      caret: "end",
      send: false,
      keepSidechatOpen: true,
    });
  });
});

describe("Sidechat pane and read-only state", () => {
  test("uses the exact desktop, compact, and mobile breakpoints", () => {
    expect(deriveSidechatPaneMode(1536)).toBe("desktop");
    expect(deriveSidechatPaneMode(1535)).toBe("compact");
    expect(deriveSidechatPaneMode(768)).toBe("compact");
    expect(deriveSidechatPaneMode(767)).toBe("mobile");
  });

  test("keeps archived history readable but removes mutation affordances", () => {
    expect(deriveConversationInteractionState("2026-08-09T00:00:00Z")).toEqual({
      readOnly: true,
      showComposer: false,
      showMessageActions: false,
    });
    expect(deriveConversationInteractionState(null)).toEqual({
      readOnly: false,
      showComposer: true,
      showMessageActions: true,
    });
  });
});

describe("Sidechat status dots", () => {
  test("maps active statuses to one accessible 7px semantic dot", () => {
    expect(deriveSidechatStatusDot("working")).toEqual({
      sizeClass: "size-[7px]",
      colorClass: "bg-dot-blue",
      motionClass: "motion-safe:animate-pulse",
      title: "Sidechat working",
    });
    expect(deriveSidechatStatusDot("waiting_approval")).toEqual({
      sizeClass: "size-[7px]",
      colorClass: "bg-dot-orange",
      motionClass: "",
      title: "Sidechat waiting for approval",
    });
    expect(deriveSidechatStatusDot("ready")).toEqual({
      sizeClass: "size-[7px]",
      colorClass: "bg-dot-green",
      motionClass: "",
      title: "Sidechat reply ready",
    });
    expect(deriveSidechatStatusDot("failed")).toEqual({
      sizeClass: "size-[7px]",
      colorClass: "bg-destructive",
      motionClass: "",
      title: "Sidechat failed",
    });
  });

  test("does not render a dot for idle", () => {
    expect(deriveSidechatStatusDot("idle")).toBeNull();
  });
});
