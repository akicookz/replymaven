import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare,
  Send,
  Bot,
  Headphones,
  XCircle,
  Search,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Globe,
  Monitor,
  Wrench,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  LogOut,
  ShieldBan,
  Tag,
  FileText,
  Mail,
  MailCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MobileMenuButton } from "@/components/PageHeader";
import { DetailsPanel } from "@/components/DetailsPanel";
import {
  getConversationActivityTimestamp,
  getVisitorPresenceState,
  type VisitorPresenceState,
} from "@/lib/conversation-presence";
import { cn, renderMarkdown } from "@/lib/utils";
import { useConversationWs } from "@/lib/use-conversation-ws";

interface ConversationMeta {
  url?: string;
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  ip?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  device?: string;
  screenResolution?: string;
  language?: string;
  referrer?: string;
  currentPageUrl?: string;
  pageTitle?: string;
  online?: string;
  [key: string]: unknown;
}

interface LastMessagePreview {
  id: string;
  role: "visitor" | "bot" | "agent";
  content: string;
  senderName: string | null;
  emailedAt: string | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  closeReason: string | null;
  metadata: string | null;
  visitorLastSeenAt: string | null;
  visitorPresence: string | null;
  visitorLastOnlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string | null;
  lastMessage?: LastMessagePreview | null;
}

interface ConversationsPage {
  conversations: Conversation[];
  counts: { all: number; open: number; closed: number };
  hasMore: boolean;
  serverTime?: number;
}

interface ConversationUpdate {
  id: string;
  projectId: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  closeReason: string | null;
  metadata: string | null;
  lastActivityAt: string;
  visitorLastSeenAt: string | null;
  visitorPresence: string | null;
  visitorLastOnlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: LastMessagePreview | null;
}

interface ConversationUpdatesResponse {
  updates: ConversationUpdate[];
  counts: { all: number; open: number; closed: number };
  serverTime: number;
}

interface ToolExecutionInfo {
  id: string;
  toolName: string;
  displayName: string;
  method: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  status: "success" | "error" | "timeout";
  httpStatus: number | null;
  duration: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Message {
  id: string;
  role: "visitor" | "bot" | "agent";
  content: string;
  sources?: string | null;
  senderName?: string | null;
  senderAvatar?: string | null;
  userId?: string | null;
  createdAt: string;
  emailedAt?: string | null;
  toolExecutions?: ToolExecutionInfo[];
}

interface SourceReference {
  title: string;
  url?: string | null;
  type?: "webpage" | "pdf" | "faq";
}


interface ConversationInquiry {
  id: string;
  data: Record<string, string>;
  status: string;
  createdAt: string;
}

type ThreadItem =
  | {
    kind: "message";
    id: string;
    createdAt: string;
    message: Message;
  }
  | {
    kind: "inquiry";
    id: string;
    createdAt: string;
    inquiry: ConversationInquiry;
    fields: Array<[string, string]>;
  };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMeta(metadata: string | null): ConversationMeta {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

const SYSTEM_META_KEYS = new Set([
  "url",
  "country",
  "city",
  "region",
  "timezone",
  "ip",
  "userAgent",
  "browser",
  "os",
  "device",
  "screenResolution",
  "language",
  "referrer",
  "currentPageUrl",
  "pageTitle",
  "online",
  "agentHandbackInstructions",
  "teamRequestPending",
  "teamRequestSubmittedAt",
  "teamRequestSubmissionId",
  "teamRequestSummary",
]);

function splitMetadata(meta: ConversationMeta): {
  system: Record<string, string>;
  custom: Record<string, string>;
} {
  const system: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null || value === "") continue;
    const strVal = String(value);
    if (SYSTEM_META_KEYS.has(key)) {
      system[key] = strVal;
    } else {
      custom[key] = strVal;
    }
  }
  return { system, custom };
}

function parseBrowserName(ua?: string, browserField?: string): string {
  if (browserField) return browserField;
  if (!ua) return "Unknown";
  if (ua.includes("Firefox/")) {
    const match = ua.match(/Firefox\/([\d.]+)/);
    return match ? `Firefox ${match[1].split(".")[0]}` : "Firefox";
  }
  if (ua.includes("Edg/")) {
    const match = ua.match(/Edg\/([\d.]+)/);
    return match ? `Edge ${match[1].split(".")[0]}` : "Edge";
  }
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) {
    const match = ua.match(/Chrome\/([\d.]+)/);
    return match ? `Chrome ${match[1].split(".")[0]}` : "Chrome";
  }
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) {
    const match = ua.match(/Version\/([\d.]+)/);
    return match ? `Safari ${match[1].split(".")[0]}` : "Safari";
  }
  return "Unknown";
}

function countryToFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const base = 0x1f1e6;
  const first = countryCode.charCodeAt(0) - 65 + base;
  const second = countryCode.charCodeAt(1) - 65 + base;
  return String.fromCodePoint(first) + String.fromCodePoint(second);
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startStr: string): string {
  const now = Date.now();
  const start = new Date(startStr).getTime();
  const diffMs = now - start;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just started";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffHr < 24) return `${diffHr}h ${diffMin % 60}m`;
  return `${diffDay}d ${diffHr % 24}h`;
}

function getVisitorDisplayName(convo: Conversation): string {
  if (convo.visitorName) return convo.visitorName;
  if (convo.visitorEmail) return convo.visitorEmail.split("@")[0];
  return convo.visitorId;
}

function getPresenceDotClass(state: VisitorPresenceState): string {
  switch (state) {
    case "online":
      return "bg-emerald-500";
    case "background":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function getPresenceBadge(state: VisitorPresenceState): {
  label: string;
  dotClass: string;
  badgeClass: string;
} {
  switch (state) {
    case "online":
      return {
        label: "Online",
        dotClass: "bg-emerald-500",
        badgeClass: "text-emerald-600 bg-emerald-500/10",
      };
    case "background":
      return {
        label: "In Background",
        dotClass: "bg-amber-500",
        badgeClass: "text-amber-600 bg-amber-500/10",
      };
    default:
      return {
        label: "Offline",
        dotClass: "bg-muted-foreground/50",
        badgeClass: "text-muted-foreground bg-muted/50",
      };
  }
}

function getConversationActivityLabel(convo: Pick<
  Conversation,
  "visitorLastSeenAt" | "updatedAt"
>): string {
  const activityAt =
    getConversationActivityTimestamp({
      visitorLastSeenAt: convo.visitorLastSeenAt,
      updatedAt: convo.updatedAt,
    }) ?? new Date(convo.updatedAt).getTime();

  return timeAgo(new Date(activityAt).toISOString());
}

function buildConversationThread(
  messages: Message[],
  inquiry: ConversationInquiry | null,
): ThreadItem[] {
  const threadItems: ThreadItem[] = messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
  }));

  if (inquiry) {
    const hiddenKeys = new Set(["Conversation ID", "Recent chat", "Type"]);
    const fields = Object.entries(inquiry.data).filter(
      ([key]) => !hiddenKeys.has(key),
    );

    threadItems.push({
      kind: "inquiry",
      id: `inquiry:${inquiry.id}`,
      createdAt: inquiry.createdAt,
      inquiry,
      fields,
    });
  }

  return threadItems.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function getStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "waiting_agent":
      return "Pending human";
    case "agent_replied":
      return "Agent engaged";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

function getCloseReasonLabel(reason: string | null): string {
  switch (reason) {
    case "resolved":
      return "Resolved";
    case "ended":
      return "Ended";
    case "spam":
      return "Spam";
    case "bot_resolved":
      return "Resolved by bot";
    default:
      return "Closed";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

function Conversations() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(
    searchParams.get("id"),
  );
  const [replyText, setReplyText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("all");
  const [expandedToolCards, setExpandedToolCards] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync selectedConvo <-> ?id= URL param so deep links work and shares are stable
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

  const [loadedConversations, setLoadedConversations] = useState<Conversation[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [serverTimeBaseline, setServerTimeBaseline] = useState<number | null>(null);

  // Debounce search input so we don't fire a request per keystroke. The
  // backend endpoint searches across ALL conversations (not just the 25
  // already loaded), so server-side search is required for correctness.
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Open a WebSocket for the selected conversation. The hook patches the
  // ["conversation-detail", id] cache on incoming events so messages and
  // status changes appear in real time without polling.
  useConversationWs(projectId, selectedConvo);

  // Per-project client-side last-read tracking for unread badges
  const lastReadStorageKey = `replymaven:lastRead:${projectId ?? "unknown"}`;
  const [lastReadMap, setLastReadMap] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(`replymaven:lastRead:${projectId ?? "unknown"}`);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });

  function persistLastReadMap(next: Record<string, number>) {
    setLastReadMap(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(lastReadStorageKey, JSON.stringify(next));
      } catch {
        // ignore storage errors (quota, private mode)
      }
    }
  }

  function markConversationRead(convId: string) {
    const next = { ...lastReadMap, [convId]: Date.now() };
    persistLastReadMap(next);
  }

  function getActivityMs(convo: Conversation): number {
    const raw = convo.lastActivityAt ?? convo.updatedAt;
    const ms = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  }

  function isUnread(convo: Conversation): boolean {
    if (convo.status === "closed") return false;
    if (selectedConvo === convo.id) return false;
    const activity = getActivityMs(convo);
    const read = lastReadMap[convo.id] ?? 0;
    return activity > read;
  }

  const { data: convosPage, isLoading } = useQuery<ConversationsPage>({
    queryKey: ["conversations", projectId, statusFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: "25",
        offset: "0",
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

  // Sync first page into loaded conversations and handle filter changes
  useEffect(() => {
    if (convosPage?.conversations) {
      setLoadedConversations(convosPage.conversations);
      setHasMore(convosPage.hasMore);
    }
    if (convosPage?.serverTime) {
      setServerTimeBaseline(convosPage.serverTime);
    }
  }, [convosPage, statusFilter]);

  // Lightweight polling: only fetch conversation updates (id + activity),
  // not the entire list. Patch the local list in place to avoid UI jank.
  const { data: updatesData } = useQuery<ConversationUpdatesResponse>({
    queryKey: ["conversation-updates", projectId, serverTimeBaseline],
    queryFn: async () => {
      const since = serverTimeBaseline ?? 0;
      const res = await fetch(
        `/api/projects/${projectId}/conversations/updates?since=${since}`,
      );
      if (!res.ok) throw new Error("Failed to fetch updates");
      return res.json();
    },
    enabled: !!projectId && serverTimeBaseline != null,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  // Merge incoming updates into the local list without any opacity/fetch jank.
  // The delta endpoint now returns full sidebar-renderable rows, so we can
  // prepend conversations that aren't in the loaded list — closing the
  // "off-page conversation drops" hole.
  useEffect(() => {
    if (!updatesData) return;

    // Advance the baseline so the next poll is a small delta
    if (updatesData.serverTime) {
      setServerTimeBaseline(updatesData.serverTime);
    }

    if (updatesData.updates.length === 0) return;

    const passesFilter = (status: string): boolean => {
      if (statusFilter === "all") return true;
      if (statusFilter === "closed") return status === "closed";
      // "open" filter excludes closed
      return status !== "closed";
    };

    const updateMap = new Map(updatesData.updates.map((u) => [u.id, u]));

    setLoadedConversations((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      let changed = false;

      // 1. Patch existing rows in place
      const next: Conversation[] = prev.map((c) => {
        const u = updateMap.get(c.id);
        if (!u) return c;
        changed = true;
        updateMap.delete(c.id);
        return { ...c, ...u };
      });

      // 2. Prepend brand-new conversations that match the active filter.
      //    (Was previously dropped — the bug.)
      for (const u of updateMap.values()) {
        if (seen.has(u.id)) continue;
        if (!passesFilter(u.status)) continue;
        changed = true;
        next.push(u as Conversation);
      }

      if (!changed) return prev;
      // Re-sort by activity desc so freshly active convos float to the top
      next.sort((a, b) => getActivityMs(b) - getActivityMs(a));
      return next;
    });

    // Also patch the cached query data so status-filter switches stay consistent
    queryClient.setQueryData<ConversationsPage | undefined>(
      ["conversations", projectId, statusFilter, debouncedSearch],
      (old) => {
        if (!old) return old;
        const seen = new Set(old.conversations.map((c) => c.id));
        const patched = old.conversations.map((c) => {
          const u = updatesData.updates.find((x) => x.id === c.id);
          return u ? { ...c, ...u } : c;
        });
        // Prepend new conversations into the cached page too
        for (const u of updatesData.updates) {
          if (seen.has(u.id)) continue;
          if (!passesFilter(u.status)) continue;
          patched.push(u as Conversation);
        }
        patched.sort((a, b) => getActivityMs(b) - getActivityMs(a));
        return { ...old, counts: updatesData.counts, conversations: patched };
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatesData]);

  const loadMoreConversations = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: "25",
        offset: String(loadedConversations.length),
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      const res = await fetch(
        `/api/projects/${projectId}/conversations?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ conversations: Conversation[]; counts: { all: number; open: number; closed: number }; hasMore: boolean }>;
    },
    onSuccess: (data) => {
      setLoadedConversations((prev) => [...prev, ...data.conversations]);
      setHasMore(data.hasMore);
    },
  });

  const {
    data: convoDetail,
    isPending: isDetailLoading,
    isError: isDetailError,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<{
    conversation: Conversation;
    messages: Message[];
    hasMore: boolean;
    botName: string | null;
    agentName: string | null;
    inquiry: ConversationInquiry | null;
  }>({
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
    // Conversation detail is kept fresh in real time by useConversationWs.
    // Cache for 60s so revisiting a conversation is instant; the WS push
    // keeps the cache current within that window. Dropping keepPreviousData
    // means switching to a never-loaded conversation shows the skeleton
    // instead of flashing the previous conversation's messages.
    staleTime: 1000 * 60,
  });

  // Mark the open conversation as read whenever its latest activity advances
  useEffect(() => {
    if (!selectedConvo) return;
    const activity = convoDetail?.conversation
      ? getActivityMs(convoDetail.conversation as Conversation)
      : Date.now();
    const current = lastReadMap[selectedConvo] ?? 0;
    if (activity > current) {
      const next = { ...lastReadMap, [selectedConvo]: activity };
      persistLastReadMap(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvo, convoDetail?.conversation?.lastActivityAt, convoDetail?.conversation?.updatedAt]);

  const loadEarlier = useMutation({
    mutationFn: async () => {
      if (!selectedConvo || !convoDetail?.messages?.length) {
        return { messages: [] as Message[], hasMore: false };
      }
      const oldest = convoDetail.messages[0];
      // Capture scroll position before fetching so we can restore after
      // prepending. Stored on the mutation context via a ref-like trick
      // (we use the container's scrollHeight before prepend in onSuccess).
      const params = new URLSearchParams({
        before: oldest.createdAt,
        limit: "30",
      });
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/messages?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to load earlier messages");
      return res.json() as Promise<{ messages: Message[]; hasMore: boolean }>;
    },
    onMutate: () => {
      // Snapshot scroll metrics before the new render
      const el = messagesContainerRef.current;
      return el
        ? { prevScrollHeight: el.scrollHeight, prevScrollTop: el.scrollTop }
        : null;
    },
    onSuccess: (data, _vars, ctx) => {
      if (data.messages.length === 0) {
        queryClient.setQueryData(
          ["conversation-detail", selectedConvo],
          (old: typeof convoDetail | undefined) => {
            if (!old) return old;
            return { ...old, hasMore: data.hasMore };
          },
        );
        return;
      }
      queryClient.setQueryData(
        ["conversation-detail", selectedConvo],
        (old: typeof convoDetail | undefined) => {
          if (!old) return old;
          // Dedupe just in case (shouldn't happen but cheap insurance)
          const existingIds = new Set(old.messages.map((m) => m.id));
          const fresh = data.messages.filter((m) => !existingIds.has(m.id));
          return {
            ...old,
            messages: [...fresh, ...old.messages],
            hasMore: data.hasMore,
          };
        },
      );
      // Restore scroll position so the user stays anchored to the same
      // message they were looking at before we prepended.
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (!el || !ctx) return;
        const heightDelta = el.scrollHeight - ctx.prevScrollHeight;
        el.scrollTop = ctx.prevScrollTop + heightDelta;
      });
    },
    onError: () => {
      toast.error("Couldn't load earlier messages");
    },
  });

  const sendReply = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (!res.ok) throw new Error("Failed to send reply");
      return res.json();
    },
    onMutate: async (content: string) => {
      await queryClient.cancelQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      const previous = queryClient.getQueryData<{
        conversation: Conversation;
        messages: Message[];
        botName: string | null;
        agentName: string | null;
        inquiry: ConversationInquiry | null;
      }>(["conversation-detail", selectedConvo]);

      queryClient.setQueryData(
        ["conversation-detail", selectedConvo],
        (old: typeof previous) => {
          if (!old) return old;
          return {
            ...old,
            conversation: { ...old.conversation, status: "agent_replied" },
            messages: [
              ...old.messages,
              {
                id: `optimistic-${Date.now()}`,
                conversationId: selectedConvo,
                role: "agent",
                content,
                createdAt: new Date().toISOString(),
                sources: null,
                senderName: null,
                senderAvatar: null,
                toolExecutions: [],
                _optimistic: true,
                _status: "sending" as const,
              },
            ],
          };
        },
      );

      setReplyText("");
      return { previous };
    },
    onError: (_err, _content, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["conversation-detail", selectedConvo],
          context.previous,
        );
      }
      toast.error("Failed to send reply");
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

  const sendEmail = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/send-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to send email");
      }
      return res.json() as Promise<{ ok: boolean; emailedAt: string }>;
    },
    onSuccess: (data, messageId) => {
      queryClient.setQueryData(
        ["conversation-detail", selectedConvo],
        (old: { conversation: Conversation; messages: Message[]; botName: string | null; agentName: string | null; inquiry: ConversationInquiry | null } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((m) =>
              m.id === messageId ? { ...m, emailedAt: data.emailedAt } : m,
            ),
          };
        },
      );
      toast.success("Email sent");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const banVisitor = useMutation({
    mutationFn: async ({
      convId,
      visitorId,
      visitorEmail,
    }: {
      convId: string;
      visitorId: string;
      visitorEmail: string | null;
    }) => {
      const res = await fetch(`/api/projects/${projectId}/visitors/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId,
          visitorEmail: visitorEmail ?? undefined,
          conversationId: convId,
          reason: "Banned from dashboard",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Failed to ban visitor");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Visitor banned");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
    onError: (err: Error) => toast.error(err.message),
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
      const previousDetail = queryClient.getQueryData(["conversation-detail", convId]);
      const previousList = queryClient.getQueryData(["conversations", projectId, statusFilter]);

      queryClient.setQueryData(
        ["conversation-detail", convId],
        (old: typeof previousDetail & { conversation?: Conversation }) => {
          if (!old || !("conversation" in (old as Record<string, unknown>))) return old;
          const o = old as { conversation: Conversation; messages: Message[]; botName: string | null; agentName: string | null; inquiry: ConversationInquiry | null };
          return { ...o, conversation: { ...o.conversation, status: "closed", closeReason } };
        },
      );

      queryClient.setQueryData(
        ["conversations", projectId, statusFilter],
        (old: { conversations: Conversation[]; counts: { all: number; open: number; closed: number }; hasMore: boolean } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            conversations: old.conversations.map((c) =>
              c.id === convId ? { ...c, status: "closed", closeReason } : c,
            ),
          };
        },
      );

      // Also update local loaded state
      setLoadedConversations((prev) =>
        prev.map((c) => c.id === convId ? { ...c, status: "closed", closeReason } : c),
      );

      return { previousDetail, previousList };
    },
    onError: (_err, { convId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(["conversation-detail", convId], context.previousDetail);
      }
      if (context?.previousList) {
        queryClient.setQueryData(["conversations", projectId, statusFilter], context.previousList);
      }
      toast.error("Failed to close conversation");
    },
    onSettled: (_data, _error, { convId }) => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", convId],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const threadItems = useMemo(
    () => convoDetail
      ? buildConversationThread(convoDetail.messages, convoDetail.inquiry)
      : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convoDetail?.messages, convoDetail?.inquiry],
  );
  const threadSignature = useMemo(
    () => threadItems
      .map((item) => `${item.kind}:${item.id}:${item.createdAt}`)
      .join("|"),
    [threadItems],
  );

  // Auto-scroll to bottom when the thread actually changes.
  // - On a conversation switch: jump instantly (no animation) — smooth-scroll
  //   on switch feels like a stall.
  // - On a new message in the same conversation: smooth-scroll for nice live UX.
  const lastScrollConvoRef = useRef<string | null>(null);
  useEffect(() => {
    const switched = lastScrollConvoRef.current !== selectedConvo;
    lastScrollConvoRef.current = selectedConvo;
    messagesEndRef.current?.scrollIntoView({
      behavior: switched ? "auto" : "smooth",
    });
  }, [threadSignature, selectedConvo]);

  // Server-side search via the conversations list query (?q=). The local
  // result is just whatever has been loaded — no extra client-side filter.
  const filteredConversations = loadedConversations;

  // Get last message for sidebar preview. Reads from the lastMessage attached
  // to every conversation row (fetched server-side by the list/updates
  // endpoints). Falls back to the live thread for the open conversation so
  // optimistic agent replies show up immediately, before the next poll.
  function getLastMessagePreview(
    convo: Conversation,
  ): { text: string; emailed: boolean; role: "visitor" | "bot" | "agent" } | null {
    if (selectedConvo === convo.id && threadItems.length > 0) {
      const last = threadItems[threadItems.length - 1];
      if (last.kind === "inquiry") {
        return { text: "Submitted an inquiry", emailed: false, role: "visitor" };
      }
      const isOutbound = last.message.role === "agent" || last.message.role === "bot";
      const isInquiryMessage =
        last.message.role === "visitor" &&
        last.message.content.startsWith("Inquiry submission");
      return {
        text: isInquiryMessage ? "Submitted an inquiry" : last.message.content,
        emailed: isOutbound && !!last.message.emailedAt,
        role: last.message.role,
      };
    }
    if (convo.lastMessage) {
      const isOutbound =
        convo.lastMessage.role === "agent" || convo.lastMessage.role === "bot";
      // Inquiry-form submissions are stored as visitor messages whose content
      // begins with "Inquiry submission" (built by buildInquiryConversationMessage
      // in worker/index.ts). Surface a friendlier label instead of dumping form data.
      const isInquiry =
        convo.lastMessage.role === "visitor" &&
        convo.lastMessage.content.startsWith("Inquiry submission");
      return {
        text: isInquiry ? "Submitted an inquiry" : convo.lastMessage.content,
        emailed: isOutbound && !!convo.lastMessage.emailedAt,
        role: convo.lastMessage.role,
      };
    }
    return null;
  }

  function previewPrefix(role: "visitor" | "bot" | "agent"): string {
    if (role === "agent") return "You: ";
    if (role === "bot") return "Bot: ";
    return "";
  }

  // Strip markdown so the sidebar preview doesn't show raw asterisks /
  // backticks / link syntax. Lossy by design — full markdown still renders
  // in the detail view.
  function stripMarkdownForPreview(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1")
      .replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (isLoading) {
    return (
      <div className="-m-4 md:-m-8 h-screen flex">
        <div className="w-full md:w-[360px] bg-card/30">
          <div className="p-4">
            <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl"
              >
                <div className="w-12 h-12 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 bg-white/[0.02]" />
      </div>
    );
  }

  const selectedConversation = convoDetail?.conversation;
  const selectedMeta = selectedConversation
    ? parseMeta(selectedConversation.metadata)
    : null;

  return (
    <div className="-m-4 md:-m-8 h-screen flex overflow-hidden">
      {/* ─── Left Panel: Conversation List ─────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col bg-card transition-all",
          // On mobile: show full width when no convo selected, hide when convo selected
          selectedConvo ? "hidden md:flex md:w-[360px]" : "w-full md:w-[360px]",
        )}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <MobileMenuButton />
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Conversations</h1>
          <p className="text-xs text-muted-foreground">
            {convosPage?.counts?.all ?? 0} total
          </p>
        </div>

        {/* Search */}
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Status Filter Segments */}
        <div className="px-3 pb-2">
          <div className="flex bg-muted rounded-lg p-0.5">
            {(["all", "open", "closed"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={cn(
                  "flex-1 text-center px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  statusFilter === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "all" ? "All" : tab === "open" ? "Open" : "Closed"}
                {convosPage?.counts && (
                  <span className="ml-1 text-[10px] opacity-60">
                    {convosPage.counts[tab]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map((convo) => {
            const meta = parseMeta(convo.metadata);
            const preview = getLastMessagePreview(convo);
            const isSelected = selectedConvo === convo.id;
            const unread = isUnread(convo);
            const presenceState = getVisitorPresenceState({
              visitorLastSeenAt: convo.visitorLastSeenAt,
              visitorPresence: convo.visitorPresence,
            });

            return (
              <button
                key={convo.id}
                onClick={() => {
                  setSelectedConvo(convo.id);
                  markConversationRead(convo.id);
                }}
                onMouseEnter={() => {
                  // Warm the cache before the user clicks. TanStack dedupes
                  // in-flight requests by key + the 60s staleTime makes
                  // repeat hovers free, so no debounce needed.
                  queryClient.prefetchQuery({
                    queryKey: ["conversation-detail", convo.id],
                    queryFn: async () => {
                      const res = await fetch(
                        `/api/projects/${projectId}/conversations/${convo.id}`,
                      );
                      if (!res.ok) throw new Error("Failed to load");
                      return res.json();
                    },
                    staleTime: 1000 * 60,
                  });
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3.5 text-left transition-colors hover:bg-muted/50",
                  isSelected && "bg-primary/10",
                )}
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "text-sm truncate flex items-center gap-1.5 text-foreground min-w-0",
                        unread ? "font-bold" : "font-semibold",
                      )}
                    >
                      {convo.status !== "closed" && (
                        <span
                          aria-label={`Visitor is ${getPresenceBadge(presenceState).label.toLowerCase()}`}
                          title={`Visitor is ${getPresenceBadge(presenceState).label.toLowerCase()}`}
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            getPresenceDotClass(presenceState),
                          )}
                        />
                      )}
                      {meta.country && (
                        <span className="text-base leading-none shrink-0">
                          {countryToFlag(meta.country)}
                        </span>
                      )}
                      <span className="truncate">
                        {getVisitorDisplayName(convo)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-[11px] whitespace-nowrap",
                        unread
                          ? "text-primary font-semibold"
                          : "text-muted-foreground",
                      )}
                    >
                      {getConversationActivityLabel(convo)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p
                      className={cn(
                        "text-xs truncate flex items-center gap-1",
                        unread
                          ? "text-foreground font-medium"
                          : "text-muted-foreground",
                      )}
                    >
                      {preview?.emailed && (
                        <MailCheck className="w-3 h-3 shrink-0 text-status-replied/70" />
                      )}
                      <span className="truncate">
                        {preview ? (() => {
                          // "Submitted an inquiry" is already pre-formatted —
                          // skip the markdown stripper and the role prefix.
                          const isInquirySummary =
                            preview.text === "Submitted an inquiry";
                          const cleaned = isInquirySummary
                            ? preview.text
                            : stripMarkdownForPreview(preview.text);
                          const truncated =
                            cleaned.length > 60
                              ? cleaned.slice(0, 60) + "…"
                              : cleaned;
                          return (
                            <>
                              {!isInquirySummary && previewPrefix(preview.role) && (
                                <span className="font-medium">
                                  {previewPrefix(preview.role)}
                                </span>
                              )}
                              {truncated}
                            </>
                          );
                        })() : (
                          (convo.visitorEmail ?? (meta.city
                            ? [meta.city, meta.country].filter(Boolean).join(", ")
                            : convo.visitorId))
                        )}
                      </span>
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {convo.status !== "closed" && convo.status !== "active" && (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap",
                            convo.status === "waiting_agent" &&
                            "bg-status-waiting/10 text-status-waiting",
                            convo.status === "agent_replied" &&
                            "bg-status-replied/10 text-status-replied",
                          )}
                        >
                          {getStatusLabel(convo.status)}
                        </span>
                      )}
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="w-2 h-2 rounded-full bg-primary"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
          {filteredConversations.length === 0 && (
            <div className="p-8 text-center">
              <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No matching conversations" : "No conversations yet"}
              </p>
            </div>
          )}
          {hasMore && filteredConversations.length > 0 && (
            <button
              onClick={() => loadMoreConversations.mutate()}
              disabled={loadMoreConversations.isPending}
              className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {loadMoreConversations.isPending ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Chat Thread ──────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 bg-white/[0.02]",
          // On mobile: hide when no convo selected
          !selectedConvo && "hidden md:flex",
        )}
      >
        {selectedConvo && isDetailLoading ? (
          <div className="flex-1 flex flex-col">
            {/* Skeleton header */}
            <div className="px-4 py-3 flex items-center gap-3 bg-card">
              <button
                onClick={() => setSelectedConvo(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground md:hidden shrink-0"
                aria-label="Back to list"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
              <div className="space-y-1.5 flex-1">
                <div className="h-3.5 w-28 bg-muted rounded animate-pulse" />
                <div className="h-2.5 w-20 bg-muted/60 rounded animate-pulse" />
              </div>
            </div>
            {/* Skeleton messages */}
            <div className="flex-1 px-4 py-4 space-y-3">
              <div className="flex justify-start">
                <div className="h-12 w-48 bg-muted/30 rounded-lg rounded-tl-none animate-pulse" />
              </div>
              <div className="flex justify-end">
                <div className="h-16 w-56 bg-primary/[0.04] rounded-lg rounded-tr-none animate-pulse" />
              </div>
              <div className="flex justify-start">
                <div className="h-10 w-40 bg-muted/30 rounded-lg rounded-tl-none animate-pulse" />
              </div>
              <div className="flex justify-end">
                <div className="h-20 w-52 bg-primary/[0.04] rounded-lg rounded-tr-none animate-pulse" />
              </div>
              <div className="flex justify-start">
                <div className="h-12 w-44 bg-muted/30 rounded-lg rounded-tl-none animate-pulse" />
              </div>
            </div>
          </div>
        ) : selectedConvo && isDetailError ? (
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-3 flex items-center gap-3 bg-card md:hidden">
              <button
                onClick={() => setSelectedConvo(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0"
                aria-label="Back to list"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-foreground">
                Conversation
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
                <AlertCircle className="w-6 h-6 text-destructive" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                Couldn't load conversation
              </h3>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                {detailError instanceof Error
                  ? detailError.message
                  : "Something went wrong while loading this conversation."}
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedConvo(null)}
                >
                  Back to list
                </Button>
                <Button size="sm" onClick={() => refetchDetail()}>
                  Try again
                </Button>
              </div>
            </div>
          </div>
        ) : selectedConvo && convoDetail ? (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 flex items-center gap-3 bg-card">
              {/* Mobile back button */}
              <button
                onClick={() => setSelectedConvo(null)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground md:hidden shrink-0"
                aria-label="Back to list"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {(() => {
                    const presenceState = getVisitorPresenceState({
                      visitorLastSeenAt:
                        convoDetail.conversation.visitorLastSeenAt,
                      visitorPresence:
                        convoDetail.conversation.visitorPresence,
                    });
                    const presenceLabel = getPresenceBadge(presenceState).label;
                    if (convoDetail.conversation.status === "closed") return null;
                    return (
                      <span
                        title={`Visitor is ${presenceLabel.toLowerCase()}`}
                        aria-label={`Visitor is ${presenceLabel.toLowerCase()}`}
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          getPresenceDotClass(presenceState),
                        )}
                      />
                    );
                  })()}
                  <h2 className="text-sm font-semibold text-foreground truncate">
                    {selectedMeta?.country && (
                      <span className="mr-1.5">
                        {countryToFlag(selectedMeta.country)}
                      </span>
                    )}
                    {getVisitorDisplayName(convoDetail.conversation)}
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
                  {convoDetail.conversation.visitorEmail && (
                    <span className="truncate min-w-0">
                      {convoDetail.conversation.visitorEmail}
                    </span>
                  )}
                  {selectedMeta?.city && selectedMeta?.country && (
                    <span className="hidden md:inline-flex items-center gap-1 shrink-0">
                      <Globe className="w-3 h-3" />
                      {selectedMeta.city}
                      {selectedMeta.region ? `, ${selectedMeta.region}` : ""}
                    </span>
                  )}
                  <span className="hidden md:flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    In chat {formatDuration(convoDetail.conversation.createdAt)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap",
                    convoDetail.conversation.status === "active" &&
                    "bg-status-active/10 text-status-active",
                    convoDetail.conversation.status === "waiting_agent" &&
                    "bg-status-waiting/10 text-status-waiting",
                    convoDetail.conversation.status === "agent_replied" &&
                    "bg-status-replied/10 text-status-replied",
                    convoDetail.conversation.status === "closed" &&
                    "bg-status-closed/10 text-status-closed",
                  )}
                >
                  {convoDetail.conversation.status === "closed"
                    ? getCloseReasonLabel(convoDetail.conversation.closeReason)
                    : getStatusLabel(convoDetail.conversation.status)}
                </span>
                {convoDetail.conversation.status !== "closed" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={closeConversation.isPending}
                        className="text-muted-foreground hover:text-destructive h-8 px-2"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-48 p-1">
                      <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                        Close as...
                      </div>
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-lg hover:bg-accent transition-colors"
                        onClick={() =>
                          closeConversation.mutate({
                            convId: convoDetail.conversation.id,
                            closeReason: "resolved",
                          })
                        }
                      >
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Resolved
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-lg hover:bg-accent transition-colors"
                        onClick={() =>
                          closeConversation.mutate({
                            convId: convoDetail.conversation.id,
                            closeReason: "ended",
                          })
                        }
                      >
                        <LogOut className="w-4 h-4 text-muted-foreground" />
                        Ended
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-lg hover:bg-accent transition-colors"
                        onClick={() =>
                          closeConversation.mutate({
                            convId: convoDetail.conversation.id,
                            closeReason: "spam",
                          })
                        }
                      >
                        <ShieldBan className="w-4 h-4 text-destructive" />
                        Spam
                      </button>
                      <div className="my-1 mx-2 h-px bg-muted" />
                      <button
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-lg hover:bg-destructive/10 transition-colors text-destructive"
                        disabled={banVisitor.isPending}
                        onClick={() =>
                          banVisitor.mutate({
                            convId: convoDetail.conversation.id,
                            visitorId: convoDetail.conversation.visitorId,
                            visitorEmail: convoDetail.conversation.visitorEmail,
                          })
                        }
                      >
                        <ShieldBan className="w-4 h-4" />
                        {banVisitor.isPending ? "Banning..." : "Ban Visitor"}
                      </button>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>

            {/* Visitor info bar */}
            {selectedMeta && (() => {
              const { system, custom } = splitMetadata(selectedMeta);
              const browserName = parseBrowserName(
                selectedMeta.userAgent as string | undefined,
                selectedMeta.browser as string | undefined,
              );
              const customEntries = Object.entries(custom);
              const currentPage = (selectedMeta.currentPageUrl ?? selectedMeta.url) as string | undefined;
              const referrer = selectedMeta.referrer as string | undefined;
              const timezone = selectedMeta.timezone as string | undefined;
              const hasAnyInfo = browserName !== "Unknown" || currentPage || referrer || timezone || customEntries.length > 0;

              if (!hasAnyInfo) return null;

              const isIdentified = customEntries.length > 0;

              return (
                <Sheet>
                  <SheetTrigger asChild>
                    <div className="px-4 py-1.5 bg-card/80 flex items-center gap-x-3 text-[11px] text-muted-foreground w-full overflow-hidden cursor-pointer hover:bg-accent/50 transition-colors min-w-0">
                      {isIdentified ? (
                        <>
                          {customEntries.slice(0, 3).map(([key, value]) => (
                            <span
                              key={key}
                              title={`${key}: ${value}`}
                              className="flex items-center gap-1 whitespace-nowrap shrink-0 bg-primary/10 text-primary px-1.5 py-0.5 rounded-md"
                            >
                              <Tag className="w-2.5 h-2.5 shrink-0" />
                              <span className="font-medium">{key}:</span> {value}
                            </span>
                          ))}
                          {currentPage && (
                            <span
                              className="flex items-center gap-1 whitespace-nowrap shrink-0"
                              title={currentPage}
                            >
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Page:</span>
                              <span>{currentPage.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {referrer && (
                            <span
                              className="flex items-center gap-1 whitespace-nowrap shrink-0"
                              title={referrer}
                            >
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Referrer:</span>
                              <span>{referrer.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                          {currentPage && (
                            <span
                              className="flex items-center gap-1 whitespace-nowrap shrink-0"
                              title={currentPage}
                            >
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Page:</span>
                              <span>{currentPage.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                          {timezone && (
                            <span
                              className="flex items-center gap-1 whitespace-nowrap shrink-0"
                              title={timezone}
                            >
                              <Clock className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Timezone:</span>
                              {timezone}
                            </span>
                          )}
                          {browserName !== "Unknown" && (
                            <span className="flex items-center gap-1 whitespace-nowrap shrink-0">
                              <Monitor className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Browser:</span>
                              {browserName}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </SheetTrigger>
                  <SheetContent side="right" className="overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Details</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 px-4">
                      <DetailsPanel
                        stats={[{ label: "AI Messages (Billed)", value: convoDetail.messages.filter((m) => m.role === "bot").length }]}
                        identity={[
                          convoDetail.conversation.visitorName ? { label: "Name", value: convoDetail.conversation.visitorName } : null,
                          convoDetail.conversation.visitorEmail ? { label: "Email", value: convoDetail.conversation.visitorEmail } : null,
                        ].filter((x): x is { label: string; value: string } => x !== null)}
                        fields={customEntries.length > 0 ? custom : undefined}
                        fieldsLabel="Custom Metadata"
                        systemFields={system}
                        systemDefaultOpen={customEntries.length === 0 && !convoDetail.conversation.visitorName && !convoDetail.conversation.visitorEmail}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              );
            })()}

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-1 min-w-0"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'a\' patternUnits=\'userSpaceOnUse\' width=\'40\' height=\'40\'%3E%3Cpath d=\'M0 20h40M20 0v40\' fill=\'none\' stroke=\'%23000\' stroke-opacity=\'.02\' stroke-width=\'.5\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'200\' height=\'200\' fill=\'url(%23a)\'/%3E%3C/svg%3E")',
              }}
            >
              {/* Load earlier messages */}
              {convoDetail.hasMore && (
                <div className="flex justify-center pb-3">
                  <button
                    type="button"
                    onClick={() => loadEarlier.mutate()}
                    disabled={loadEarlier.isPending}
                    className="px-3 py-1 rounded-lg bg-card/80 text-[11px] text-muted-foreground hover:text-foreground hover:bg-card transition-colors shadow-sm disabled:opacity-60"
                  >
                    {loadEarlier.isPending ? "Loading..." : "Load earlier messages"}
                  </button>
                </div>
              )}

              {/* Date separator for first message */}
              {threadItems.length > 0 && (
                <div className="flex justify-center mb-3">
                  <span className="px-3 py-1 rounded-lg bg-card/80 text-[11px] text-muted-foreground font-medium shadow-sm">
                    {new Date(
                      threadItems[0].createdAt,
                    ).toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}

              {threadItems.map((item, idx) => {
                const prevItem = idx > 0 ? threadItems[idx - 1] : null;
                const showDateSep =
                  prevItem &&
                  new Date(item.createdAt).toDateString() !==
                  new Date(prevItem.createdAt).toDateString();

                if (item.kind === "inquiry") {
                  const inq = item.inquiry;

                  return (
                    <div key={item.id}>
                      {showDateSep && (
                        <div className="flex justify-center my-3">
                          <span className="px-3 py-1 rounded-lg bg-card/80 text-[11px] text-muted-foreground font-medium shadow-sm">
                            {new Date(item.createdAt).toLocaleDateString([], {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-start mb-0.5">
                        <div className="relative max-w-[85%] sm:max-w-[65%] rounded-lg rounded-tl-none px-3 py-2 shadow-sm bg-muted/50 text-foreground overflow-hidden">
                          <div className="flex items-center gap-1 mb-1.5">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              Inquiry
                            </span>
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full ml-1",
                                inq.status === "new" &&
                                "bg-blue-500/10 text-blue-400",
                                inq.status === "replied" &&
                                "bg-emerald-500/10 text-emerald-400",
                                inq.status === "closed" &&
                                "bg-muted text-muted-foreground",
                              )}
                            >
                              {inq.status === "new"
                                ? "New"
                                : inq.status === "replied"
                                  ? "Replied"
                                  : "Closed"}
                            </span>
                          </div>
                          {item.fields.length > 0 && (
                            <div className="space-y-1">
                              {item.fields.map(([key, value]) => (
                                <div key={key} className="text-[13px] leading-relaxed">
                                  <span className="font-medium text-foreground/80">
                                    {key}:
                                  </span>{" "}
                                  <span className="text-foreground/70 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                    {value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center justify-end mt-1">
                            <span className="text-[10px] text-muted-foreground/70">
                              {formatTime(String(inq.createdAt))}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                const msg = item.message;
                const isVisitor = msg.role === "visitor";
                const isBot = msg.role === "bot";
                const isAgent = msg.role === "agent";

                return (
                  <div key={item.id}>
                    {showDateSep && (
                      <div className="flex justify-center my-3">
                        <span className="px-3 py-1 rounded-lg bg-card/80 text-[11px] text-muted-foreground font-medium shadow-sm">
                          {new Date(msg.createdAt).toLocaleDateString([], {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    )}

                    {/* Tool execution cards (shown above bot messages) */}
                    {isBot && msg.toolExecutions && msg.toolExecutions.length > 0 && (
                      <div className="flex justify-end mb-1">
                        <div className="max-w-[85%] sm:max-w-[65%] w-full space-y-1">
                          {msg.toolExecutions.map((exec) => {
                            const isExpanded = expandedToolCards.has(exec.id);
                            const toggleExpand = () => {
                              setExpandedToolCards((prev) => {
                                const next = new Set(prev);
                                if (next.has(exec.id)) {
                                  next.delete(exec.id);
                                } else {
                                  next.add(exec.id);
                                }
                                return next;
                              });
                            };

                            const statusColor =
                              exec.status === "success"
                                ? "text-emerald-400"
                                : exec.status === "timeout"
                                  ? "text-amber-400"
                                  : "text-red-400";
                            const statusBg =
                              exec.status === "success"
                                ? "bg-emerald-500/10"
                                : exec.status === "timeout"
                                  ? "bg-amber-500/10"
                                  : "bg-red-500/10";
                            const statusLabel =
                              exec.status === "success"
                                ? exec.httpStatus
                                  ? `${exec.httpStatus} OK`
                                  : "Success"
                                : exec.status === "timeout"
                                  ? "Timeout"
                                  : "Error";

                            return (
                              <div
                                key={exec.id}
                                className="bg-white/[0.03] backdrop-blur-sm rounded-lg overflow-hidden"
                              >
                                {/* Card header — always visible */}
                                <button
                                  type="button"
                                  onClick={toggleExpand}
                                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.02] transition-colors"
                                >
                                  <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                    <Wrench className="w-3 h-3 text-primary" />
                                  </div>
                                  <div className="flex-1 text-left min-w-0">
                                    <span className="text-[11px] text-muted-foreground">
                                      Called tool
                                    </span>
                                    <span className="text-[11px] font-medium text-foreground ml-1.5 truncate">
                                      {exec.displayName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", statusBg, statusColor)}>
                                      {statusLabel}
                                    </span>
                                    {exec.duration != null && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {exec.duration}ms
                                      </span>
                                    )}
                                    {isExpanded ? (
                                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                    )}
                                  </div>
                                </button>

                                {/* Expandable details */}
                                {isExpanded && (
                                  <div>
                                    {/* Input parameters */}
                                    {exec.input && Object.keys(exec.input).length > 0 && (
                                      <div className="px-3 py-2">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                                          Parameters
                                        </p>
                                        <pre className="bg-black/20 rounded-md p-2 text-[11px] text-muted-foreground font-mono overflow-x-auto max-h-32 overflow-y-auto">
                                          {JSON.stringify(exec.input, null, 2)}
                                        </pre>
                                      </div>
                                    )}

                                    {/* Output / Error */}
                                    <div className="px-3 py-2">
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                          Result
                                        </p>
                                        {exec.status !== "success" && exec.errorMessage && (
                                          <div className="flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3 text-red-400" />
                                            <span className="text-[10px] text-red-400">
                                              {exec.errorMessage}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                      {exec.output ? (
                                        <pre className="bg-black/20 rounded-md p-2 text-[11px] text-muted-foreground font-mono overflow-x-auto max-h-40 overflow-y-auto">
                                          {JSON.stringify(exec.output, null, 2)}
                                        </pre>
                                      ) : (
                                        <p className="text-[11px] text-muted-foreground/60 italic">
                                          No output data
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div
                      className={cn(
                        "flex mb-3 min-w-0",
                        isVisitor ? "justify-start" : "justify-end",
                      )}
                    >
                      <div
                        className={cn(
                          "flex flex-col max-w-[85%] sm:max-w-[65%] min-w-0 gap-1.5",
                          isVisitor ? "items-start" : "items-end",
                        )}
                      >
                      <div
                        className={cn(
                          "relative rounded-lg px-3 py-2 shadow-sm overflow-hidden max-w-full",
                          isVisitor &&
                          "bg-muted/50 text-foreground rounded-tl-none",
                          isBot &&
                          "bg-primary/[0.07] text-foreground rounded-tr-none",
                          isAgent &&
                          "bg-primary/[0.10] text-foreground rounded-tr-none",
                        )}
                      >
                        {/* Role label for bot/agent */}
                        {(isBot || isAgent) && (
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isAgent && msg.senderAvatar && (
                              <img
                                src={msg.senderAvatar}
                                alt={msg.senderName ?? "Agent"}
                                className="w-4 h-4 rounded-full object-cover"
                              />
                            )}
                            {isBot && (
                              <span className="text-[11px] font-semibold text-status-active flex items-center gap-0.5">
                                <Bot className="w-3 h-3" />
                                {msg.senderName ?? convoDetail.botName ?? "Bot"}
                              </span>
                            )}
                            {isAgent && (
                              <span className="text-[11px] font-semibold text-status-replied flex items-center gap-0.5">
                                {!msg.senderAvatar && <Headphones className="w-3 h-3" />}
                                {msg.senderName ?? convoDetail.agentName ?? "Agent"}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Message content */}
                        {msg.role === "visitor" ? (
                          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {msg.content}
                          </p>
                        ) : (
                          <div
                            className="text-[13.5px] leading-relaxed break-words [overflow-wrap:anywhere] prose-chat"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />
                        )}

                        {/* Source links */}
                        {isBot && msg.sources && (() => {
                          try {
                            const sources: SourceReference[] = JSON.parse(msg.sources);
                            if (!Array.isArray(sources) || sources.length === 0) return null;
                            return (
                              <div className="mt-1.5 pt-1.5 space-y-0.5">
                                {sources.map((src, i) => {
                                  const srcType = src.type || "webpage";
                                  const typeLabel = srcType === "pdf" ? "Docs" : srcType === "faq" ? "FAQ" : "Website";
                                  const Icon = srcType === "webpage" ? Globe : FileText;
                                  return (
                                    <div key={i} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                      <Icon className="w-3 h-3 shrink-0" />
                                      <span className="font-semibold text-[10px] uppercase tracking-wide shrink-0">{typeLabel}</span>
                                      {src.url ? (
                                        <a
                                          href={src.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:opacity-70 truncate"
                                        >
                                          {src.title}
                                        </a>
                                      ) : (
                                        <span className="truncate">{src.title}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          } catch {
                            return null;
                          }
                        })()}

                      </div>

                      {/* Timestamp + checkmarks + email status — sits BELOW the bubble */}
                      <div
                        className={cn(
                          "flex items-center gap-1 px-1 flex-wrap",
                          isVisitor ? "justify-start" : "justify-end",
                        )}
                      >
                        {(msg as Message & { _optimistic?: boolean })
                          ._optimistic ? (
                          <span className="text-[10px] text-muted-foreground/70 italic">
                            {sendReply.isPending
                              ? "Sending..."
                              : sendReply.isError
                                ? "Failed to send"
                                : "Sent"}
                          </span>
                        ) : (
                          <>
                            <span className="text-[10px] text-muted-foreground/70">
                              {formatTime(msg.createdAt)}
                            </span>
                            {!isVisitor && (
                              <CheckCheck className="w-3.5 h-3.5 text-status-replied/70" />
                            )}
                            {isVisitor && (
                              <Check className="w-3 h-3 text-muted-foreground/40" />
                            )}
                            {(isAgent || isBot) &&
                              (msg.emailedAt ? (
                                <span
                                  title={`Emailed ${timeAgo(msg.emailedAt)}`}
                                  aria-label={`Emailed ${timeAgo(msg.emailedAt)}`}
                                  className="inline-flex"
                                >
                                  <MailCheck className="w-3.5 h-3.5 text-status-replied/70" />
                                </span>
                              ) : convoDetail?.conversation?.visitorEmail ? (
                                <button
                                  type="button"
                                  onClick={() => sendEmail.mutate(msg.id)}
                                  disabled={sendEmail.isPending}
                                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 ml-1 transition-colors"
                                >
                                  <Mail className="w-3 h-3" />
                                  {sendEmail.isPending &&
                                  sendEmail.variables === msg.id
                                    ? "Sending..."
                                    : "Send as Email"}
                                </button>
                              ) : null)}
                          </>
                        )}
                      </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input */}
            <div className="px-3 py-2 bg-card">
              {convoDetail.conversation.status === "closed" && (
                <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                  <XCircle className="w-3 h-3" />
                  {getCloseReasonLabel(convoDetail.conversation.closeReason)}
                  <span className="text-muted-foreground/60">· Replying will reopen</span>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (replyText.trim()) {
                    sendReply.mutate(replyText.trim());
                    if (replyTextareaRef.current) {
                      replyTextareaRef.current.style.height = "auto";
                    }
                  }
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  ref={replyTextareaRef}
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    // Auto-resize
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    // On touch-primary devices the on-screen keyboard has no
                    // Shift, so Enter must insert a newline. Send button only.
                    const isTouch =
                      typeof window !== "undefined" &&
                      window.matchMedia("(pointer: coarse)").matches;
                    if (isTouch) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (replyText.trim()) {
                        sendReply.mutate(replyText.trim());
                        if (replyTextareaRef.current) {
                          replyTextareaRef.current.style.height = "auto";
                        }
                      }
                    }
                  }}
                  placeholder={convoDetail.conversation.status === "closed" ? "Reply to reopen..." : "Type your reply..."}
                  rows={1}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none overflow-hidden leading-normal"
                  style={{ maxHeight: 120 }}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!replyText.trim() || sendReply.isPending}
                  className="h-10 w-10 rounded-full mb-0.5"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 hidden md:flex items-center justify-center">
            <div className="text-center space-y-3 opacity-50">
              <MessageSquare className="w-16 h-16 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Select a conversation to start
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Conversations;
