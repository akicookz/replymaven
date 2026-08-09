import { describe, expect, test } from "bun:test";
import {
  buildSidechatEntryPlan,
  clearSidechatEphemeralRun,
  createInitialSidechatOrchestratorState,
  createOptimisticSidechatMessage,
  deriveAddToReplyIntent,
  deriveComposerShiftTabIntent,
  deriveConversationInteractionState,
  deriveMessageActions,
  deriveMessagePresentation,
  deriveSidechatPaneMode,
  deriveSidechatStatusDot,
  mergeSidechatHistoryMessages,
  reconcileSidechatMessages,
  reduceSidechatOrchestratorState,
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
        currentConversationId: "conversation-1",
        submittedConversationId: "conversation-1",
        accepted: false,
      }),
    ).toBe("Check the refund status");
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "Check the refund status",
        submittedDraft: "Check the refund status",
        currentConversationId: "conversation-1",
        submittedConversationId: "conversation-1",
        accepted: true,
      }),
    ).toBe("");
  });

  test("does not erase edits typed while the accepted request was pending", () => {
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "A newer public reply",
        submittedDraft: "Check the refund status",
        currentConversationId: "conversation-1",
        submittedConversationId: "conversation-1",
        accepted: true,
      }),
    ).toBe("A newer public reply");
  });

  test("does not clear an identical draft after the agent switches conversations", () => {
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "Same words",
        submittedDraft: "Same words",
        currentConversationId: "conversation-2",
        submittedConversationId: "conversation-1",
        accepted: true,
      }),
    ).toBe("Same words");
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

describe("Sidechat orchestrator state", () => {
  test("opens and closes the pane without cancelling an accepted run", () => {
    let state = createInitialSidechatOrchestratorState("conversation-1");
    state = reduceSidechatOrchestratorState(state, {
      type: "open",
      conversationId: "conversation-1",
    });
    state = reduceSidechatOrchestratorState(state, {
      type: "run_accepted",
      conversationId: "conversation-1",
      runId: "run-1",
    });
    state = reduceSidechatOrchestratorState(state, { type: "close" });

    expect(state).toEqual({
      isOpen: false,
      conversationId: "conversation-1",
      acceptedRunIds: { "conversation-1": "run-1" },
    });
  });

  test("switches an open pane to the selected conversation while the prior run continues", () => {
    let state = createInitialSidechatOrchestratorState("conversation-1");
    state = reduceSidechatOrchestratorState(state, {
      type: "open",
      conversationId: "conversation-1",
    });
    state = reduceSidechatOrchestratorState(state, {
      type: "run_accepted",
      conversationId: "conversation-1",
      runId: "run-1",
    });
    state = reduceSidechatOrchestratorState(state, {
      type: "select_conversation",
      conversationId: "conversation-2",
    });

    expect(state).toEqual({
      isOpen: true,
      conversationId: "conversation-2",
      acceptedRunIds: { "conversation-1": "run-1" },
    });
  });

  test("closes when the selected conversation is cleared", () => {
    let state = createInitialSidechatOrchestratorState("conversation-1");
    state = reduceSidechatOrchestratorState(state, {
      type: "open",
      conversationId: "conversation-1",
    });
    state = reduceSidechatOrchestratorState(state, {
      type: "select_conversation",
      conversationId: null,
    });

    expect(state).toEqual({
      isOpen: false,
      conversationId: null,
      acceptedRunIds: {},
    });
  });
});

describe("Sidechat entry planning", () => {
  test("opens an existing private thread without submitting another turn", () => {
    expect(
      buildSidechatEntryPlan({
        sidechatExists: true,
        publicDraft: "Do not duplicate this",
      }),
    ).toEqual({
      label: "Open sidechat",
      shouldSubmit: false,
      body: null,
      publicDraftSnapshot: null,
    });
  });

  test("starts with trimmed public text and retains the exact draft snapshot", () => {
    expect(
      buildSidechatEntryPlan({
        sidechatExists: false,
        publicDraft: "  Check the refund status  ",
      }),
    ).toEqual({
      label: "Start sidechat",
      shouldSubmit: true,
      body: { content: "Check the refund status" },
      publicDraftSnapshot: "  Check the refund status  ",
    });
  });

  test("omits content when starting empty so the server supplies the trusted default", () => {
    expect(
      buildSidechatEntryPlan({
        sidechatExists: false,
        publicDraft: " \n ",
      }),
    ).toEqual({
      label: "Start sidechat",
      shouldSubmit: true,
      body: {},
      publicDraftSnapshot: " \n ",
    });
  });

  test("preserves an in-flight public edit after the original draft is accepted", () => {
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "A newer public reply",
        submittedDraft: "  Check the refund status  ",
        currentConversationId: "conversation-1",
        submittedConversationId: "conversation-1",
        accepted: true,
      }),
    ).toBe("A newer public reply");
    expect(
      transitionPublicDraftAfterSidechatAccept({
        currentDraft: "  Check the refund status  ",
        submittedDraft: "  Check the refund status  ",
        currentConversationId: "conversation-1",
        submittedConversationId: "conversation-1",
        accepted: true,
      }),
    ).toBe("");
  });
});

describe("Sidechat optimistic and streaming reconciliation", () => {
  test("replaces the matching optimistic private message with the accepted row", () => {
    const optimistic = createOptimisticSidechatMessage({
      id: "optimistic-request-1",
      content: "Investigate order 42",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    const accepted = {
      id: "sidechat-message-1",
      role: "agent" as const,
      content: "Investigate order 42",
      channel: "sidechat" as const,
      kind: "text" as const,
      metadata: null,
      senderName: "Akbar",
      createdAt: "2026-08-09T00:00:00.100Z",
    };

    expect(reconcileSidechatMessages([optimistic], accepted)).toEqual([
      accepted,
    ]);
  });

  test("does not reconcile an accepted private row into another conversation cache", () => {
    const optimistic = createOptimisticSidechatMessage({
      id: "optimistic-request-1",
      content: "Conversation one",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    const otherConversationMessage = {
      id: "sidechat-message-2",
      role: "agent" as const,
      content: "Conversation two",
      channel: "sidechat" as const,
      kind: "text" as const,
      metadata: null,
      senderName: "Akbar",
      createdAt: "2026-08-09T00:00:00.100Z",
    };

    expect(
      reconcileSidechatMessages([optimistic], otherConversationMessage),
    ).toEqual([optimistic, otherConversationMessage]);
  });

  test("removes the completed run's delta and activity when a durable reply replaces it", () => {
    const store = new Map([
      [
        "run-1",
        {
          delta: "A partial private answer",
          activity: { label: "Search knowledge", phase: "finish" as const },
        },
      ],
      [
        "run-2",
        {
          delta: "Another conversation-safe run",
          activity: null,
        },
      ],
    ]);

    expect([
      ...clearSidechatEphemeralRun(store, "run-1").entries(),
    ]).toEqual([
      [
        "run-2",
        {
          delta: "Another conversation-safe run",
          activity: null,
        },
      ],
    ]);
  });

  test("merges older pages by the composite timestamp and id position", () => {
    const current = [
      {
        id: "message-c",
        role: "bot" as const,
        content: "Newest",
        createdAt: "2026-08-09T00:00:01.000Z",
      },
    ];
    const older = [
      {
        id: "message-a",
        role: "agent" as const,
        content: "Same millisecond, first id",
        createdAt: "2026-08-09T00:00:00.000Z",
      },
      {
        id: "message-b",
        role: "bot" as const,
        content: "Same millisecond, second id",
        createdAt: "2026-08-09T00:00:00.000Z",
      },
      current[0],
    ];

    expect(
      mergeSidechatHistoryMessages(current, older).map((message) => message.id),
    ).toEqual(["message-a", "message-b", "message-c"]);
  });
});

describe("composer keyboard intent", () => {
  const baseShortcut = {
    key: "Tab",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
  };

  test("starts real Sidechat from unmodified Shift+Tab even without text", () => {
    expect(
      deriveComposerShiftTabIntent({
        ...baseShortcut,
        contract: "public",
        hasDraft: false,
      }),
    ).toBe("start_sidechat");
  });

  test("ignores IME composition, repeats, modifiers, and other keys", () => {
    const ignored = [
      { isComposing: true },
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: false },
      { key: "Enter" },
    ];
    for (const override of ignored) {
      expect(
        deriveComposerShiftTabIntent({
          ...baseShortcut,
          contract: "public",
          hasDraft: false,
          ...override,
        }),
      ).toBeNull();
    }
    expect(
      deriveComposerShiftTabIntent({
        ...baseShortcut,
        contract: "sidechat",
        hasDraft: true,
      }),
    ).toBeNull();
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
