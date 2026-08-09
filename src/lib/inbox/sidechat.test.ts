import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
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
  deriveSidechatBusy,
  deriveSidechatStatusDot,
  markSidechatHistoryFetchSnapshot,
  mergeSidechatHistoryMessages,
  mergeSidechatHistorySnapshot,
  reconcileSidechatMessages,
  resolveSidechatStartAfterHistory,
  reduceSidechatOrchestratorState,
  transitionPublicDraftAfterSidechatAccept,
} from "./sidechat";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

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

  test("merges a live row delivered during a deferred history fetch at commit time", () => {
    const live = {
      id: "message-live",
      role: "bot" as const,
      content: "Delivered while GET was pending",
      createdAt: "2026-08-09T00:00:02.000Z",
    };
    const fetched = {
      id: "message-fetched",
      role: "agent" as const,
      content: "Fetched history",
      createdAt: "2026-08-09T00:00:01.000Z",
    };

    const committed = mergeSidechatHistorySnapshot(
      {
        messages: [live],
        hasMore: false,
        nextBefore: null,
        historyLoaded: false,
      },
      markSidechatHistoryFetchSnapshot({
        messages: [fetched],
        hasMore: true,
        nextBefore: "1000.message-fetched",
        historyLoaded: true,
      }, 1),
    );

    expect(committed.messages.map((message) => message.id)).toEqual([
      "message-fetched",
      "message-live",
    ]);
    expect(committed.hasMore).toBe(true);
    expect(committed.nextBefore).toBe("1000.message-fetched");
    expect(committed.historyLoaded).toBe(true);
  });

  test("preserves an already paginated cursor when latest history refetches", () => {
    const older = {
      id: "older",
      role: "agent" as const,
      content: "Older page",
      createdAt: "2026-08-08T00:00:00.000Z",
    };
    const latest = {
      id: "latest",
      role: "bot" as const,
      content: "Latest page",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const committed = mergeSidechatHistorySnapshot(
      {
        messages: [older, latest],
        hasMore: true,
        nextBefore: "500.older",
        historyLoaded: true,
      },
      markSidechatHistoryFetchSnapshot({
        messages: [latest],
        hasMore: false,
        nextBefore: null,
        historyLoaded: true,
      }, 2),
    );
    expect(committed.messages.map((message) => message.id)).toEqual([
      "older",
      "latest",
    ]);
    expect(committed.nextBefore).toBe("500.older");
    expect(committed.hasMore).toBe(true);
  });

  test("uses the fetched cursor to fill a non-overlapping cache gap", () => {
    const cached = {
      id: "cached-old-window",
      role: "agent" as const,
      content: "Old cached window",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const fetched = {
      id: "fetched-latest-window",
      role: "bot" as const,
      content: "Latest fetched window",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const committed = mergeSidechatHistorySnapshot(
      {
        messages: [cached],
        hasMore: false,
        nextBefore: null,
        historyLoaded: true,
      },
      markSidechatHistoryFetchSnapshot({
        messages: [fetched],
        hasMore: true,
        nextBefore: "8000.fetched-latest-window",
        historyLoaded: true,
      }, 3),
    );
    expect(committed.nextBefore).toBe("8000.fetched-latest-window");
    expect(committed.hasMore).toBe(true);
  });
});

describe("Sidechat QueryClient cache provenance", () => {
  type CacheMessage = {
    id: string;
    role: "visitor" | "bot" | "agent";
    content: string;
    createdAt: string;
    _optimistic?: boolean;
  };
  type CacheSnapshot = {
    messages: CacheMessage[];
    hasMore: boolean;
    nextBefore: string | null;
    historyLoaded: boolean;
  };
  const queryKey = ["sidechat", "project-1", "conversation-1"] as const;

  function createClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  }

  function structuralSharing(
    current: unknown,
    incoming: unknown,
  ): unknown {
    return mergeSidechatHistorySnapshot(
      current as CacheSnapshot | undefined,
      incoming as CacheSnapshot,
    );
  }

  test("a live durable row arriving during fetch survives the server snapshot commit", async () => {
    const queryClient = createClient();
    const deferred = createDeferred<CacheSnapshot & {
      __sidechatHistoryFetch: { generation: number };
    }>();
    const pending = queryClient.fetchQuery<CacheSnapshot>({
      queryKey,
      queryFn: () => deferred.promise,
      structuralSharing,
    });
    queryClient.setQueryData<CacheSnapshot>(queryKey, {
      messages: [{
        id: "live",
        role: "bot",
        content: "Live",
        createdAt: "2026-08-09T00:00:02.000Z",
      }],
      hasMore: false,
      nextBefore: null,
      historyLoaded: false,
    });

    deferred.resolve(markSidechatHistoryFetchSnapshot({
      messages: [{
        id: "fetched",
        role: "agent",
        content: "Fetched",
        createdAt: "2026-08-09T00:00:01.000Z",
      }],
      hasMore: true,
      nextBefore: "1000.fetched",
      historyLoaded: true,
    }, 4));
    await pending;

    expect(
      queryClient.getQueryData<CacheSnapshot>(queryKey)?.messages.map(
        (message) => message.id,
      ),
    ).toEqual(["fetched", "live"]);
  });

  test("a durable accepted row replaces its optimistic row without structural sharing restoring it", () => {
    const queryClient = createClient();
    queryClient.setQueryDefaults(queryKey, { structuralSharing });
    const optimistic: CacheMessage = {
      id: "optimistic-request",
      role: "agent",
      content: "Investigate",
      createdAt: "2026-08-09T00:00:00.000Z",
      _optimistic: true,
    };
    queryClient.setQueryData<CacheSnapshot>(queryKey, {
      messages: [optimistic],
      hasMore: false,
      nextBefore: null,
      historyLoaded: true,
    });
    queryClient.setQueryData<CacheSnapshot>(queryKey, (current) => ({
      ...current!,
      messages: reconcileSidechatMessages(current!.messages, {
        id: "durable-request",
        role: "agent",
        content: "Investigate",
        createdAt: "2026-08-09T00:00:00.100Z",
      }),
    }));

    expect(
      queryClient.getQueryData<CacheSnapshot>(queryKey)?.messages.map(
        (message) => message.id,
      ),
    ).toEqual(["durable-request"]);
  });

  test("a failed optimistic row is removed and stays removed", () => {
    const queryClient = createClient();
    queryClient.setQueryDefaults(queryKey, { structuralSharing });
    queryClient.setQueryData<CacheSnapshot>(queryKey, {
      messages: [{
        id: "optimistic-failed",
        role: "agent",
        content: "Will fail",
        createdAt: "2026-08-09T00:00:00.000Z",
        _optimistic: true,
      }],
      hasMore: false,
      nextBefore: null,
      historyLoaded: true,
    });
    queryClient.setQueryData<CacheSnapshot>(queryKey, (current) => ({
      ...current!,
      messages: current!.messages.filter(
        (message) => message.id !== "optimistic-failed",
      ),
    }));

    expect(queryClient.getQueryData<CacheSnapshot>(queryKey)?.messages).toEqual(
      [],
    );
  });

  test("a pagination merge authoritatively advances its cursor", () => {
    const queryClient = createClient();
    queryClient.setQueryDefaults(queryKey, { structuralSharing });
    queryClient.setQueryData<CacheSnapshot>(queryKey, {
      messages: [{
        id: "latest",
        role: "bot",
        content: "Latest",
        createdAt: "2026-08-09T00:00:00.000Z",
      }],
      hasMore: true,
      nextBefore: "9000.latest",
      historyLoaded: true,
    });
    queryClient.setQueryData<CacheSnapshot>(queryKey, (current) => ({
      messages: mergeSidechatHistoryMessages(current!.messages, [{
        id: "older",
        role: "agent",
        content: "Older",
        createdAt: "2026-08-08T00:00:00.000Z",
      }]),
      hasMore: false,
      nextBefore: null,
      historyLoaded: true,
    }));

    expect(queryClient.getQueryData<CacheSnapshot>(queryKey)).toEqual({
      messages: [
        {
          id: "older",
          role: "agent",
          content: "Older",
          createdAt: "2026-08-08T00:00:00.000Z",
        },
        {
          id: "latest",
          role: "bot",
          content: "Latest",
          createdAt: "2026-08-09T00:00:00.000Z",
        },
      ],
      hasMore: false,
      nextBefore: null,
      historyLoaded: true,
    });
  });

  test("fetch merging de-duplicates IDs and preserves composite ordering", async () => {
    const queryClient = createClient();
    const duplicate: CacheMessage = {
      id: "same",
      role: "bot",
      content: "Live version",
      createdAt: "2026-08-09T00:00:01.000Z",
    };
    queryClient.setQueryData<CacheSnapshot>(queryKey, {
      messages: [duplicate, {
        id: "z-live",
        role: "bot",
        content: "Later",
        createdAt: "2026-08-09T00:00:02.000Z",
      }],
      hasMore: false,
      nextBefore: null,
      historyLoaded: true,
    });
    await queryClient.fetchQuery<CacheSnapshot>({
      queryKey,
      queryFn: async () => markSidechatHistoryFetchSnapshot({
        messages: [{
          ...duplicate,
          content: "Stale fetch version",
        }, {
          id: "a-fetched",
          role: "agent",
          content: "Earlier",
          createdAt: "2026-08-09T00:00:00.000Z",
        }],
        hasMore: true,
        nextBefore: "1000.a-fetched",
        historyLoaded: true,
      }, 5),
      structuralSharing,
      staleTime: 0,
    });

    expect(queryClient.getQueryData<CacheSnapshot>(queryKey)?.messages).toEqual([
      {
        id: "a-fetched",
        role: "agent",
        content: "Earlier",
        createdAt: "2026-08-09T00:00:00.000Z",
      },
      duplicate,
      {
        id: "z-live",
        role: "bot",
        content: "Later",
        createdAt: "2026-08-09T00:00:02.000Z",
      },
    ]);
  });
});

describe("Sidechat start history gate", () => {
  test("waits for the open pane's fetch before deciding to submit", () => {
    expect(resolveSidechatStartAfterHistory(false, 0)).toBe("wait");
  });

  test("opens fetched existing history and submits only a fetched empty thread", () => {
    expect(resolveSidechatStartAfterHistory(true, 1)).toBe("open_existing");
    expect(resolveSidechatStartAfterHistory(true, 0)).toBe("submit");
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
  test("treats a pending retry as busy", () => {
    expect(deriveSidechatBusy("failed", false, true)).toBe(true);
    expect(deriveSidechatBusy("idle", false, false)).toBe(false);
  });
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
