import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useConversationWs } from "@/lib/use-conversation-ws";
import { useCopilotThread, useCopilotSender } from "@/lib/use-copilot";
import type { InboxFilter } from "@/lib/inbox/filters";
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
  const lastSuggestionRef = useRef<string | null>(null);

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

  const [loadedConversations, setLoadedConversations] = useState<Conversation[]>(
    [],
  );
  const [serverTimeBaseline, setServerTimeBaseline] = useState<number | null>(
    null,
  );

  // Open a WebSocket for the selected conversation. The hook patches the
  // ["conversation-detail", id] cache on incoming events so messages and
  // status changes appear in real time without polling.
  useConversationWs(projectId, selectedConvo);

  // Copilot: surface the conversation's auto-suggest draft and let the agent
  // (re)generate it via handleRewrite. The drawer UI is superseded by the new
  // inline draft + Rewrite action.
  const copilotThread = useCopilotThread(projectId ?? "", selectedConvo);
  const copilotSender = useCopilotSender(projectId ?? "", selectedConvo ?? "");

  // ── List query (drives the conversation column) ──────────────────────────
  const { data: convosPage } = useQuery<ConversationsPage>({
    queryKey: ["conversations", projectId, filter],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "all",
        limit: "25",
        offset: "0",
        filter,
      });
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
    if (!convosPage) return;
    setLoadedConversations(convosPage.conversations);
    if (convosPage.serverTime) setServerTimeBaseline(convosPage.serverTime);
    if (projectId) {
      queryClient.setQueryData(["inbox-counts", projectId], convosPage.counts);
    }
  }, [convosPage, projectId, queryClient]);

  // Lightweight polling: fetch conversation deltas (id + activity) and patch
  // the local list in place. Brand-new conversations are prepended for the
  // broad inbox views.
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

  useEffect(() => {
    if (!updatesData) return;
    if (updatesData.serverTime) setServerTimeBaseline(updatesData.serverTime);
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

    // Keep the cached page consistent so a filter switch stays correct.
    queryClient.setQueryData<ConversationsPage | undefined>(
      ["conversations", projectId, filter],
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
  const { data: convoDetail } = useQuery<ConversationDetail>({
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

  // Reset the composer draft when switching conversations so the auto-suggest
  // prefill (below) can populate it cleanly for the newly selected thread.
  useEffect(() => {
    setDraft("");
    lastSuggestionRef.current = null;
  }, [selectedConvo]);

  // Pre-fill the draft from the latest completed Copilot auto-suggest, but
  // never clobber text the agent has already typed.
  useEffect(() => {
    const msgs = copilotThread.data;
    if (!msgs || msgs.length === 0) return;
    const suggestion = [...msgs]
      .reverse()
      .find(
        (m) =>
          m.role === "copilot" &&
          m.autoSuggest &&
          !m._streaming &&
          m.content.trim().length > 0,
      );
    if (!suggestion) return;
    if (lastSuggestionRef.current === suggestion.id) return;
    lastSuggestionRef.current = suggestion.id;
    setDraft((prev) => (prev.trim().length > 0 ? prev : suggestion.content));
  }, [copilotThread.data]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const sendReply = useMutation({
    mutationFn: async ({ content }: { content: string }) => {
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
    onMutate: async ({ content }) => {
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
            createdAt: new Date().toISOString(),
            senderName: null,
            emailedAt: null,
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

  // ── Derived view data ─────────────────────────────────────────────────────
  const conversations = loadedConversations;
  const counts = convosPage?.counts ?? EMPTY_COUNTS;
  const messages = convoDetail?.messages ?? [];
  const selected =
    convoDetail?.conversation ??
    conversations.find((c) => c.id === selectedConvo) ??
    null;
  const selectedIndex = selected
    ? conversations.findIndex((c) => c.id === selected.id)
    : -1;

  // ── Handlers ──────────────────────────────────────────────────────────────
  // When the acted-on conversation is the open one and it leaves the active
  // view (resolved / spam / snoozed), advance selection to the neighbouring
  // row so the agent keeps triaging without a dead selection.
  function advanceSelectionPast(convId: string) {
    if (selectedConvo !== convId) return;
    const idx = conversations.findIndex((c) => c.id === convId);
    const next = conversations[idx + 1] ?? conversations[idx - 1] ?? null;
    setSelectedConvo(next ? next.id : null);
  }

  function handleSend(content?: string) {
    const text = (content ?? draft).trim();
    if (!text || !selectedConvo) return;
    sendReply.mutate({ content: text });
  }

  function handleResolve(convId: string) {
    closeConversation.mutate({ convId, closeReason: "resolved" });
    advanceSelectionPast(convId);
  }

  function handleFlagSpam(convId: string) {
    closeConversation.mutate({ convId, closeReason: "spam" });
    advanceSelectionPast(convId);
  }

  function handleSnooze(convId: string, until: number | null) {
    snoozeConversation.mutate({ convId, until });
    advanceSelectionPast(convId);
  }

  function handleSetPriority(
    convId: string,
    priority: "low" | "medium" | "high",
  ) {
    setPriorityMutation.mutate({ convId, priority });
  }

  function handleRewrite() {
    if (!selectedConvo || copilotSender.isStreaming) return;
    // Reset the guard so the prefill effect re-loads the fresh suggestion.
    lastSuggestionRef.current = null;
    copilotSender.send({ endpoint: "auto-suggest" });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (view === "focus" && selected) {
    return (
      <FocusView
        conversation={selected}
        messages={messages}
        index={selectedIndex}
        total={conversations.length}
        onExit={() => setView("split")}
        onSend={handleSend}
        onResolve={handleResolve}
        onRewrite={handleRewrite}
        draft={draft}
        setDraft={setDraft}
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
      />
      {selected ? (
        <ReadingPane
          conversation={selected}
          messages={messages}
          draft={draft}
          setDraft={setDraft}
          onSend={handleSend}
          onResolve={handleResolve}
          onSnooze={handleSnooze}
          onFlagSpam={handleFlagSpam}
          onPriority={handleSetPriority}
          onRewrite={handleRewrite}
          onFocus={() => setView("focus")}
        />
      ) : (
        <div className="glass-reading flex-1 grid place-items-center text-ink-7 text-sm">
          Select a conversation
        </div>
      )}
    </div>
  );
}

export default Conversations;
