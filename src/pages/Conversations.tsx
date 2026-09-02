import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useReducer,
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
import { useSession } from "@/lib/auth-client";
import { serializeMessageImageUrls } from "../../shared/message-images";
import {
  parseInboxFilter,
  passesInboxFilter,
  type InboxSort,
} from "@/lib/inbox/filters";
import {
  INITIAL_FOCUS_QUEUE_STATE,
  createFocusCardSnapshot,
  currentFocusConversationId,
  reduceFocusQueue,
  selectFocusDetailIfCurrent,
  selectFocusViewModel,
  type FocusDepartureAction,
  type FocusQueueState,
} from "@/lib/inbox/focus-queue";
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
  deriveSidechatPresentation,
  mergeSidechatSummaryStatuses,
  planSidechatEntry,
  type SidechatPresentationStatus,
} from "@/lib/inbox/sidechat";
import {
  planInitialSidechatSubmission,
  planFailedSidechatRetry,
  reduceAcceptedSidechatTransfer,
  deriveNativeSidechatUiStatus,
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
import { looksLikeAgentBotNameCommand } from "@/lib/inbox/bot-name-command";
import InboxEmptyPane from "@/components/inbox/InboxEmptyPane";
import MessageList from "@/components/inbox/MessageList";
import ReadingPane from "@/components/inbox/ReadingPane";
import ConversationSearchDialog from "@/components/inbox/ConversationSearchDialog";
import FocusView, { FocusViewSkeleton } from "@/components/inbox/FocusView";
import FocusSidechatLayout from "@/components/inbox/FocusSidechatLayout";
import SidechatPane from "@/components/inbox/SidechatPane";
import CustomerFormDialog from "@/components/customers/CustomerFormDialog";
import CustomerPickerDialog from "@/components/customers/CustomerPickerDialog";
import { useRegisterInboxCommands } from "@/components/commands/DashboardCommandProvider";
import {
  applyConversationCustomerResult,
  customerKeys,
  fetchCustomer,
  invalidateCustomerProjectQueries,
  setConversationCustomer,
} from "@/lib/customers";
import {
  ALL_INBOX_CAPABILITIES,
  type DashboardCommandIntent,
  type InboxCommandScope,
} from "@/lib/commands/dashboard-command-domain";
import { buildInboxSelection } from "@/lib/commands/inbox-command-lookup";
import {
  previewFocusConversationAction,
  type FocusConversationAction,
} from "@/lib/inbox/focus-action-preview";

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

interface FocusActionExecution {
  conversation: Conversation;
  action: FocusConversationAction;
  departureAction: FocusDepartureAction;
  mutate: () => Promise<unknown>;
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

const PHANTOM_STREAM_STOP_GRACE_MS = 3_000;

interface NativeSidechatPaneProps {
  open: boolean;
  conversation: Conversation;
  customerFirstName: string | null;
  session: SidechatSessionResponse;
  summaryStatus: SidechatPresentationStatus;
  transfer: PendingSidechatTransfer | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSubmissionStarted: (messageId: string) => void;
  onInitialSubmissionSkipped: (messageId: string) => void;
  onTurnAccepted: (messageId: string) => void;
  onAddToReply: (draft: string) => void;
  onSendAsMaven: (sourceMessageId: string) => void;
  sendingMavenDraftMessageId: string | null;
  mavenDraftSendPending: boolean;
  onClose: () => void;
}

function NativeSidechatPane({
  open,
  conversation,
  customerFirstName,
  session,
  summaryStatus,
  transfer,
  draft,
  setDraft,
  onSubmissionStarted,
  onInitialSubmissionSkipped,
  onTurnAccepted,
  onAddToReply,
  onSendAsMaven,
  sendingMavenDraftMessageId,
  mavenDraftSendPending,
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
  ]);

  const hasApproval = sidechat.messages.some(
    (message) =>
      message.presentationAction?.type === "approval" ||
      message.knowledgeChanges?.some((change) =>
        change.status === "pending" || change.status === "applying"
      ) === true ||
      message.sidechatTrace?.some(
        (item) =>
          item.type === "tool" && item.state === "approval-requested",
      ) === true,
  );
  const hasReplyDraft = sidechat.messages.some(
    (message) => Boolean(message.replyDraft),
  );
  const sidechatUiStatus = deriveNativeSidechatUiStatus({
    status: sidechat.status,
    isServerStreaming: sidechat.isServerStreaming,
    isRecovering: sidechat.isRecovering,
  });
  // The transport can miss the post-approval continuation handshake and stay
  // "streaming" after the server finished; clear the phantom stream.
  const stopSidechat = sidechat.stop;
  const latestSidechatMessage = sidechat.messages[sidechat.messages.length - 1];
  const hasSettledSidechatAnswer = latestSidechatMessage?.role === "bot" && (
    Boolean(latestSidechatMessage.replyDraft) ||
    (latestSidechatMessage.knowledgeChanges?.length ?? 0) > 0 ||
    latestSidechatMessage.content.trim().length > 0
  );
  const summaryIsTerminal =
    summaryStatus === "idle" ||
    summaryStatus === "ready" ||
    summaryStatus === "failed";
  useEffect(() => {
    if (sidechatUiStatus !== "streaming") return;
    if (hasApproval || !summaryIsTerminal || !hasSettledSidechatAnswer) return;
    const timer = window.setTimeout(() => {
      void stopSidechat();
    }, PHANTOM_STREAM_STOP_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [
    sidechatUiStatus,
    hasApproval,
    summaryIsTerminal,
    hasSettledSidechatAnswer,
    stopSidechat,
  ]);
  const presentation = deriveSidechatPresentation({
    uiStatus: sidechatUiStatus,
    rawStatus: sidechat.status,
    summaryStatus,
    hasApproval,
    hasReplyDraft,
  });

  return (
    <SidechatPane
      open={open}
      conversation={conversation}
      customerFirstName={customerFirstName}
      messages={sidechat.messages}
      draft={draft}
      setDraft={setDraft}
      onAddToReply={onAddToReply}
      onSendAsMaven={onSendAsMaven}
      sendingMavenDraftMessageId={sendingMavenDraftMessageId}
      mavenDraftSendPending={mavenDraftSendPending}
      onClose={onClose}
      status={presentation.status}
      presentationStatus={presentation.presentationStatus}
      error={presentation.serverFailure
        ? sidechat.error ?? new Error("The Sidechat turn failed.")
        : sidechat.error}
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
  inbox: 0,
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? null;
  const currentUserName = session?.user.name?.trim() || "Someone";

  // Active inbox filter is owned by the URL (the sidebar deep-links to
  // `?filter=<id>`). `all` is the old All Conversations id.
  const rawFilter = searchParams.get("filter");
  const filter = parseInboxFilter(rawFilter) ?? "needs-you";

  useEffect(() => {
    if (rawFilter !== "all") return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("filter", "inbox");
      return next;
    }, { replace: true });
  }, [rawFilter, setSearchParams]);

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
  // Focus mode is desktop-only: on mobile viewports the URL's ?focus=true is
  // ignored and the regular list/thread view renders instead. Reactive so
  // resizing across the boundary switches live without touching the URL.
  const [isMobileViewport, setIsMobileViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobileViewport(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const view = !isMobileViewport && searchParams.get("focus") === "true"
    ? "focus"
    : "split";
  const [focusQueueState, dispatchFocusQueue] = useReducer(
    reduceFocusQueue,
    INITIAL_FOCUS_QUEUE_STATE,
  );
  const focusQueueStateRef = useRef<FocusQueueState>(focusQueueState);
  focusQueueStateRef.current = focusQueueState;
  const focusConversationId = currentFocusConversationId(focusQueueState);
  const activeConversationId =
    view === "focus" ? focusConversationId : selectedConvo;
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
    if (view !== "split") return;
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
  }, [selectedConvo, view]);

  useEffect(() => {
    if (view !== "focus" || focusQueueState.kind === "inactive") return;
    setSearchParams(
      (current) => {
        const currentId = current.get("id");
        const alreadyMatches =
          current.get("focus") === "true" &&
          currentId === focusConversationId;
        if (alreadyMatches) return current;
        const next = new URLSearchParams(current);
        next.set("focus", "true");
        if (focusConversationId) next.set("id", focusConversationId);
        else next.delete("id");
        return next;
      },
      { replace: true },
    );
  }, [
    focusConversationId,
    focusQueueState.kind,
    setSearchParams,
    view,
  ]);

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
    if (view !== "focus" && urlId && urlId !== selectedConvo) {
      setSelectedConvo(urlId);
    }
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
  }, [searchParams, view]);

  useEffect(() => {
    if (activeConversationId !== highlightConvRef.current) {
      setHighlightMsgId(null);
    }
  }, [activeConversationId]);

  // ── Search & pagination state ──────────────────────────────────────────
  // searchQuery is the raw input value (controlled); debouncedSearch is what
  // the query key and fetch URL use, updated after a 300ms idle window.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchMatchIndex, setThreadSearchMatchIndex] = useState(0);
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
    isError: convosError,
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
    queryKey: ["conversation-detail", activeConversationId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${activeConversationId}`,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          body || `Failed to load conversation (status ${res.status})`,
        );
      }
      return res.json();
    },
    enabled: Boolean(activeConversationId),
    retry: 1,
    // Detail is kept fresh in real time by the Agent session; cache 60s so
    // revisiting a conversation is instant.
    staleTime: 1000 * 60,
    structuralSharing: true,
  });

  const publicChatSession = usePublicChatSession({
    projectId,
    conversationId: activeConversationId,
    enabled: Boolean(activeConversationId),
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
    // useAgentChat mounts with an empty list before it hydrates; an opened
    // conversation always has at least the visitor message, so an empty
    // emission is that transient and must not wipe the cached thread.
    if (messages.length === 0) return;
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
  }, [activeConversationId]);

  useEffect(() => {
    setThreadSearch("");
    setThreadSearchOpen(false);
    setThreadSearchMatchIndex(0);
  }, [activeConversationId]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async ({
      conversationId,
      content,
      imageUrls,
      idempotencyKey,
    }: {
      conversationId: string;
      content: string;
      imageUrls?: string[];
      idempotencyKey: string;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${conversationId}/reply`,
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
      const data = (await res.json()) as {
        id?: string;
        command?: boolean;
        confirmation?: string;
      };
      if (data.command) {
        toast.success(data.confirmation || "Command applied");
      }
      return data;
    },
    onMutate: async ({
      conversationId,
      content,
      imageUrls,
      idempotencyKey,
    }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", conversationId],
      });
      const previous = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        conversationId,
      ]);
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", conversationId],
        (old) => {
          if (!old) return old;
          if (
            looksLikeAgentBotNameCommand(content, old.botName) &&
            (imageUrls?.length ?? 0) === 0
          ) {
            return old;
          }
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
    onError: (err: Error, variables, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          ["conversation-detail", variables.conversationId],
          ctx.previous,
        );
      }
      toast.error(err.message || "Failed to send reply");
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", variables.conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const sendMavenDraft = useMutation({
    mutationFn: async ({
      conversationId,
      sourceMessageId,
    }: {
      conversationId: string;
      sourceMessageId: string;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${conversationId}` +
          "/sidechat/drafts/send-as-maven",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: sourceMessageId }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        messageId?: string;
      } | null;
      if (!res.ok) {
        if (body?.error === "draft_not_found") {
          throw new Error("This draft is no longer available.");
        }
        if (body?.error === "conversation_changed") {
          throw new Error("The conversation changed. Try again.");
        }
        throw new Error("Could not send the draft.");
      }
      return body;
    },
    onSuccess: (_data, variables) => {
      toast.success("Sent as Maven.");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", variables.conversationId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const sendEmail = useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
    }: {
      conversationId: string;
      messageId: string;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${conversationId}/send-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error || "Failed to send email");
      }
      return body as { ok?: boolean; emailedAt?: string };
    },
    onMutate: async ({ conversationId, messageId }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", conversationId],
      });
      const previous = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        conversationId,
      ]);
      const emailedAt = new Date().toISOString();
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", conversationId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((message) =>
              message.id === messageId ? { ...message, emailedAt } : message,
            ),
          };
        },
      );
      return { previous, conversationId };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          ["conversation-detail", ctx.conversationId],
          ctx.previous,
        );
      }
      toast.error(err.message || "Failed to send email");
    },
    onSuccess: () => {
      toast.success("Emailed to visitor");
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

  // Toggle-off for Resolve / Flag-as-spam: claim the thread, bump activity,
  // and write a reopen pill. Mirrors closeConversation's optimistic patch of
  // both the detail cache and the local list.
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
      const now = new Date().toISOString();
      const reopenContent = `${currentUserName} reopened this conversation`;
      const reopenMessage: Message = {
        id: `optimistic-reopen-${convId}`,
        role: "system",
        content: reopenContent,
        sources: JSON.stringify({ systemKind: "reopened" }),
        createdAt: now,
      };
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? {
                ...old,
                conversation: {
                  ...old.conversation,
                  status: "waiting_agent",
                  closeReason: null,
                  assigneeId: currentUserId,
                  lastActivityAt: now,
                  updatedAt: now,
                },
                messages: old.messages.some((message) =>
                  message.sources?.includes("\"reopened\"") &&
                  message.content === reopenContent
                )
                  ? old.messages
                  : [...old.messages, reopenMessage],
              }
            : old,
      );
      setLoadedConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                status: "waiting_agent",
                closeReason: null,
                assigneeId: currentUserId,
                lastActivityAt: now,
                updatedAt: now,
                lastMessage: {
                  id: reopenMessage.id,
                  role: "system",
                  content: reopenContent,
                  senderName: null,
                  emailedAt: null,
                  createdAt: now,
                },
              }
            : c,
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
    onMutate: async ({ convId, until }) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", convId],
      });
      const previousDetail = queryClient.getQueryData<ConversationDetail>([
        "conversation-detail",
        convId,
      ]);
      const previousList = loadedConversations;
      const snoozedUntil = until ? new Date(until).toISOString() : null;
      queryClient.setQueryData<ConversationDetail | undefined>(
        ["conversation-detail", convId],
        (old) =>
          old
            ? {
                ...old,
                conversation: { ...old.conversation, snoozedUntil },
              }
            : old,
      );
      setLoadedConversations((current) =>
        current.map((conversation) =>
          conversation.id === convId
            ? { ...conversation, snoozedUntil }
            : conversation,
        ),
      );
      return { previousDetail, previousList };
    },
    onError: (_error, { convId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          ["conversation-detail", convId],
          context.previousDetail,
        );
      }
      if (context?.previousList) {
        setLoadedConversations(context.previousList);
      }
      toast.error("Failed to snooze conversation");
    },
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

      if (
        view === "split" &&
        selectedConvo &&
        updatedIds.has(selectedConvo)
      ) {
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
    if (!activeConversationId) return;
    const conv = loadedConversations.find((c) => c.id === activeConversationId);
    if (!conv || conv.lastMessage?.role !== "visitor") return;
    const activity = getActivityMs(conv);
    setReadMarks((prev) => {
      if ((prev[activeConversationId] ?? 0) >= activity) return prev;
      const next = { ...prev, [activeConversationId]: activity };
      if (projectId) {
        try {
          localStorage.setItem(readKey(projectId), JSON.stringify(next));
        } catch {
          // storage disabled / over quota — overlay stays in-memory only.
        }
      }
      return next;
    });
  }, [activeConversationId, loadedConversations, projectId]);

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
  const focusHasMore = convosPage?.hasMore ?? false;
  const focusKnownTotal =
    unreadOnly || debouncedSearch.length > 0
      ? conversations.length + (focusHasMore ? 1 : 0)
      : counts[filter];
  const focusCards = useMemo(
    () => {
      const nowMs = Date.now();
      return conversations
        .filter((conversation) =>
          passesInboxFilter(filter, conversation, nowMs),
        )
        .map(createFocusCardSnapshot);
    },
    [conversations, filter],
  );
  const focusViewModel = selectFocusViewModel(focusQueueState);
  const focusReducedMotion =
    focusQueueState.kind === "inactive"
      ? false
      : focusQueueState.reducedMotion;
  const focusSessionKey = [
    projectId ?? "",
    filter,
    debouncedSearch,
    sort,
    unreadOnly ? "unread" : "all",
  ].join(":");
  const focusSessionKeyRef = useRef<string | null>(null);
  const focusRefillTargetRef = useRef<number | null>(null);
  const focusNearEndLimitRef = useRef<number | null>(null);
  const previousFocusKindRef = useRef<FocusQueueState["kind"]>("inactive");

  useEffect(() => {
    if (
      view !== "focus" ||
      convosLoading ||
      isPlaceholderData ||
      focusSessionKeyRef.current === focusSessionKey
    ) {
      return;
    }
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setSelectionFocusId(null);
    focusSessionKeyRef.current = focusSessionKey;
    dispatchFocusQueue({
      type: "ENTER",
      visible: focusCards,
      selectedId: searchParams.get("id") ?? selectedConvo,
      knownTotal: focusKnownTotal,
      hasMore: focusHasMore,
      reducedMotion: prefersReducedMotion(),
    });
  }, [
    convosLoading,
    focusCards,
    focusHasMore,
    focusKnownTotal,
    focusSessionKey,
    isPlaceholderData,
    searchParams,
    selectedConvo,
    view,
  ]);

  useEffect(() => {
    if (view === "focus") return;
    focusSessionKeyRef.current = null;
    focusRefillTargetRef.current = null;
    focusNearEndLimitRef.current = null;
    if (focusQueueState.kind === "inactive") return;
    const currentId = currentFocusConversationId(focusQueueState);
    setSelectedConvo(currentId);
    dispatchFocusQueue({ type: "EXIT" });
  }, [focusQueueState, view]);

  useEffect(() => {
    if (focusQueueState.kind === "departing") {
      setSidechatOpen(false);
    }
  }, [focusQueueState.kind]);

  useEffect(() => {
    const previousKind = previousFocusKindRef.current;
    previousFocusKindRef.current = focusQueueState.kind;
    if (
      view !== "focus" ||
      previousKind !== "rolling-back" ||
      focusQueueState.kind !== "reviewing"
    ) {
      return;
    }
    dispatchFocusQueue({
      type: "VISIBLE_LIST_SYNC",
      visible: focusCards,
      knownTotal: focusKnownTotal,
      hasMore: focusHasMore,
    });
  }, [
    focusCards,
    focusHasMore,
    focusKnownTotal,
    focusQueueState.kind,
    view,
  ]);

  useEffect(() => {
    if (
      view !== "focus" ||
      focusQueueStateRef.current.kind === "inactive" ||
      convosLoading ||
      isPlaceholderData
    ) {
      return;
    }
    dispatchFocusQueue({
      type: "VISIBLE_LIST_SYNC",
      visible: focusCards,
      knownTotal: focusKnownTotal,
      hasMore: focusHasMore,
    });
  }, [
    convosLoading,
    focusCards,
    focusHasMore,
    focusKnownTotal,
    isPlaceholderData,
    view,
  ]);

  useEffect(() => {
    if (
      view !== "focus" ||
      (focusQueueState.kind !== "loading" &&
        focusQueueState.kind !== "checking-queue")
    ) {
      focusRefillTargetRef.current = null;
      return;
    }
    const target = focusRefillTargetRef.current;
    if (target == null) {
      if (focusQueueState.refillFailed) return;
      const nextLimit = listLimit + 25;
      focusRefillTargetRef.current = nextLimit;
      setListLimit(nextLimit);
      return;
    }
    if (listLimit < target || isPlaceholderData || convosLoading) return;
    focusRefillTargetRef.current = null;
    if (convosError) {
      dispatchFocusQueue({ type: "QUEUE_REFILL_FAILED" });
      return;
    }
    dispatchFocusQueue({
      type: "QUEUE_REFILL_RETURNED",
      visible: focusCards,
      knownTotal: focusKnownTotal,
      hasMore: focusHasMore,
    });
  }, [
    convosError,
    convosLoading,
    focusCards,
    focusHasMore,
    focusKnownTotal,
    focusQueueState,
    isPlaceholderData,
    listLimit,
    view,
  ]);

  useEffect(() => {
    if (
      view !== "focus" ||
      focusQueueState.kind !== "reviewing" ||
      convosLoading ||
      convosError ||
      isPlaceholderData
    ) {
      return;
    }
    const currentId = currentFocusConversationId(focusQueueState);
    const currentIndex = focusCards.findIndex((card) => card.id === currentId);
    const nearEnd = currentIndex >= focusCards.length - 2;
    if (currentIndex < 0 || !nearEnd || !focusHasMore) return;
    if (focusNearEndLimitRef.current === listLimit) return;
    focusNearEndLimitRef.current = listLimit;
    setListLimit((current) => current + 25);
  }, [
    convosLoading,
    convosError,
    focusCards,
    focusHasMore,
    focusQueueState,
    isPlaceholderData,
    listLimit,
    view,
  ]);

  // Always render the thread in true chronological order. The server returns
  // messages sorted by full createdAt, but the cached array can drift out of
  // order as live WS messages append onto a stale cache that spans days — so
  // sort by full timestamp here rather than trusting array order (which made
  // messages from different days interleave by time-of-day).
  const activeConversationDetail =
    view === "focus"
      ? selectFocusDetailIfCurrent(focusQueueState, convoDetail)
      : (convoDetail ?? null);
  const messages = useMemo(
    () =>
      [...(activeConversationDetail?.messages ?? [])].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [activeConversationDetail?.messages],
  );
  const threadSearchQuery = threadSearch.trim().toLowerCase();
  const threadSearchMatches = useMemo(() => {
    if (!threadSearchQuery) return [];
    return messages.filter(
      (message) =>
        message.role !== "system" &&
        message.content.toLowerCase().includes(threadSearchQuery),
    );
  }, [messages, threadSearchQuery]);
  const threadSearchMatchIds = threadSearchMatches.map((message) => message.id);
  const threadSearchSafeIndex = threadSearchMatchIds.length
    ? Math.min(threadSearchMatchIndex, threadSearchMatchIds.length - 1)
    : 0;
  const threadSearchActiveMatchId =
    threadSearchMatchIds[threadSearchSafeIndex] ?? null;

  useEffect(() => {
    setThreadSearchMatchIndex(0);
  }, [threadSearchQuery]);

  const selected =
    activeConversationDetail?.conversation ??
    conversations.find((c) => c.id === activeConversationId) ??
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

  const sidechatDraft = activeConversationId
    ? sidechatDrafts[activeConversationId] ?? ""
    : "";
  const sendingMavenDraftMessageId =
    sendMavenDraft.isPending &&
      sendMavenDraft.variables?.conversationId === activeConversationId
      ? sendMavenDraft.variables.sourceMessageId
      : null;
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
    if (!activeConversationId) return;
    setCustomerMutation.mutate({
      conversationId: activeConversationId,
      customerId: customer.id,
    });
  }

  function handleSend(
    content?: string,
    opts?: { imageUrls?: string[] },
  ) {
    const text = (content ?? draft).trim();
    const imageUrls = opts?.imageUrls ?? [];
    if (!text && imageUrls.length === 0) return;
    if (!activeConversationId) return;
    sendReply.mutate({
      conversationId: activeConversationId,
      content: text,
      imageUrls,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function handleSendEmail(messageId: string) {
    if (!activeConversationId) return;
    sendEmail.mutate({ conversationId: activeConversationId, messageId });
  }

  function setSelectedSidechatDraft(value: SetStateAction<string>): void {
    if (!activeConversationId) return;
    const conversationId = activeConversationId;
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
    if (!activeConversationId || !selected) return;
    if (
      view === "focus" &&
      focusQueueStateRef.current.kind !== "reviewing"
    ) {
      return;
    }
    const entry = planSidechatEntry({
      archived: Boolean(selected.archivedAt),
      exists: selectedSidechatExists,
      conversationId: activeConversationId,
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

  function handleSendAsMaven(sourceMessageId: string): void {
    if (
      !activeConversationId ||
      selected?.archivedAt ||
      sendMavenDraft.isPending
    ) {
      return;
    }
    sendMavenDraft.mutate({
      conversationId: activeConversationId,
      sourceMessageId,
    });
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
      selectedConversationId: activeConversationId,
      currentPublicDraft: draft,
    });
    if (result.nextDraft !== draft) setDraft(result.nextDraft);
    if (result.transfer !== pendingSidechatTransfer) {
      setPendingSidechatTransfer(result.transfer);
    }
  }

  async function runFocusAwareAction(
    execution: FocusActionExecution,
  ): Promise<void> {
    const nowMs = Date.now();
    const preview = previewFocusConversationAction(
      execution.conversation,
      execution.action,
      nowMs,
    );
    const currentState = focusQueueStateRef.current;
    const isCurrentFocusConversation =
      view === "focus" &&
      currentState.kind === "reviewing" &&
      currentFocusConversationId(currentState) === execution.conversation.id;
    if (view === "focus" && !isCurrentFocusConversation) return;
    const leavesFilter =
      isCurrentFocusConversation &&
      !passesInboxFilter(filter, preview, nowMs);

    if (!leavesFilter) {
      await execution.mutate().catch(() => undefined);
      return;
    }

    const transactionId = crypto.randomUUID();
    dispatchFocusQueue({
      type: "DEPARTURE_STARTED",
      transactionId,
      action: execution.departureAction,
      reducedMotion: prefersReducedMotion(),
    });
    setSidechatOpen(false);

    try {
      await execution.mutate();
      dispatchFocusQueue({ type: "MUTATION_SUCCEEDED", transactionId });
    } catch {
      dispatchFocusQueue({ type: "MUTATION_FAILED", transactionId });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["conversation-detail", execution.conversation.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["inbox-counts", projectId],
        }),
      ]);
    }
  }

  function handleResolve(convId: string) {
    const conv = findConv(convId);
    if (!conv) return;
    if (conv.status === "closed" && conv.closeReason !== "spam") {
      void runFocusAwareAction({
        conversation: conv,
        action: { type: "reopen" },
        departureAction: "reopen",
        mutate: () => reopenConversation.mutateAsync({ convId }),
      });
      return;
    }
    void runFocusAwareAction({
      conversation: conv,
      action: { type: "resolve" },
      departureAction: "resolve",
      mutate: () =>
        closeConversation.mutateAsync({ convId, closeReason: "resolved" }),
    });
  }

  function handleFlagSpam(convId: string) {
    const conv = findConv(convId);
    if (!conv) return;
    if (conv.closeReason === "spam") {
      void runFocusAwareAction({
        conversation: conv,
        action: { type: "unflag" },
        departureAction: "unflag",
        mutate: () => reopenConversation.mutateAsync({ convId }),
      });
      return;
    }
    void runFocusAwareAction({
      conversation: conv,
      action: { type: "spam" },
      departureAction: "spam",
      mutate: () =>
        closeConversation.mutateAsync({ convId, closeReason: "spam" }),
    });
  }

  function handleSnooze(convId: string, until: number | null) {
    const conv = findConv(convId);
    if (!conv) return;
    void runFocusAwareAction({
      conversation: conv,
      action: { type: "snooze", until },
      departureAction: until === null ? "unsnooze" : "snooze",
      mutate: () => snoozeConversation.mutateAsync({ convId, until }),
    });
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
    const conv = findConv(convId);
    if (!conv) return;
    void runFocusAwareAction({
      conversation: conv,
      action: { type: action },
      departureAction: action,
      mutate: () =>
        bulkConversationMutation.mutateAsync({
          conversationIds: [convId],
          action: { action },
        }),
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
    if (!activeConversationId) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${activeConversationId}/messages/${messageId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete message");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", activeConversationId],
      });
      toast.success("Message deleted");
    } catch {
      toast.error("Failed to delete message");
    }
  }

  function handleBlock(convId: string) {
    const conv =
      (convoDetail?.conversation?.id === convId
        ? convoDetail.conversation
        : null) ?? conversations.find((c) => c.id === convId);
    if (!conv) return;
    if (conv.visitorBlocked) {
      void runFocusAwareAction({
        conversation: conv,
        action: { type: "unblock" },
        departureAction: "unblock",
        mutate: () => unblockVisitor.mutateAsync({ convId }),
      });
      return;
    }
    void runFocusAwareAction({
      conversation: conv,
      action: { type: "block" },
      departureAction: "block",
      mutate: () =>
        blockVisitor.mutateAsync({
          visitorId: conv.visitorId,
          ...(conv.visitorEmail ? { visitorEmail: conv.visitorEmail } : {}),
          conversationId: convId,
        }),
    });
  }

  function selectRelative(delta: number) {
    if (view === "focus") {
      clearBulkSelection();
      dispatchFocusQueue({
        type: "MOVE",
        direction: delta > 0 ? "next" : "previous",
      });
      return;
    }
    if (conversations.length === 0) return;
    const newIndex = Math.max(
      0,
      Math.min(conversations.length - 1, selectedIndex + delta),
    );
    clearBulkSelection();
    setSelectedConvo(conversations[newIndex].id);
  }

  function exitFocus(): void {
    const currentId = currentFocusConversationId(focusQueueStateRef.current);
    setSelectedConvo(currentId);
    dispatchFocusQueue({ type: "EXIT" });
    focusSessionKeyRef.current = null;
    setView("split");
  }

  function continueFocus(): void {
    dispatchFocusQueue({
      type: "CONTINUE",
      visible: focusCards,
      selectedId: focusCards[0]?.id ?? null,
      knownTotal: focusKnownTotal,
      hasMore: focusHasMore,
    });
  }

  function retryFocusRefill(): void {
    const state = focusQueueStateRef.current;
    if (
      state.kind !== "loading" &&
      state.kind !== "checking-queue"
    ) {
      return;
    }
    const nextLimit = listLimit + 25;
    focusRefillTargetRef.current = nextLimit;
    setListLimit(nextLimit);
  }

  function handleFocusMotionFinished(): void {
    const state = focusQueueStateRef.current;
    if (state.kind !== "departing") return;
    dispatchFocusQueue({
      type: "MOTION_FINISHED",
      transactionId: state.departure.transactionId,
    });
  }

  function handleFocusRollbackMotionFinished(): void {
    const state = focusQueueStateRef.current;
    if (state.kind !== "rolling-back") return;
    dispatchFocusQueue({
      type: "ROLLBACK_MOTION_FINISHED",
      transactionId: state.departure.transactionId,
    });
  }

  function extendRange(direction: "next" | "previous") {
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
      direction: direction === "next" ? 1 : -1,
    });
    setSelectedIds(result.selectedIds);
    setSelectionAnchorId(anchorId);
    setSelectionFocusId(result.focusId);
    if (result.focusId) setSelectedConvo(result.focusId);
  }

  function stepThreadSearchMatch(delta: number) {
    if (threadSearchMatchIds.length === 0) return;
    setThreadSearchMatchIndex((index) => {
      const length = threadSearchMatchIds.length;
      return (((index + delta) % length) + length) % length;
    });
  }

  function handlePickThreadSearchMatch(messageId: string) {
    const index = threadSearchMatchIds.indexOf(messageId);
    if (index >= 0) setThreadSearchMatchIndex(index);
    setThreadSearchOpen(false);
  }

  function executeInboxCommand(intent: DashboardCommandIntent) {
    if (intent.type === "toggle-command-menu" || intent.type === "navigate") {
      return;
    }
    if (intent.type === "open-conversation-search") {
      setThreadSearchOpen(true);
      return;
    }
    if (intent.type === "set-focus") {
      if (intent.focus) setView("focus");
      else exitFocus();
      return;
    }
    if (intent.type === "open-sidechat") {
      handleStartSidechat();
      return;
    }
    if (intent.type === "conversation-action") {
      const { conversationId, action } = intent;
      if (action.type === "resolve" || action.type === "reopen") {
        handleResolve(conversationId);
        return;
      }
      if (action.type === "snooze") {
        handleSnooze(conversationId, Date.now() + 86_400_000);
        return;
      }
      if (action.type === "unsnooze") {
        handleSnooze(conversationId, null);
        return;
      }
      if (action.type === "flag-spam" || action.type === "unflag") {
        handleFlagSpam(conversationId);
        return;
      }
      if (action.type === "archive" || action.type === "unarchive") {
        handleArchive(conversationId, action.type);
        return;
      }
      handleBlock(conversationId);
      return;
    }
    if (intent.type === "bulk-action") {
      const { action } = intent;
      if (action.type === "resolve") {
        handleBulkAction({ action: "resolve" });
        return;
      }
      if (action.type === "snooze") {
        handleBulkAction({
          action: "snooze",
          until: action.until === "tomorrow" ? Date.now() + 86_400_000 : null,
        });
        return;
      }
      if (action.type === "flag-spam") {
        handleBulkAction({ action: "flag_spam" });
        return;
      }
      handleBulkAction({ action: action.type });
      return;
    }
    if (intent.type === "move-ticket") {
      selectRelative(intent.direction === "next" ? 1 : -1);
      return;
    }
    if (intent.type === "extend-range") {
      extendRange(intent.direction);
      return;
    }
    if (intent.type === "clear-selection") {
      clearBulkSelection();
      return;
    }
    if (intent.type === "exit-focus") {
      exitFocus();
      return;
    }
    const _exhaustive: never = intent;
    void _exhaustive;
  }

  const inboxSelection = useMemo(
    () => buildInboxSelection(selected, selectedIds, conversations),
    [conversations, selected, selectedIds],
  );
  const inboxScope = useMemo((): InboxCommandScope | null => {
    if (!projectId) return null;
    return {
      kind: "inbox",
      projectId,
      filter,
      selection: inboxSelection,
      view: { kind: view, sidechat: sidechatOpen ? "open" : "closed" },
      viewport: isMobileViewport ? "mobile" : "desktop",
      operations: ALL_INBOX_CAPABILITIES,
    };
  }, [
    filter,
    inboxSelection,
    isMobileViewport,
    projectId,
    sidechatOpen,
    view,
  ]);
  const executeInboxCommandRef = useRef(executeInboxCommand);
  executeInboxCommandRef.current = executeInboxCommand;
  const executeInboxCommandStable = useCallback((intent: DashboardCommandIntent) => {
    executeInboxCommandRef.current(intent);
  }, []);
  const inboxCommandRegistration = useMemo(() => {
    if (inboxScope == null) return null;
    return { scope: inboxScope, execute: executeInboxCommandStable };
  }, [executeInboxCommandStable, inboxScope]);
  useRegisterInboxCommands(inboxCommandRegistration);

  // ── Render ────────────────────────────────────────────────────────────────
  // Keep the pane mounted on the last session for this conversation even if
  // the token has gone stale: the open socket keeps working, and the session
  // query delivers a fresh token before the next reconnect needs one.
  // Unmounting here destroys the chat state and shows a skeleton wall.
  const matchingSidechatSession = selected &&
      sidechatSession.data?.childName === `sc_${selected.id}`
    ? sidechatSession.data
    : null;
  const sidechatPane = selected
    ? matchingSidechatSession
      ? (
        <NativeSidechatPane
          key={`${projectId}:${selected.id}`}
          open={sidechatOpen}
          conversation={selected}
          customerFirstName={customerFirstName}
          session={matchingSidechatSession}
          summaryStatus={selectedSidechatStatus}
          transfer={pendingSidechatTransfer}
          draft={sidechatDraft}
          setDraft={setSelectedSidechatDraft}
          onSubmissionStarted={handleSidechatSubmissionStarted}
          onInitialSubmissionSkipped={handleInitialSidechatSubmissionSkipped}
          onTurnAccepted={handleSidechatTurnAccepted}
          onAddToReply={handleAddToReply}
          onSendAsMaven={handleSendAsMaven}
          sendingMavenDraftMessageId={sendingMavenDraftMessageId}
          mavenDraftSendPending={sendMavenDraft.isPending}
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
          onSendAsMaven={handleSendAsMaven}
          sendingMavenDraftMessageId={sendingMavenDraftMessageId}
          mavenDraftSendPending={sendMavenDraft.isPending}
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

  const conversationSearchDialog = (
    <ConversationSearchDialog
      open={threadSearchOpen}
      onOpenChange={setThreadSearchOpen}
      query={threadSearch}
      onQueryChange={setThreadSearch}
      results={threadSearchMatches}
      onPick={handlePickThreadSearchMatch}
      onMatchNext={() => stepThreadSearchMatch(1)}
      onMatchPrev={() => stepThreadSearchMatch(-1)}
    />
  );

  if (view === "focus") {
    const hasCurrentFocusDetail =
      focusViewModel.currentCard !== null &&
      activeConversationDetail?.conversation.id ===
        focusViewModel.currentCard.id;
    const showFocusRenderer =
      focusViewModel.phase === "all-done" || hasCurrentFocusDetail;
    const focusRefillFailed =
      (focusQueueState.kind === "loading" ||
        focusQueueState.kind === "checking-queue") &&
      focusQueueState.refillFailed;
    const focusView = showFocusRenderer ? (
      <FocusView
        viewModel={focusViewModel}
        conversation={activeConversationDetail?.conversation ?? null}
        messages={messages}
        messagesLoading={detailLoading}
        reducedMotion={focusReducedMotion}
        onExit={exitFocus}
        onContinue={continueFocus}
        onMotionFinished={handleFocusMotionFinished}
        onRollbackMotionFinished={handleFocusRollbackMotionFinished}
        onSend={handleSend}
        onResolve={handleResolve}
        onDeleteMessage={handleDeleteMessage}
        onSendEmail={handleSendEmail}
        draft={draft}
        setDraft={setDraft}
        onStartSidechat={handleStartSidechat}
        sidechatOpen={sidechatOpen}
        sidechatExists={selectedSidechatExists}
        sidechatStatus={selectedSidechatStatus}
        publicComposerFocusRequest={publicComposerFocusRequest}
        searchQuery={threadSearchQuery}
        activeMatchId={threadSearchActiveMatchId}
        embedded
      />
    ) : (
      <FocusViewSkeleton
        embedded
        onRetry={focusRefillFailed ? retryFocusRefill : undefined}
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
        {publicChatSession.data && activeConversationId && (
          <NativePublicConversationBridge
            session={publicChatSession.data}
            conversationId={activeConversationId}
            onMessages={handleNativePublicMessages}
            onState={handleNativePublicState}
          />
        )}
        <FocusSidechatLayout
          sidechatOpen={sidechatOpen}
          focusView={focusView}
          sidechatPane={sidechatPane}
        />
        {conversationSearchDialog}
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
          onSendEmail={handleSendEmail}
          onBack={() => setSelectedConvo(null)}
          onStartSidechat={handleStartSidechat}
          sidechatOpen={sidechatOpen}
          sidechatExists={selectedSidechatExists}
          sidechatStatus={selectedSidechatStatus}
          publicComposerFocusRequest={publicComposerFocusRequest}
          search={threadSearch}
          onSearchChange={setThreadSearch}
          matchCount={threadSearchMatchIds.length}
          matchIndex={threadSearchMatchIds.length ? threadSearchSafeIndex + 1 : 0}
          onMatchNext={() => stepThreadSearchMatch(1)}
          onMatchPrev={() => stepThreadSearchMatch(-1)}
          onOpenSearch={() => setThreadSearchOpen(true)}
          searchQuery={threadSearchQuery}
          activeMatchId={threadSearchActiveMatchId}
          className={cn(
            selectedIds.size > 0 && "hidden md:flex",
            sidechatOpen && "hidden md:flex",
          )}
          // `?msg=` deep-link scroll+pulse target.
          highlightMessageId={highlightMsgId}
        />
      ) : (
        <InboxEmptyPane
          filter={filter}
          search={searchQuery}
          counts={counts}
          unreadOnly={unreadOnly}
          hasConversations={conversations.length > 0}
          isLoading={convosLoading || isPlaceholderData}
        />
      )}
      {sidechatPane}
      {sidechatSummarySession.data && (
        <ConversationDirectoryAgentBridge
          session={sidechatSummarySession.data}
          onState={handleSidechatParentState}
          onEvent={handleDirectoryEvent}
        />
      )}
      {publicChatSession.data && activeConversationId && (
        <NativePublicConversationBridge
          session={publicChatSession.data}
          conversationId={activeConversationId}
          onMessages={handleNativePublicMessages}
          onState={handleNativePublicState}
        />
      )}

      <CustomerFormDialog
        projectId={projectId!}
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        initialValues={customerFormInitialValues}
        conversationId={activeConversationId ?? undefined}
        onCreated={handleCustomerCreated}
      />
      <CustomerPickerDialog
        projectId={projectId!}
        open={linkCustomerOpen}
        onOpenChange={setLinkCustomerOpen}
        onSelect={handleCustomerSelected}
        pending={setCustomerMutation.isPending}
      />
      {conversationSearchDialog}
    </div>
  );
}

export default Conversations;
