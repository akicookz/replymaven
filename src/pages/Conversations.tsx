import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CustomerDetail,
  CustomerListItem,
  ConversationCustomerResponse,
} from "../../shared/customer-types";
import type {
  MavenProjectState,
  MavenProjectEvent,
  SidechatSessionResponse,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import type {
  PublicChatChildState,
  PublicChatSessionResponse,
} from "../../shared/public-chat-agent";
import type { SafeSidechatDataPart } from "@/lib/inbox/sidechat-message-adapter";
import { cn } from "@/lib/utils";
import { serializeMessageImageUrls } from "../../shared/message-images";
import { passesInboxFilter, type InboxFilter, type InboxSort } from "@/lib/inbox/filters";
import {
  moveRangeSelection,
  selectInclusiveRange,
  toggleSelection,
} from "@/lib/inbox/selection";
import {
  executeBulkConversationAction,
  type BulkConversationExecutionResult,
  type BulkConversationResult,
} from "@/lib/inbox/bulk-actions";
import type {
  BulkConversationAction,
  Conversation,
  Message,
  InboxCounts,
} from "@/lib/inbox/types";
import {
  deriveAddToReplyIntent,
  mergeSidechatSummaryStatuses,
  planSidechatEntry,
  type SidechatPresentationStatus,
} from "@/lib/inbox/sidechat";
import {
  planInitialSidechatSubmission,
  planFailedSidechatRetry,
  reduceAcceptedSidechatTransfer,
  deriveNativeSidechatUiStatus,
  isSidechatSessionUsable,
  useSidechatAgent,
  useSidechatSession,
  useSidechatSummarySession,
  type PendingSidechatTransfer,
} from "@/hooks/use-sidechat-agent";
import {
  summaryToDashboardConversation,
  useConversationDirectoryAgent,
} from "@/hooks/use-conversation-directory-agent";
import {
  usePublicChatAgent,
  usePublicChatSession,
} from "@/hooks/use-public-chat-agent";
import { reconcilePublicMessages } from "@/lib/inbox/public-message-adapter";
import MessageList from "@/components/inbox/MessageList";
import ReadingPane from "@/components/inbox/ReadingPane";
import FocusView from "@/components/inbox/FocusView";
import FocusSidechatLayout from "@/components/inbox/FocusSidechatLayout";
import SidechatPane from "@/components/inbox/SidechatPane";
import CustomerFormDialog from "@/components/customers/CustomerFormDialog";
import CustomerPickerDialog from "@/components/customers/CustomerPickerDialog";
import {
  applyConversationCustomerResult,
  customerKeys,
  fetchCustomer,
  invalidateCustomerProjectQueries,
  setConversationCustomer,
} from "@/lib/customers";

// ─── Wire shapes (orchestrator-local) ──────────────────────────────────────────

interface ConversationsPage {
  conversations: Conversation[];
  counts: InboxCounts;
  hasMore: boolean;
  serverTime?: number;
  nextCursor?: string | null;
}

interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  hasMore: boolean;
  botName: string | null;
  agentName: string | null;
}

interface BulkConversationMutationInput {
  conversationIds: string[];
  action: BulkConversationAction;
}

interface ConversationDirectoryAgentBridgeProps {
  session: SidechatSummarySessionResponse;
  onState: (state: MavenProjectState | undefined) => void;
  onEvent: (event: MavenProjectEvent) => void;
}

function ConversationDirectoryAgentBridge({
  session,
  onState,
  onEvent,
}: ConversationDirectoryAgentBridgeProps) {
  const agent = useConversationDirectoryAgent({ session, onEvent });
  useEffect(() => onState(agent.state), [agent.state, onState]);
  useEffect(() => {
    if (agent.state?.conversation) {
      onEvent({
        type: "conversation-summary",
        summary: agent.state.conversation,
      });
    }
    if (agent.state?.inboxCounts) {
      onEvent({ type: "inbox-counts", counts: agent.state.inboxCounts });
    }
  }, [agent.state, onEvent]);
  return null;
}

interface NativePublicConversationBridgeProps {
  session: PublicChatSessionResponse;
  conversationId: string;
  onMessages: (conversationId: string, messages: Message[]) => void;
  onState: (
    conversationId: string,
    state: PublicChatChildState | undefined,
  ) => void;
}

function NativePublicConversationBridge({
  session,
  conversationId,
  onMessages,
  onState,
}: NativePublicConversationBridgeProps) {
  const chat = usePublicChatAgent({ session, conversationId });
  useEffect(() => {
    onMessages(conversationId, chat.messages);
  }, [chat.messages, conversationId, onMessages]);
  useEffect(() => {
    onState(conversationId, chat.state);
  }, [chat.state, conversationId, onState]);
  return null;
}

interface NativeSidechatPaneProps {
  open: boolean;
  conversation: Conversation;
  customerFirstName: string | null;
  session: SidechatSessionResponse;
  transfer: PendingSidechatTransfer | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSubmissionStarted: (messageId: string) => void;
  onInitialSubmissionSkipped: (messageId: string) => void;
  onTurnAccepted: (messageId: string) => void;
  onAddToReply: (draft: string) => void;
  onClose: () => void;
}

function NativeSidechatPane({
  open,
  conversation,
  customerFirstName,
  session,
  transfer,
  draft,
  setDraft,
  onSubmissionStarted,
  onInitialSubmissionSkipped,
  onTurnAccepted,
  onAddToReply,
  onClose,
}: NativeSidechatPaneProps) {
  const attemptedMessageIds = useRef(new Set<string>());
  const [safeActivity, setSafeActivity] = useState<Extract<
    SafeSidechatDataPart,
    { type: "safe-activity" }
  > | null>(null);
  const sidechat = useSidechatAgent({
    session,
    conversationId: conversation.id,
    onTurnAccepted,
    onSafeActivity(activity) {
      setSafeActivity((current) => activity.status === "started"
        ? {
            ...activity,
            ...(activity.tool || !current?.tool
              ? {}
              : { tool: current.tool }),
          }
        : null);
    },
  });
  const trustedDefault = customerFirstName
    ? `Help me respond to ${customerFirstName}.`
    : "Help me respond to this conversation.";
  const sendSidechatMessage = sidechat.send;

  useEffect(() => {
    if (
      !transfer ||
      transfer.conversationId !== conversation.id ||
      transfer.submitted ||
      attemptedMessageIds.current.has(transfer.messageId)
    ) {
      return;
    }
    const submission = planInitialSidechatSubmission({
      session,
      messageId: transfer.messageId,
      publicTextSnapshot: transfer.textSnapshot,
      trustedDefault,
    });
    if (!submission) {
      onInitialSubmissionSkipped(transfer.messageId);
      return;
    }
    attemptedMessageIds.current.add(submission.messageId);
    onSubmissionStarted(submission.messageId);
    void sendSidechatMessage(submission.text, submission.messageId).catch(() => {
      // useAgentChat exposes the sanitized failure through `error`; the
      // captured public draft remains until the matching acceptance arrives.
    });
  }, [
    conversation.id,
    onInitialSubmissionSkipped,
    onSubmissionStarted,
    session,
    sendSidechatMessage,
    transfer,
    trustedDefault,
  ]);

  const hasApproval = sidechat.messages.some(
    (message) =>
      message.presentationAction?.type === "approval" ||
      message.sidechatTrace?.some(
        (item) =>
          item.type === "tool" && item.state === "approval-requested",
      ) === true,
  );
  const hasReplyDraft = sidechat.messages.some(
    (message) => message.presentationAction?.type === "add_to_reply",
  );
  const sidechatUiStatus = deriveNativeSidechatUiStatus({
    status: sidechat.status,
    isServerStreaming: sidechat.isServerStreaming,
    isRecovering: sidechat.isRecovering,
  });
  const presentationStatus: SidechatPresentationStatus =
    sidechatUiStatus === "error"
      ? "failed"
      : sidechatUiStatus === "streaming"
        ? "working"
        : hasApproval
          ? "waiting_approval"
          : hasReplyDraft
            ? "ready"
            : "idle";

  return (
    <SidechatPane
      open={open}
      conversation={conversation}
      customerFirstName={customerFirstName}
      messages={sidechat.messages}
      draft={draft}
      setDraft={setDraft}
      onAddToReply={onAddToReply}
      onClose={onClose}
      status={sidechatUiStatus}
      presentationStatus={presentationStatus}
      error={sidechat.error}
      safeActivity={safeActivity}
      onSend={(text) => {
        setSafeActivity(null);
        void sidechat.send(text).catch(() => undefined);
      }}
      onStop={() => {
        void sidechat.stop();
      }}
      onRetry={() => {
        setSafeActivity(null);
        const retryPlan = planFailedSidechatRetry({
          transfer,
          persistedMessageIds: new Set(
            sidechat.nativeMessages.map((message) => message.id),
          ),
          trustedDefault,
        });
        if (retryPlan.kind === "resubmit") {
          void sidechat.send(retryPlan.text, retryPlan.messageId).catch(
            () => undefined,
          );
          return;
        }
        if (retryPlan.acceptedMessageId) {
          onTurnAccepted(retryPlan.acceptedMessageId);
        }
        void sidechat.retry().catch(() => undefined);
      }}
      onApproval={(approvalId, toolCallId, mode) => {
        void sidechat.approve(approvalId, toolCallId, mode).catch(
          () => setSafeActivity(null),
        );
      }}
    />
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: InboxCounts = {
  "needs-you": 0,
  all: 0,
  snoozed: 0,
  resolved: 0,
  archived: 0,
  flagged: 0,
};

function getActivityMs(convo: Conversation): number {
  const raw = convo.lastActivityAt ?? convo.updatedAt;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function optionalPublicStateIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

// Priority sort rank (absent priority defaults to medium, matching the schema).
function priorityRank(convo: Conversation): number {
  switch (convo.priority) {
    case "high":
      return 3;
    case "low":
      return 1;
    default:
      return 2;
  }
}

function patchConversationForBulkAction(
  conversation: Conversation,
  action: BulkConversationAction,
  actionAt: string,
): Conversation {
  switch (action.action) {
    case "archive":
      return { ...conversation, archivedAt: actionAt, updatedAt: actionAt };
    case "unarchive":
      return { ...conversation, archivedAt: null, updatedAt: actionAt };
    case "resolve":
      return {
        ...conversation,
        status: "closed",
        closeReason: "resolved",
        updatedAt: actionAt,
      };
    case "snooze":
      return {
        ...conversation,
        snoozedUntil: action.until ? new Date(action.until).toISOString() : null,
        updatedAt: actionAt,
      };
    case "assign":
      return { ...conversation, assigneeId: action.assigneeId, updatedAt: actionAt };
    case "priority":
      return { ...conversation, priority: action.priority, updatedAt: actionAt };
    case "flag_spam":
      return {
        ...conversation,
        status: "closed",
        closeReason: "spam",
        updatedAt: actionAt,
      };
  }
}

// Per-project localStorage key for the client-side "read" overlay. There is no
// server read-state on conversations (unread is the lastMessage===visitor
// heuristic), so "mark all as read" is stored locally as a per-conversation
// watermark (read iff the conversation's last activity is at/under the mark).
const readKey = (projectId: string) => `inbox-read:${projectId}`;

// ─── Component ────────────────────────────────────────────────────────────────

function Conversations() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Active inbox filter is owned by the URL (the sidebar deep-links to
  // `?filter=<id>`); default to "needs-you" when absent.
  const filter = (searchParams.get("filter") as InboxFilter) ?? "needs-you";

  const [selectedConvo, setSelectedConvo] = useState<string | null>(
    searchParams.get("id"),
  );
  const [draft, setDraft] = useState("");
  const [publicComposerFocusRequest, setPublicComposerFocusRequest] = useState(0);
  const [focusPublicComposerAfterClose, setFocusPublicComposerAfterClose] =
    useState(false);
  const [sidechatOpen, setSidechatOpen] = useState(false);
  const [sidechatDrafts, setSidechatDrafts] = useState<Record<string, string>>(
    {},
  );
  const [pendingSidechatTransfer, setPendingSidechatTransfer] =
    useState<PendingSidechatTransfer | null>(null);
  const [liveSidechatState, setLiveSidechatState] =
    useState<MavenProjectState | undefined>();
  const sidechatSummarySession = useSidechatSummarySession(projectId);
  const view = searchParams.get("focus") === "true" ? "focus" : "split";
  const setView = useCallback(
    (nextView: "split" | "focus") => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextView === "focus") next.set("focus", "true");
          else next.delete("focus");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const handleSidechatParentState = useCallback(
    (state: MavenProjectState | undefined) => {
      setLiveSidechatState(state);
    },
    [],
  );

  useEffect(() => {
    setLiveSidechatState(undefined);
  }, [projectId]);

  useEffect(() => {
    if (sidechatOpen || !focusPublicComposerAfterClose) return;
    setFocusPublicComposerAfterClose(false);
    setPublicComposerFocusRequest((request) => request + 1);
  }, [focusPublicComposerAfterClose, sidechatOpen]);
  // List sort order + "unread only" filter, surfaced by the list's sort/filter
  // control. Both apply client-side over the loaded page.
  const [sort, setSort] = useState<InboxSort>("newest");
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Client-side read overlay (see readKey): convId -> activity ms marked read.
  const [readMarks, setReadMarks] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectionFocusId, setSelectionFocusId] = useState<string | null>(null);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [linkCustomerOpen, setLinkCustomerOpen] = useState(false);

  // Sync selectedConvo <-> ?id= URL param so deep links work and shares are
  // stable. Other params (e.g. ?filter=) are preserved.
  useEffect(() => {
    const current = searchParams.get("id");
    if (selectedConvo && current !== selectedConvo) {
      const next = new URLSearchParams(searchParams);
      next.set("id", selectedConvo);
      setSearchParams(next, { replace: true });
    } else if (!selectedConvo && current) {
      const next = new URLSearchParams(searchParams);
      next.delete("id");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvo]);

  // One-shot deep-link target from ?msg= (Telegram/email/ping links). Cleared
  // from the URL immediately so refreshes don't re-pulse. highlightConvRef
  // snapshots the ?id= this ?msg= targeted so the clear effect below only fires
  // when the agent navigates AWAY from that conversation — a naive unconditional
  // clear on [selectedConvo] would also run on mount and wipe the highlight
  // before the target ever rendered.
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const highlightConvRef = useRef<string | null>(searchParams.get("id"));

  // URL → state adoption. React Router keeps this route element MOUNTED across
  // same-route navigations (sidebar filters, dashboard rows, the ping toast's
  // "View"), so a navigate() that changes ?id=/?msg= only mutates searchParams
  // — it does NOT re-run the useState initializers. This effect is what turns
  // those in-place navigations into an actual selection + ?msg= consumption,
  // and it also covers the very first mount (fresh deep link) so both paths run
  // through one code path. It converges with the state→URL sync effect above:
  // once we adopt ?id= into selectedConvo, that effect sees the URL already
  // matches and no-ops; once ?msg= is stripped this effect re-runs to a no-op —
  // no loop. Keyed on searchParams ONLY (not selectedConvo) so a plain row
  // click isn't reverted by a stale URL id before the sync effect catches up.
  useEffect(() => {
    const urlId = searchParams.get("id");
    const urlMsg = searchParams.get("msg");
    if (urlId && urlId !== selectedConvo) setSelectedConvo(urlId);
    if (urlMsg) {
      setHighlightMsgId(urlMsg);
      // Anchor the highlight to the conversation the URL targeted so the
      // clear-on-switch effect only fires when the agent navigates AWAY.
      highlightConvRef.current = urlId;
      const next = new URLSearchParams(searchParams);
      next.delete("msg");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (selectedConvo !== highlightConvRef.current) setHighlightMsgId(null);
  }, [selectedConvo]);

  // ── Search & pagination state ──────────────────────────────────────────
  // searchQuery is the raw input value (controlled); debouncedSearch is what
  // the query key and fetch URL use, updated after a 300ms idle window.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // listLimit grows by 25 on each "Load more" click. We keep a flat response
  // shape (not useInfiniteQuery) so the /updates patch logic stays unchanged.
  const [listLimit, setListLimit] = useState(25);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setSelectionFocusId(null);
  }, [projectId, filter, searchQuery, sort, unreadOnly]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset the pagination window when the filter or search changes — otherwise a
  // prior "load more" (e.g. limit=50) would over-fetch against the new context
  // and start the window artificially high.
  useEffect(() => {
    setListLimit(25);
    // Drop the old rows immediately so the list shows skeletons (not the prior
    // filter's rows, nor a premature "No conversations") until fresh data lands.
    setLoadedConversations([]);
  }, [filter, debouncedSearch]);

  // Switching inbox filters (sidebar links to ?filter=<id>) keeps this page
  // mounted. Clear the selection whenever the filter changes and drop back to
  // split view unless the new URL explicitly requests focus mode. The mount run
  // is skipped via the ref so deep links (?filter=…&id=…) still open.
  //
  // But a filter change can arrive TOGETHER with an explicit selection: the ping
  // toast and dashboard rows navigate to `?filter=…&id=…` in one shot. Bail out
  // when the incoming URL carries an ?id= so we don't clear the very
  // conversation the adoption effect is about to open; a bare filter change
  // (sidebar click, no id) still resets to a clean split view.
  const prevFilterRef = useRef(filter);
  useEffect(() => {
    if (prevFilterRef.current === filter) return;
    prevFilterRef.current = filter;
    if (searchParams.get("id")) return;
    setSelectedConvo(null);
    if (searchParams.get("focus") !== "true") setView("split");
  }, [filter, searchParams, setView]);

  // Load the per-project read overlay from localStorage (writes happen in
  // handleMarkAllRead so the initial empty state can't clobber a stored value).
  useEffect(() => {
    if (!projectId) return;
    try {
      const raw = localStorage.getItem(readKey(projectId));
      setReadMarks(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      setReadMarks({});
    }
  }, [projectId]);

  const [loadedConversations, setLoadedConversations] = useState<Conversation[]>(
    [],
  );
  // ── List query (drives the conversation column) ──────────────────────────
  const {
    data: convosPage,
    isPending: convosLoading,
    isPlaceholderData,
  } = useQuery<ConversationsPage>({
    queryKey: ["conversations", projectId, filter, debouncedSearch, listLimit],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "all",
        limit: listLimit.toString(),
        offset: "0",
        filter,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(
        `/api/projects/${projectId}/conversations?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  // Sync the fetched first page into the live list and seed the sidebar's
  // inbox-counts cache so its badges stay consistent with this view.
  useEffect(() => {
    // Only adopt FRESH data for the active filter — ignore keepPreviousData
    // placeholders, so a filter switch shows skeletons (over the cleared list)
    // rather than briefly re-displaying the previous filter's rows.
    if (!convosPage || isPlaceholderData) return;
    setLoadedConversations(convosPage.conversations);
    if (projectId) {
      queryClient.setQueryData(["inbox-counts", projectId], convosPage.counts);
    }
  }, [convosPage, isPlaceholderData, projectId, queryClient]);

  // ── Detail query (drives the reading pane / focus thread) ────────────────
  const { data: convoDetail, isLoading: detailLoading } = useQuery<ConversationDetail>({
    queryKey: ["conversation-detail", selectedConvo],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}`,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          body || `Failed to load conversation (status ${res.status})`,
        );
      }
      return res.json();
    },
    enabled: !!selectedConvo,
    retry: 1,
    // Detail is kept fresh in real time by the Agent session; cache 60s so
    // revisiting a conversation is instant.
    staleTime: 1000 * 60,
    structuralSharing: true,
  });

  const publicChatSession = usePublicChatSession({
    projectId,
    conversationId: selectedConvo,
    enabled: Boolean(selectedConvo),
  });

  const handleDirectoryEvent = useCallback((event: MavenProjectEvent) => {
    if (!projectId) return;
    if (event.type === "inbox-counts") {
      queryClient.setQueryData(["inbox-counts", projectId], event.counts);
      queryClient.setQueryData<ConversationsPage | undefined>(
        ["conversations", projectId, filter, debouncedSearch, listLimit],
        (old) => old ? { ...old, counts: event.counts } : old,
      );
      return;
    }
    if (event.type === "customer-updated") {
      void invalidateCustomerProjectQueries(queryClient, projectId);
      return;
    }
    const incoming = summaryToDashboardConversation(event.summary);
    const search = debouncedSearch.trim().toLowerCase();
    const matchesSearch = !search ||
      incoming.visitorName?.toLowerCase().includes(search) === true ||
      incoming.visitorEmail?.toLowerCase().includes(search) === true;
    const matches = matchesSearch && passesInboxFilter(
      filter,
      incoming,
      Date.now(),
    );
    function patchList(current: Conversation[]): Conversation[] {
      const without = current.filter((conversation) =>
        conversation.id !== incoming.id
      );
      if (matches) without.push(incoming);
      without.sort((left, right) => getActivityMs(right) - getActivityMs(left));
      return without.slice(0, listLimit);
    }
    setLoadedConversations(patchList);
    queryClient.setQueryData<ConversationsPage | undefined>(
      ["conversations", projectId, filter, debouncedSearch, listLimit],
      (old) => old
        ? { ...old, conversations: patchList(old.conversations) }
        : old,
    );
    queryClient.setQueryData<ConversationDetail | undefined>(
      ["conversation-detail", incoming.id],
      (old) => old
        ? {
            ...old,
            conversation: { ...old.conversation, ...incoming },
          }
        : old,
    );
  }, [
    debouncedSearch,
    filter,
    listLimit,
    projectId,
    queryClient,
  ]);

  const handleNativePublicMessages = useCallback((
    conversationId: string,
    messages: Message[],
  ) => {
    queryClient.setQueryData<ConversationDetail | undefined>(
      ["conversation-detail", conversationId],
      (old) => old
        ? {
            ...old,
            messages: reconcilePublicMessages(messages, old.messages),
          }
        : old,
    );
  }, [queryClient]);

  const handleNativePublicState = useCallback((
    conversationId: string,
    state: PublicChatChildState | undefined,
  ) => {
    if (!state) return;
    queryClient.setQueryData<ConversationDetail | undefined>(
      ["conversation-detail", conversationId],
      (old) => old
        ? {
            ...old,
            conversation: {
              ...old.conversation,
              status: state.status,
              visitorPresence: state.visitorPresence,
              visitorLastOnlineAt: optionalPublicStateIso(
                state.visitorLastOnlineAt,
              ),
              archivedAt: state.archived
                ? old.conversation.archivedAt ?? new Date().toISOString()
                : null,
            },
          }
        : old,
    );
  }, [queryClient]);

  // Reset the composer draft when switching conversations.
  useEffect(() => {
    setDraft("");
  }, [selectedConvo]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async ({
      content,
      imageUrls,
      asEmail,
      idempotencyKey,
    }: {
      content: string;
      imageUrls?: string[];
      asEmail?: boolean;
      idempotencyKey: string;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ content, imageUrls: imageUrls ?? [] }),
        },
      );
      if (!res.ok) throw new Error("Failed to send reply");
      const data = (await res.json()) as { id: string };
      // After a successful send, optionally email the message to the visitor.
      if (asEmail && data.id) {
        try {
          const emailRes = await fetch(
            `/api/projects/${projectId}/conversations/${selectedConvo}/send-email`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messageId: data.id }),
            },
          );
          if (emailRes.ok) {
            toast.success("Emailed to visitor");
          } else {
            toast.error("Message sent but email delivery failed");
          }
        } catch {
          toast.error("Message sent but email delivery failed");
        }
      }
      return data;
    },
    onMutate: async ({ content, imageUrls, idempotencyKey }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      const previous = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        selectedConvo,
      ]);
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", selectedConvo],
        (old) => {
          if (!old) return old;
          // _optimistic lets the WS hook swap this row for the server's copy
          // (message:new) instead of appending a duplicate.
          const optimistic = {
            id: idempotencyKey,
            role: "agent",
            content,
            imageUrl: serializeMessageImageUrls(imageUrls ?? []),
            createdAt: new Date().toISOString(),
            senderName: null,
            emailedAt: null,
            deliveredAt: null,
            readAt: null,
            _optimistic: true,
          } as Message;
          return {
            ...old,
            conversation: { ...old.conversation, status: "agent_replied" },
            messages: [...old.messages, optimistic],
          };
        },
      );
      setDraft("");
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          ["conversation-detail", selectedConvo],
          ctx.previous,
        );
      }
      toast.error(err.message || "Failed to send reply");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const closeConversation = useMutation({
    mutationFn: async ({
      convId,
      closeReason,
    }: {
      convId: string;
      closeReason: "resolved" | "ended" | "spam";
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closeReason }),
        },
      );
      if (!res.ok) throw new Error("Failed to close conversation");
      return res.json();
    },
    onMutate: async ({ convId, closeReason }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", convId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        convId,
      ]);
      // Snapshot the local list too — onMutate patches it optimistically, so a
      // failed close must restore it (not just the detail) to avoid a flash of
      // a wrongly-closed row until onSettled's refetch corrects it.
      const previousList = loadedConversations;
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? {
                ...old,
                conversation: { ...old.conversation, status: "closed", closeReason },
              }
            : old,
      );
      setLoadedConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, status: "closed", closeReason } : c,
        ),
      );
      return { previousDetail, previousList };
    },
    onError: (_err, { convId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", convId],
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList) {
        setLoadedConversations(ctx.previousList);
      }
      toast.error("Failed to close conversation");
    },
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  // Toggle-off for Resolve / Flag-as-spam: bring a closed conversation back to
  // active (status "active", closeReason cleared). Mirrors closeConversation's
  // optimistic patch of both the detail cache and the local list.
  const reopenConversation = useMutation({
    mutationFn: async ({ convId }: { convId: string }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/reopen`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to reopen conversation");
      return res.json();
    },
    onMutate: async ({ convId }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", convId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        convId,
      ]);
      const previousList = loadedConversations;
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? {
                ...old,
                conversation: {
                  ...old.conversation,
                  status: "active",
                  closeReason: null,
                },
              }
            : old,
      );
      setLoadedConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, status: "active", closeReason: null } : c,
        ),
      );
      return { previousDetail, previousList };
    },
    onError: (_err, { convId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", convId],
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList) setLoadedConversations(ctx.previousList);
      toast.error("Failed to reopen conversation");
    },
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  const snoozeConversation = useMutation({
    mutationFn: async ({
      convId,
      until,
    }: {
      convId: string;
      until: number | null;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/snooze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ until }),
        },
      );
      if (!res.ok) throw new Error("Failed to snooze conversation");
      return res.json();
    },
    onError: () => toast.error("Failed to snooze conversation"),
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  const setPriorityMutation = useMutation({
    mutationFn: async ({
      convId,
      priority,
    }: {
      convId: string;
      priority: "low" | "medium" | "high";
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/priority`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority }),
        },
      );
      if (!res.ok) throw new Error("Failed to set priority");
      return res.json();
    },
    onError: () => toast.error("Failed to set priority"),
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
    },
  });

  const assignConversation = useMutation({
    mutationFn: async ({
      convId,
      assigneeId,
    }: {
      convId: string;
      assigneeId: string | null;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/assign`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeId }),
        },
      );
      if (!res.ok) throw new Error("Failed to assign conversation");
      return res.json();
    },
    onMutate: async ({ convId, assigneeId }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", convId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        convId,
      ]);
      const previousList = loadedConversations;
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? { ...old, conversation: { ...old.conversation, assigneeId } }
            : old,
      );
      setLoadedConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, assigneeId } : c)),
      );
      return { previousDetail, previousList };
    },
    onError: (_err, { convId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", convId],
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList) setLoadedConversations(ctx.previousList);
      toast.error("Failed to assign conversation");
    },
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
    },
  });

  const blockVisitor = useMutation({
    mutationFn: async ({
      visitorId,
      visitorEmail,
      conversationId,
    }: {
      visitorId: string;
      visitorEmail?: string;
      conversationId: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/visitors/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, visitorEmail, conversationId }),
      });
      if (!res.ok) throw new Error("Failed to block visitor");
      return res.json();
    },
    // Optimistically light up the Block icon (visitorBlocked lives on the detail
    // cache, populated by the detail endpoint) and mark the row closed-as-spam,
    // mirroring what the ban endpoint does server-side.
    onMutate: async ({ conversationId }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", conversationId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        conversationId,
      ]);
      const previousList = loadedConversations;
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", conversationId],
        (old) =>
          old
            ? {
                ...old,
                conversation: {
                  ...old.conversation,
                  visitorBlocked: true,
                  status: "closed",
                  closeReason: "spam",
                },
              }
            : old,
      );
      setLoadedConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, status: "closed", closeReason: "spam" }
            : c,
        ),
      );
      return { previousDetail, previousList };
    },
    onSuccess: () => toast.success("Visitor blocked"),
    onError: (_err, { conversationId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", conversationId],
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList) setLoadedConversations(ctx.previousList);
      toast.error("Failed to block visitor");
    },
    onSettled: (_data, _error, { conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", conversationId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  // Toggle-off for Block: lift the active ban on this conversation's visitor.
  const unblockVisitor = useMutation({
    mutationFn: async ({ convId }: { convId: string }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/unblock`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to unblock visitor");
      return res.json();
    },
    onMutate: async ({ convId }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", convId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        convId,
      ]);
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? {
                ...old,
                conversation: { ...old.conversation, visitorBlocked: false },
              }
            : old,
      );
      return { previousDetail };
    },
    onSuccess: () => toast.success("Visitor unblocked"),
    onError: (_err, { convId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", convId],
          ctx.previousDetail,
        );
      }
      toast.error("Failed to unblock visitor");
    },
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  const bulkConversationMutation = useMutation<
    BulkConversationExecutionResult,
    Error,
    BulkConversationMutationInput
  >({
    mutationFn: async ({ conversationIds, action }) => {
      return executeBulkConversationAction({
        conversationIds,
        action,
        request: async (conversationIdsChunk, chunkAction) => {
          const res = await fetch(
            `/api/projects/${projectId}/conversations/bulk`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...chunkAction,
                conversationIds: conversationIdsChunk,
              }),
            },
          );
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(body || "Failed to update conversations");
          }
          return res.json() as Promise<BulkConversationResult>;
        },
      });
    },
    onSuccess: (result, { action, conversationIds }) => {
      const updatedIds = new Set(result.updatedIds);
      const actionAt = new Date().toISOString();
      const nowMs = Date.now();

      setLoadedConversations((prev) => prev
        .map((conversation) => updatedIds.has(conversation.id)
          ? patchConversationForBulkAction(conversation, action, actionAt)
          : conversation
        )
        .filter((conversation) => passesInboxFilter(filter, conversation, nowMs))
      );

      for (const conversationId of result.updatedIds) {
        queryClient.setQueryData<ConversationDetail | undefined>(
          ["conversation-detail", conversationId],
          (old) => old
            ? {
                ...old,
                conversation: patchConversationForBulkAction(
                  old.conversation,
                  action,
                  actionAt,
                ),
              }
            : old,
        );
      }

      if (selectedConvo && updatedIds.has(selectedConvo)) {
        const current = convoDetail?.conversation ??
          loadedConversations.find((conversation) => conversation.id === selectedConvo);
        if (current) {
          const patched = patchConversationForBulkAction(current, action, actionAt);
          if (!passesInboxFilter(filter, patched, nowMs)) {
            setSelectedConvo(null);
            setView("split");
          }
        }
      }

      const failedIds = conversationIds.filter((id) =>
        result.failedIds.includes(id)
      );
      setSelectedIds(new Set(failedIds));
      setSelectionAnchorId(failedIds[0] ?? null);
      setSelectionFocusId(failedIds.at(-1) ?? null);

      const count = result.updatedIds.length;
      if (count > 0) toast.success(`${count} conversation${count === 1 ? "" : "s"} updated`);
      if (result.skippedIds.length > 0) {
        toast.info(`${result.skippedIds.length} conversation${result.skippedIds.length === 1 ? " was" : "s were"} skipped`);
      }
      if (result.failedIds.length > 0) {
        toast.error(`${result.failedIds.length} conversation${result.failedIds.length === 1 ? "" : "s"} failed to update`);
      }
    },
    onError: (error) => toast.error(error.message || "Failed to update conversations"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
    },
  });

  // ── Derived view data ─────────────────────────────────────────────────────
  // Unread = visitor sent last AND that activity is newer than any read mark.
  const isUnread = useCallback(
    (c: Conversation) =>
      c.lastMessage?.role === "visitor" &&
      getActivityMs(c) > (readMarks[c.id] ?? 0),
    [readMarks],
  );

  // Opening a conversation marks it read: watermark it at its current
  // activity. Re-runs when activity bumps while the thread is open (a new
  // visitor message arrives in view), so the open thread never flips back to
  // unread under the agent. Persisted like handleMarkAllRead.
  useEffect(() => {
    if (!selectedConvo) return;
    const conv = loadedConversations.find((c) => c.id === selectedConvo);
    if (!conv || conv.lastMessage?.role !== "visitor") return;
    const activity = getActivityMs(conv);
    setReadMarks((prev) => {
      if ((prev[selectedConvo] ?? 0) >= activity) return prev;
      const next = { ...prev, [selectedConvo]: activity };
      if (projectId) {
        try {
          localStorage.setItem(readKey(projectId), JSON.stringify(next));
        } catch {
          // storage disabled / over quota — overlay stays in-memory only.
        }
      }
      return next;
    });
  }, [selectedConvo, loadedConversations, projectId]);

  // Apply the "unread only" filter and the chosen sort over the loaded page.
  const conversations = useMemo(() => {
    const list = unreadOnly
      ? loadedConversations.filter(isUnread)
      : [...loadedConversations];
    list.sort((a, b) => {
      if (sort === "oldest") return getActivityMs(a) - getActivityMs(b);
      if (sort === "priority")
        return priorityRank(b) - priorityRank(a) || getActivityMs(b) - getActivityMs(a);
      return getActivityMs(b) - getActivityMs(a); // newest
    });
    return list;
  }, [loadedConversations, unreadOnly, sort, isUnread]);

  useEffect(() => {
    if (
      view !== "focus" ||
      selectedConvo ||
      convosLoading ||
      isPlaceholderData
    ) {
      return;
    }
    const firstConversation = conversations[0];
    if (firstConversation) setSelectedConvo(firstConversation.id);
  }, [
    conversations,
    convosLoading,
    isPlaceholderData,
    selectedConvo,
    view,
  ]);

  useEffect(() => {
    const visibleIds = new Set(conversations.map((conversation) => conversation.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (selectionAnchorId && !visibleIds.has(selectionAnchorId)) {
      setSelectionAnchorId(null);
    }
    if (selectionFocusId && !visibleIds.has(selectionFocusId)) {
      setSelectionFocusId(null);
    }
  }, [conversations, selectionAnchorId, selectionFocusId]);

  const counts = convosPage?.counts ?? EMPTY_COUNTS;
  // Always render the thread in true chronological order. The server returns
  // messages sorted by full createdAt, but the cached array can drift out of
  // order as live WS messages append onto a stale cache that spans days — so
  // sort by full timestamp here rather than trusting array order (which made
  // messages from different days interleave by time-of-day).
  const messages = useMemo(
    () =>
      [...(convoDetail?.messages ?? [])].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [convoDetail?.messages],
  );
  const selected =
    convoDetail?.conversation ??
    conversations.find((c) => c.id === selectedConvo) ??
    null;
  const selectedIndex = selected
    ? conversations.findIndex((c) => c.id === selected.id)
    : -1;

  const selectedCustomerId = selected?.customerId ?? null;
  const { data: selectedCustomer = null } = useQuery<CustomerDetail>({
    queryKey: customerKeys.detail(
      projectId ?? "missing",
      selectedCustomerId ?? "missing",
    ),
    queryFn: () => fetchCustomer(projectId!, selectedCustomerId!),
    enabled: Boolean(projectId && selectedCustomerId),
  });

  const sidechatDraft = selectedConvo
    ? sidechatDrafts[selectedConvo] ?? ""
    : "";
  const customerFirstName = (
    selectedCustomer?.name ?? selected?.visitorName ?? ""
  ).trim().split(/\s+/u)[0] || null;
  const sidechatStatuses = useMemo(() => {
    return mergeSidechatSummaryStatuses(
      sidechatSummarySession.data?.summaries ?? [],
      liveSidechatState,
    );
  }, [liveSidechatState, sidechatSummarySession.data?.summaries]);
  const selectedSidechatStatus = selected
    ? sidechatStatuses[selected.id] ?? "idle"
    : "idle";
  const selectedSidechatExists = selected
    ? selected.id in sidechatStatuses
    : false;
  const sidechatSession = useSidechatSession({
    projectId,
    conversationId: selected?.id ?? null,
    enabled: sidechatOpen && Boolean(selected),
  });

  const setCustomerMutation = useMutation({
    mutationFn: (options: {
      conversationId: string;
      customerId: string;
    }) =>
      setConversationCustomer(projectId!, options.conversationId, {
        action: "link",
        customerId: options.customerId,
      }),
    onSuccess(result) {
      applyCustomerResult(result);
      setCreateCustomerOpen(false);
      setLinkCustomerOpen(false);
      toast.success("Customer linked");
    },
    onError() {
      toast.error("Could not link customer");
    },
  });

  const customerFormInitialValues = useMemo(
    () => ({
      name: selected?.visitorName ?? null,
      email: selected?.visitorEmail ?? null,
    }),
    [selected?.visitorEmail, selected?.visitorName],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  // Resolve / flag / block are toggles: acting on an already-active state
  // reverses it (reopen / un-flag / unblock). We read the current state from
  // the same conversation the header lights its icons from, and keep that
  // conversation selected after acting, so a lit icon is right there to click
  // again to release.
  function findConv(convId: string): Conversation | null {
    if (selected?.id === convId) return selected;
    return conversations.find((c) => c.id === convId) ?? null;
  }

  function applyCustomerResult(result: ConversationCustomerResponse): void {
    setLoadedConversations((previous) =>
      applyConversationCustomerResult(previous, result),
    );
    queryClient.setQueriesData<ConversationsPage>(
      { queryKey: ["conversations", projectId] },
      (old) =>
        old
          ? {
              ...old,
              conversations: applyConversationCustomerResult(
                old.conversations,
                result,
              ),
            }
          : old,
    );
    queryClient.setQueriesData<ConversationDetail>(
      { queryKey: ["conversation-detail"] },
      (old) => {
        if (!old) return old;
        const [conversation] = applyConversationCustomerResult(
          [old.conversation],
          result,
        );
        return conversation === old.conversation
          ? old
          : { ...old, conversation };
      },
    );
    queryClient.setQueryData(
      customerKeys.detail(projectId!, result.customer.id),
      result.customer,
    );
    queryClient.invalidateQueries({ queryKey: customerKeys.lists(projectId!) });
  }

  function handleCustomerCreated(
    _customer: CustomerDetail,
    result?: ConversationCustomerResponse,
  ): void {
    if (!result) return;
    applyCustomerResult(result);
    setCreateCustomerOpen(false);
    toast.success("Customer created and linked");
  }

  function handleCustomerSelected(customer: CustomerListItem): void {
    if (!selectedConvo) return;
    setCustomerMutation.mutate({
      conversationId: selectedConvo,
      customerId: customer.id,
    });
  }

  function handleSend(
    content?: string,
    opts?: { imageUrls?: string[]; asEmail?: boolean },
  ) {
    const text = (content ?? draft).trim();
    const imageUrls = opts?.imageUrls ?? [];
    if (!text && imageUrls.length === 0) return;
    if (!selectedConvo) return;
    // The composer no longer has a "send as email" toggle. Decide automatically:
    // if the visitor has an email on file and isn't live in the widget right now
    // (email-origin or offline), also deliver the reply by email so it reaches
    // them; active widget visitors just get it in-chat. An explicit opts.asEmail
    // (future callers) still wins.
    const autoEmail =
      !!selected?.visitorEmail && selected?.visitorPresence !== "active";
    sendReply.mutate({
      content: text,
      imageUrls,
      asEmail: opts?.asEmail ?? autoEmail,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function setSelectedSidechatDraft(value: SetStateAction<string>): void {
    if (!selectedConvo) return;
    const conversationId = selectedConvo;
    setSidechatDrafts((current) => {
      const currentDraft = current[conversationId] ?? "";
      const nextDraft = typeof value === "function"
        ? value(currentDraft)
        : value;
      if (nextDraft === currentDraft) return current;
      return { ...current, [conversationId]: nextDraft };
    });
  }

  function handleStartSidechat(): void {
    if (!selectedConvo || !selected) return;
    const entry = planSidechatEntry({
      archived: Boolean(selected.archivedAt),
      exists: selectedSidechatExists,
      conversationId: selectedConvo,
      messageId: crypto.randomUUID(),
      publicDraft: draft,
    });
    if (!entry) return;
    setPendingSidechatTransfer(entry.transfer);
    setSidechatOpen(entry.open);
  }

  function handleCloseSidechat(): void {
    setSidechatOpen(false);
  }

  function handleAddToReply(sidechatReplyDraft: string): void {
    if (selected?.archivedAt) return;
    const intent = deriveAddToReplyIntent(
      sidechatReplyDraft,
      typeof window === "undefined" ? 1_536 : window.innerWidth,
    );
    setDraft(intent.draft);
    if (!intent.keepSidechatOpen) {
      setSidechatOpen(false);
      setFocusPublicComposerAfterClose(true);
    } else if (intent.focusPublicComposer) {
      setPublicComposerFocusRequest((request) => request + 1);
    }
  }

  function handleSidechatSubmissionStarted(messageId: string): void {
    setPendingSidechatTransfer((current) =>
      current?.messageId === messageId
        ? { ...current, submitted: true }
        : current,
    );
  }

  function handleInitialSidechatSubmissionSkipped(messageId: string): void {
    setPendingSidechatTransfer((current) =>
      current?.messageId === messageId ? null : current,
    );
  }

  function handleSidechatTurnAccepted(messageId: string): void {
    const result = reduceAcceptedSidechatTransfer({
      transfer: pendingSidechatTransfer,
      acceptedMessageId: messageId,
      selectedConversationId: selectedConvo,
      currentPublicDraft: draft,
    });
    if (result.nextDraft !== draft) setDraft(result.nextDraft);
    if (result.transfer !== pendingSidechatTransfer) {
      setPendingSidechatTransfer(result.transfer);
    }
  }

  function handleResolve(convId: string) {
    const conv = findConv(convId);
    // Lit (resolved, i.e. closed for a non-spam reason) → reopen; else resolve.
    if (conv && conv.status === "closed" && conv.closeReason !== "spam") {
      reopenConversation.mutate({ convId });
    } else {
      closeConversation.mutate({ convId, closeReason: "resolved" });
    }
  }

  function handleFlagSpam(convId: string) {
    const conv = findConv(convId);
    // Lit (already flagged as spam) → reopen / un-flag; else flag.
    if (conv?.closeReason === "spam") {
      reopenConversation.mutate({ convId });
    } else {
      closeConversation.mutate({ convId, closeReason: "spam" });
    }
  }

  function handleSnooze(convId: string, until: number | null) {
    // until === null is the un-snooze path (the header sends it when snoozed).
    snoozeConversation.mutate({ convId, until });
  }

  function handleSetPriority(
    convId: string,
    priority: "low" | "medium" | "high",
  ) {
    setPriorityMutation.mutate({ convId, priority });
  }

  function handleAssign(convId: string, assigneeId: string | null) {
    assignConversation.mutate({ convId, assigneeId });
  }

  function clearBulkSelection() {
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setSelectionFocusId(null);
  }

  function handleConversationSelect(
    convId: string,
    options: { shiftKey: boolean },
  ) {
    const orderedIds = conversations.map((conversation) => conversation.id);

    if (options.shiftKey) {
      const anchorId = selectionAnchorId && orderedIds.includes(selectionAnchorId)
        ? selectionAnchorId
        : selectedConvo && orderedIds.includes(selectedConvo)
          ? selectedConvo
          : convId;
      setSelectedIds(selectInclusiveRange(orderedIds, anchorId, convId));
      setSelectionAnchorId(anchorId);
      setSelectionFocusId(convId);
      setSelectedConvo(convId);
      return;
    }

    if (selectedIds.size > 0) {
      const next = toggleSelection(selectedIds, convId);
      setSelectedIds(next);
      setSelectionAnchorId(next.size > 0 ? convId : null);
      setSelectionFocusId(next.size > 0 ? convId : null);
      setSelectedConvo(convId);
      return;
    }

    setSelectedConvo(convId);
    setSelectionAnchorId(convId);
    setSelectionFocusId(convId);
  }

  function handleStartSelection() {
    const seedId = selectedConvo && conversations.some((c) => c.id === selectedConvo)
      ? selectedConvo
      : conversations[0]?.id;
    if (!seedId) return;
    setSelectedIds(new Set([seedId]));
    setSelectionAnchorId(seedId);
    setSelectionFocusId(seedId);
  }

  function handleSelectAllLoaded() {
    if (conversations.length === 0) return;
    setSelectedIds(new Set(conversations.map((conversation) => conversation.id)));
    setSelectionAnchorId(conversations[0].id);
    setSelectionFocusId(conversations[conversations.length - 1].id);
  }

  function handleBulkAction(action: BulkConversationAction) {
    if (bulkConversationMutation.isPending || selectedIds.size === 0) return;
    bulkConversationMutation.mutate({
      conversationIds: [...selectedIds],
      action,
    });
  }

  function handleArchive(
    convId: string,
    action: "archive" | "unarchive",
  ) {
    if (bulkConversationMutation.isPending) return;
    bulkConversationMutation.mutate({
      conversationIds: [convId],
      action: { action },
    });
  }

  function handleLoadMore() {
    setListLimit((n) => n + 25);
  }

  // Mark every loaded conversation as read by watermarking it at its current
  // activity (a later visitor message bumps activity past the mark → unread
  // again). Persisted to localStorage; this browser only (no server state).
  function handleMarkAllRead() {
    setReadMarks((prev) => {
      const next = { ...prev };
      for (const c of loadedConversations) {
        if (c.lastMessage?.role === "visitor") next[c.id] = getActivityMs(c);
      }
      if (projectId) {
        try {
          localStorage.setItem(readKey(projectId), JSON.stringify(next));
        } catch {
          // storage disabled / over quota — overlay stays in-memory only.
        }
      }
      return next;
    });
  }

  function handleMarkSelectedRead() {
    const selectedSnapshot = new Set(selectedIds);
    setReadMarks((prev) => {
      const next = { ...prev };
      for (const conversation of conversations) {
        if (
          selectedSnapshot.has(conversation.id) &&
          conversation.lastMessage?.role === "visitor"
        ) {
          next[conversation.id] = getActivityMs(conversation);
        }
      }
      if (projectId) {
        try {
          localStorage.setItem(readKey(projectId), JSON.stringify(next));
        } catch {
          // storage disabled / over quota, overlay stays in memory only.
        }
      }
      return next;
    });
    clearBulkSelection();
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
    queryClient.invalidateQueries({ queryKey: ["inbox-counts", projectId] });
  }

  async function handleDeleteMessage(messageId: string) {
    if (!selectedConvo) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/messages/${messageId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete message");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      toast.success("Message deleted");
    } catch {
      toast.error("Failed to delete message");
    }
  }

  function handleBlock(convId: string) {
    // Look up the conversation to get visitor identifiers. Prefer the detail
    // cache (most current) but only when its id matches the target — a stale
    // detail cache during a navigation/mutation race must not ban the wrong
    // visitor. Fall back to the list otherwise.
    const conv =
      (convoDetail?.conversation?.id === convId
        ? convoDetail.conversation
        : null) ?? conversations.find((c) => c.id === convId);
    if (!conv) return;
    // Lit (visitor already blocked) → unblock; else block. visitorBlocked is
    // only populated on the detail cache, so the toggle-off path is reachable
    // only for the open conversation (which is exactly where the icon shows).
    if (conv.visitorBlocked) {
      unblockVisitor.mutate({ convId });
      return;
    }
    blockVisitor.mutate({
      visitorId: conv.visitorId,
      ...(conv.visitorEmail ? { visitorEmail: conv.visitorEmail } : {}),
      conversationId: convId,
    });
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    function selectRelative(delta: number) {
      if (conversations.length === 0) return;
      const newIndex = Math.max(
        0,
        Math.min(conversations.length - 1, selectedIndex + delta),
      );
      clearBulkSelection();
      setSelectedConvo(conversations[newIndex].id);
    }

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.matches?.("input, textarea, [contenteditable='true']")) return;
      if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const orderedIds = conversations.map((conversation) => conversation.id);
        const fallbackId = selectedConvo && orderedIds.includes(selectedConvo)
          ? selectedConvo
          : orderedIds[0] ?? null;
        const anchorId = selectionAnchorId && orderedIds.includes(selectionAnchorId)
          ? selectionAnchorId
          : fallbackId;
        const focusId = selectionFocusId && orderedIds.includes(selectionFocusId)
          ? selectionFocusId
          : fallbackId;
        const result = moveRangeSelection({
          orderedIds,
          anchorId,
          focusId,
          direction: e.key === "ArrowDown" ? 1 : -1,
        });
        setSelectedIds(result.selectedIds);
        setSelectionAnchorId(anchorId);
        setSelectionFocusId(result.focusId);
        if (result.focusId) setSelectedConvo(result.focusId);
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        selectRelative(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        selectRelative(-1);
      } else if (e.key === "e" || e.key === "E") {
        if (selected && !selected.archivedAt) handleResolve(selected.id);
      } else if (e.key === "f" || e.key === "F") {
        if (selected && !selected.archivedAt) {
          setView(view === "focus" ? "split" : "focus");
        }
      } else if (e.key === "Escape") {
        if (selectedIds.size > 0) clearBulkSelection();
        else setView("split");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleResolve is a function declaration that closes over the same
    // reactive values already listed (conversations, selected, etc.), so it is
    // kept fresh by the existing deps without being listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected,
    selectedConvo,
    selectedIds,
    selectionAnchorId,
    selectionFocusId,
    conversations,
    selectedIndex,
    view,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────
  const matchingSidechatSession = selected &&
      sidechatSession.data?.childName === `sc_${selected.id}` &&
      isSidechatSessionUsable(sidechatSession.data)
    ? sidechatSession.data
    : null;
  const sidechatPane = selected
    ? matchingSidechatSession
      ? (
        <NativeSidechatPane
          open={sidechatOpen}
          conversation={selected}
          customerFirstName={customerFirstName}
          session={matchingSidechatSession}
          transfer={pendingSidechatTransfer}
          draft={sidechatDraft}
          setDraft={setSelectedSidechatDraft}
          onSubmissionStarted={handleSidechatSubmissionStarted}
          onInitialSubmissionSkipped={handleInitialSidechatSubmissionSkipped}
          onTurnAccepted={handleSidechatTurnAccepted}
          onAddToReply={handleAddToReply}
          onClose={handleCloseSidechat}
        />
      )
      : (
        <SidechatPane
          open={sidechatOpen}
          conversation={selected}
          customerFirstName={customerFirstName}
          messages={[]}
          draft={sidechatDraft}
          setDraft={setSelectedSidechatDraft}
          onAddToReply={handleAddToReply}
          onClose={handleCloseSidechat}
          status={sidechatSession.error ? "error" : "submitted"}
          presentationStatus={sidechatSession.error ? "failed" : "working"}
          error={sidechatSession.error ?? undefined}
          safeActivity={null}
          loading={!sidechatSession.error}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => {
            void sidechatSession.refetch();
          }}
          onApproval={() => undefined}
          composerDisabled
        />
      )
    : null;

  if (view === "focus" && selected && !selected.archivedAt) {
    const focusView = (
      <FocusView
        conversation={selected}
        messages={messages}
        index={selectedIndex}
        total={counts[filter] ?? conversations.length}
        onExit={() => setView("split")}
        onSend={handleSend}
        onResolve={handleResolve}
        onDeleteMessage={handleDeleteMessage}
        draft={draft}
        setDraft={setDraft}
        onStartSidechat={handleStartSidechat}
        sidechatOpen={sidechatOpen}
        sidechatExists={selectedSidechatExists}
        sidechatStatus={selectedSidechatStatus}
        publicComposerFocusRequest={publicComposerFocusRequest}
        embedded
      />
    );
    return (
      <>
        {sidechatSummarySession.data && (
          <ConversationDirectoryAgentBridge
            session={sidechatSummarySession.data}
            onState={handleSidechatParentState}
            onEvent={handleDirectoryEvent}
          />
        )}
        {publicChatSession.data && selectedConvo && (
          <NativePublicConversationBridge
            session={publicChatSession.data}
            conversationId={selectedConvo}
            onMessages={handleNativePublicMessages}
            onState={handleNativePublicState}
          />
        )}
        <FocusSidechatLayout
          sidechatOpen={sidechatOpen}
          focusView={focusView}
          sidechatPane={sidechatPane}
        />
      </>
    );
  }

  return (
    // The brief's shell is `flex h-screen min-w-0`; the negative margins +
    // overflow-hidden escape the Layout's `p-4 md:p-8` Outlet padding so the
    // inbox renders full-bleed (matching the prior page behavior).
    <div className="-m-4 md:-m-8 flex h-screen min-w-0 overflow-hidden">
      <MessageList
        filter={filter}
        conversations={conversations}
        counts={counts}
        selectedId={selectedConvo}
        selectedIds={selectedIds}
        onSelect={handleConversationSelect}
        onStartSelection={handleStartSelection}
        onClearSelection={clearBulkSelection}
        onSelectAllLoaded={handleSelectAllLoaded}
        onBulkAction={handleBulkAction}
        onMarkSelectedRead={handleMarkSelectedRead}
        bulkPending={bulkConversationMutation.isPending}
        search={searchQuery}
        onSearchChange={setSearchQuery}
        hasMore={convosPage?.hasMore ?? false}
        onLoadMore={handleLoadMore}
        isLoading={convosLoading || isPlaceholderData}
        isUnread={isUnread}
        sort={sort}
        onSortChange={setSort}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={setUnreadOnly}
        onMarkAllRead={handleMarkAllRead}
        onRefresh={handleRefresh}
        sidechatStatuses={sidechatStatuses}
        // Mobile: collapse the list once a conversation is open so the chat +
        // composer take the full screen (desktop keeps the split).
        className={cn(
          sidechatOpen
            ? "hidden min-[1536px]:flex"
            : selectedConvo && selectedIds.size === 0
              ? "hidden md:flex"
              : "flex",
        )}
      />
      {selected ? (
        <ReadingPane
          conversation={selected}
          customer={selectedCustomer}
          customerProfileHref={
            selected.customerId
              ? `/app/projects/${projectId}/customers/${selected.customerId}`
              : undefined
          }
          messages={messages}
          messagesLoading={detailLoading}
          draft={draft}
          setDraft={setDraft}
          onSend={handleSend}
          onResolve={handleResolve}
          onSnooze={handleSnooze}
          onFlagSpam={handleFlagSpam}
          onPriority={handleSetPriority}
          onFocus={() => setView("focus")}
          onBlock={handleBlock}
          onAssign={handleAssign}
          onArchive={handleArchive}
          onCreateCustomer={() => setCreateCustomerOpen(true)}
          onLinkCustomer={() => setLinkCustomerOpen(true)}
          onDeleteMessage={handleDeleteMessage}
          onBack={() => setSelectedConvo(null)}
          onStartSidechat={handleStartSidechat}
          sidechatOpen={sidechatOpen}
          sidechatExists={selectedSidechatExists}
          sidechatStatus={selectedSidechatStatus}
          publicComposerFocusRequest={publicComposerFocusRequest}
          className={cn(
            selectedIds.size > 0 && "hidden md:flex",
            sidechatOpen && "hidden md:flex",
          )}
          // `?msg=` deep-link scroll+pulse target.
          highlightMessageId={highlightMsgId}
        />
      ) : (
        <div className="glass-reading flex-1 hidden md:grid place-items-center text-ink-7 text-sm">
          Select a conversation
        </div>
      )}
      {sidechatPane}
      {sidechatSummarySession.data && (
        <ConversationDirectoryAgentBridge
          session={sidechatSummarySession.data}
          onState={handleSidechatParentState}
          onEvent={handleDirectoryEvent}
        />
      )}
      {publicChatSession.data && selectedConvo && (
        <NativePublicConversationBridge
          session={publicChatSession.data}
          conversationId={selectedConvo}
          onMessages={handleNativePublicMessages}
          onState={handleNativePublicState}
        />
      )}

      <CustomerFormDialog
        projectId={projectId!}
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        initialValues={customerFormInitialValues}
        conversationId={selectedConvo ?? undefined}
        onCreated={handleCustomerCreated}
      />
      <CustomerPickerDialog
        projectId={projectId!}
        open={linkCustomerOpen}
        onOpenChange={setLinkCustomerOpen}
        onSelect={handleCustomerSelected}
        pending={setCustomerMutation.isPending}
      />
    </div>
  );
}

export default Conversations;
