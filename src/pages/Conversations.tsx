import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConversationWs } from "@/lib/use-conversation-ws";
import type { InboxFilter, InboxSort } from "@/lib/inbox/filters";
import type {
  Conversation,
  Message,
  InboxCounts,
  LastMessagePreview,
} from "@/lib/inbox/types";
import MessageList from "@/components/inbox/MessageList";
import ReadingPane from "@/components/inbox/ReadingPane";
import FocusView from "@/components/inbox/FocusView";

// ─── Wire shapes (orchestrator-local) ──────────────────────────────────────────

interface ConversationsPage {
  conversations: Conversation[];
  counts: InboxCounts;
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
  snoozedUntil?: string | null;
  priority?: "low" | "medium" | "high" | null;
  assigneeId?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: LastMessagePreview | null;
}

interface ConversationUpdatesResponse {
  updates: ConversationUpdate[];
  // The /updates endpoint still returns the legacy open/closed shape; the inbox
  // counts that drive the sidebar/subtitle come from the list response instead.
  counts: { all: number; open: number; closed: number };
  serverTime: number;
}

interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  hasMore: boolean;
  botName: string | null;
  agentName: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: InboxCounts = {
  "needs-you": 0,
  all: 0,
  snoozed: 0,
  resolved: 0,
  flagged: 0,
};

function getActivityMs(convo: Conversation): number {
  const raw = convo.lastActivityAt ?? convo.updatedAt;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
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
  const [view, setView] = useState<"split" | "focus">("split");
  // List sort order + "unread only" filter, surfaced by the list's sort/filter
  // control. Both apply client-side over the loaded page.
  const [sort, setSort] = useState<InboxSort>("newest");
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Client-side read overlay (see readKey): convId -> activity ms marked read.
  const [readMarks, setReadMarks] = useState<Record<string, number>>({});

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

  // One-shot deep-link target from ?msg= (Telegram/email/ping links). Captured
  // once on mount and cleared from the URL immediately so refreshes don't
  // re-pulse. highlightConvRef snapshots the ?id= this ?msg= targeted so the
  // clear effect below only fires when the agent navigates AWAY from that
  // conversation — a naive unconditional clear on [selectedConvo] would also
  // run on mount and wipe the highlight before the target ever rendered.
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const highlightConvRef = useRef<string | null>(searchParams.get("id"));
  useEffect(() => {
    const msg = searchParams.get("msg");
    if (!msg) return;
    setHighlightMsgId(msg);
    const next = new URLSearchParams(searchParams);
    next.delete("msg");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // mounted, so the open conversation and focus overlay are just component
  // state — they don't unmount on navigation. Clear the selection and drop back
  // to split view whenever the filter changes, so the new view starts clean
  // (no stale thread in the reading pane, no lingering focus mode). The mount
  // run is skipped via the ref so deep links (?filter=…&id=…) still open.
  const prevFilterRef = useRef(filter);
  useEffect(() => {
    if (prevFilterRef.current === filter) return;
    prevFilterRef.current = filter;
    setSelectedConvo(null);
    setView("split");
  }, [filter]);

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
  const [serverTimeBaseline, setServerTimeBaseline] = useState<number | null>(
    null,
  );
  // The `/updates` poll cursor lives in a ref, NOT in the query key. Each
  // response carries a fresh `serverTime`; if that advanced value were in the
  // query key it would churn the key on every response and React Query would
  // refetch immediately, looping forever. The ref initialises from the first
  // baseline and advances from each updates response, while the 5s interval
  // drives the actual polling cadence.
  const updatesSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (serverTimeBaseline != null && updatesSinceRef.current == null) {
      updatesSinceRef.current = serverTimeBaseline;
    }
  }, [serverTimeBaseline]);

  // Open a WebSocket for the selected conversation. The hook patches the
  // ["conversation-detail", id] cache on incoming events so messages and
  // status changes appear in real time without polling.
  useConversationWs(projectId, selectedConvo);

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
    if (convosPage.serverTime) setServerTimeBaseline(convosPage.serverTime);
    if (projectId) {
      queryClient.setQueryData(["inbox-counts", projectId], convosPage.counts);
    }
  }, [convosPage, isPlaceholderData, projectId, queryClient]);

  // Lightweight polling: fetch conversation deltas (id + activity) and patch
  // the local list in place. Brand-new conversations are prepended for the
  // broad inbox views.
  const { data: updatesData } = useQuery<ConversationUpdatesResponse>({
    queryKey: ["conversation-updates", projectId],
    queryFn: async () => {
      const since = updatesSinceRef.current ?? serverTimeBaseline ?? 0;
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

  useEffect(() => {
    if (!updatesData) return;
    if (updatesData.serverTime) updatesSinceRef.current = updatesData.serverTime;
    if (updatesData.updates.length === 0) return;

    // Only the broad inbox views surface brand-new conversations live; the
    // narrow filters (snoozed/resolved/flagged) can't be evaluated from the
    // delta row alone, so they wait for the next full refetch.
    const passesFilter = (status: string): boolean => {
      if (filter === "all") return true;
      if (filter === "needs-you") return status !== "closed";
      return false;
    };

    const updateMap = new Map(updatesData.updates.map((u) => [u.id, u]));

    setLoadedConversations((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      let changed = false;

      const next: Conversation[] = prev.map((c) => {
        const u = updateMap.get(c.id);
        if (!u) return c;
        changed = true;
        updateMap.delete(c.id);
        return { ...c, ...u };
      });

      for (const u of updateMap.values()) {
        if (seen.has(u.id)) continue;
        if (!passesFilter(u.status)) continue;
        changed = true;
        next.push(u as Conversation);
      }

      if (!changed) return prev;
      next.sort((a, b) => getActivityMs(b) - getActivityMs(a));
      return next;
    });

    // Keep the cached page consistent so a filter switch / limit bump stays
    // correct. debouncedSearch and listLimit are read from the closure here;
    // their staleness window matches the 5-second poll interval (same pattern
    // as the existing `filter` closure variable).
    queryClient.setQueryData<ConversationsPage | undefined>(
      ["conversations", projectId, filter, debouncedSearch, listLimit],
      (old) => {
        if (!old) return old;
        const seen = new Set(old.conversations.map((c) => c.id));
        const patched = old.conversations.map((c) => {
          const u = updatesData.updates.find((x) => x.id === c.id);
          return u ? { ...c, ...u } : c;
        });
        for (const u of updatesData.updates) {
          if (seen.has(u.id)) continue;
          if (!passesFilter(u.status)) continue;
          patched.push(u as Conversation);
        }
        patched.sort((a, b) => getActivityMs(b) - getActivityMs(a));
        return { ...old, conversations: patched };
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatesData]);

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
    // Detail is kept fresh in real time by useConversationWs; cache 60s so
    // revisiting a conversation is instant.
    staleTime: 1000 * 60,
  });

  // Reset the composer draft when switching conversations.
  useEffect(() => {
    setDraft("");
  }, [selectedConvo]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async ({
      content,
      imageUrl,
      asEmail,
    }: {
      content: string;
      imageUrl?: string | null;
      asEmail?: boolean;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, imageUrl: imageUrl ?? null }),
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
    onMutate: async ({ content, imageUrl }) => {
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
          const optimistic: Message = {
            id: `optimistic-${Date.now()}`,
            role: "agent",
            content,
            imageUrl: imageUrl ?? null,
            createdAt: new Date().toISOString(),
            senderName: null,
            emailedAt: null,
            deliveredAt: null,
            readAt: null,
          };
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

  // Turn an agent's shorthand instruction into a tone-matched reply. Captures
  // the target conversation at call time (convAtCall) so a stale success
  // arriving after the agent has switched conversations doesn't clobber the
  // draft of a different, now-open conversation.
  const composeDraft = useMutation({
    mutationFn: async (instruction: string) => {
      const convAtCall = selectedConvo;
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/compose-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction }),
        },
      );
      if (!res.ok) throw new Error("Failed to compose");
      const data = (await res.json()) as { message: string };
      return { message: data.message, convAtCall };
    },
    onSuccess: (data) => {
      if (data.convAtCall === selectedConvo) setDraft(data.message);
    },
    onError: () =>
      toast.error("Couldn't compose a reply — your instruction is untouched."),
  });

  function handleCompose() {
    const instruction = draft.trim();
    if (!instruction || !selectedConvo || composeDraft.isPending) return;
    composeDraft.mutate(instruction);
  }

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

  // ── Derived view data ─────────────────────────────────────────────────────
  // Unread = visitor sent last AND that activity is newer than any read mark.
  const isUnread = useCallback(
    (c: Conversation) =>
      c.lastMessage?.role === "visitor" &&
      getActivityMs(c) > (readMarks[c.id] ?? 0),
    [readMarks],
  );

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

  function handleSend(
    content?: string,
    opts?: { imageUrl?: string | null; asEmail?: boolean },
  ) {
    const text = (content ?? draft).trim();
    if (!text && !opts?.imageUrl) return;
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
      imageUrl: opts?.imageUrl ?? null,
      asEmail: opts?.asEmail ?? autoEmail,
    });
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
      setSelectedConvo(conversations[newIndex].id);
    }

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.matches?.("input, textarea, [contenteditable='true']")) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        selectRelative(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        selectRelative(-1);
      } else if (e.key === "e" || e.key === "E") {
        if (selected) handleResolve(selected.id);
      } else if (e.key === "f" || e.key === "F") {
        setView((v) => (v === "focus" ? "split" : "focus"));
      } else if (e.key === "Escape") {
        setView("split");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleResolve is a function declaration that closes over the same
    // reactive values already listed (conversations, selected, etc.), so it is
    // kept fresh by the existing deps without being listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, conversations, selectedIndex, view]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (view === "focus" && selected) {
    return (
      <FocusView
        conversation={selected}
        messages={messages}
        index={selectedIndex}
        total={counts[filter] ?? conversations.length}
        onExit={() => setView("split")}
        onSend={handleSend}
        onResolve={handleResolve}
        draft={draft}
        setDraft={setDraft}
        onCompose={handleCompose}
        composing={composeDraft.isPending}
      />
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
        onSelect={setSelectedConvo}
        onResolve={handleResolve}
        onSnooze={handleSnooze}
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
        // Mobile: collapse the list once a conversation is open so the chat +
        // composer take the full screen (desktop keeps the split).
        className={cn(selectedConvo ? "hidden md:flex" : "flex")}
      />
      {selected ? (
        <ReadingPane
          conversation={selected}
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
          onDeleteMessage={handleDeleteMessage}
          onBack={() => setSelectedConvo(null)}
          onCompose={handleCompose}
          composing={composeDraft.isPending}
          // `?msg=` deep-link scroll+pulse target.
          highlightMessageId={highlightMsgId}
        />
      ) : (
        <div className="glass-reading flex-1 hidden md:grid place-items-center text-ink-7 text-sm">
          Select a conversation
        </div>
      )}
    </div>
  );
}

export default Conversations;
