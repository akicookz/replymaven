import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Send,
  Bot,
  Headphones,
  XCircle,
  Search,
  Check,
  CheckCheck,
  Clock,
  Globe,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationMeta {
  url?: string;
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  ip?: string;
  userAgent?: string;
}

interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: "visitor" | "bot" | "agent";
  content: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMeta(metadata: string | null): ConversationMeta {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
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

function getInitial(convo: Conversation): string {
  const name = getVisitorDisplayName(convo);
  return name.charAt(0).toUpperCase();
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function getStatusDot(status: string): string {
  switch (status) {
    case "active":
      return "bg-status-active";
    case "waiting_agent":
      return "bg-status-waiting";
    case "agent_replied":
      return "bg-status-replied";
    default:
      return "bg-status-closed";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "waiting_agent":
      return "Waiting";
    case "agent_replied":
      return "Replied";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

function Conversations() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: convoDetail } = useQuery<{
    conversation: Conversation;
    messages: Message[];
  }>({
    queryKey: ["conversation-detail", selectedConvo],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedConvo,
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${selectedConvo}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: replyText }),
        },
      );
      if (!res.ok) throw new Error("Failed to send reply");
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  const closeConversation = useMutation({
    mutationFn: async (convId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${convId}/close`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to close conversation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["conversation-detail", selectedConvo],
      });
      queryClient.invalidateQueries({
        queryKey: ["conversations", projectId],
      });
    },
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convoDetail?.messages]);

  // Filter conversations by search
  const filteredConversations = conversations?.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = getVisitorDisplayName(c).toLowerCase();
    const email = (c.visitorEmail ?? "").toLowerCase();
    return name.includes(q) || email.includes(q) || c.visitorId.includes(q);
  });

  // Get last message for sidebar preview
  function getLastMessagePreview(convo: Conversation): string | null {
    // We only have the full message list for the selected conversation
    // For sidebar, we'd need to fetch individually or include in the list endpoint
    // For now, return null (could be enhanced later)
    if (selectedConvo === convo.id && convoDetail?.messages?.length) {
      const last = convoDetail.messages[convoDetail.messages.length - 1];
      return last.content;
    }
    return null;
  }

  if (isLoading) {
    return (
      <div className="-m-8 h-screen flex">
        <div className="w-[360px] border-r border-border bg-card/30">
          <div className="p-4 border-b border-border">
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
    <div className="-m-8 h-screen flex overflow-hidden">
      {/* ─── Left Panel: Conversation List ─────────────────────────────── */}
      <div className="w-[360px] flex flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-lg font-bold text-foreground">Conversations</h1>
          <p className="text-xs text-muted-foreground">
            {conversations?.length ?? 0} total
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

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations?.map((convo) => {
            const meta = parseMeta(convo.metadata);
            const preview = getLastMessagePreview(convo);
            const isSelected = selectedConvo === convo.id;

            return (
              <button
                key={convo.id}
                onClick={() => setSelectedConvo(convo.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
                  isSelected && "bg-primary/10",
                )}
              >
                {/* Avatar */}
                <div className="relative">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-primary text-primary-foreground font-semibold text-base">
                    {getInitial(convo)}
                  </div>
                  {/* Online dot */}
                  {convo.status !== "closed" && (
                    <div
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card",
                        getStatusDot(convo.status),
                      )}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                      {meta.country && (
                        <span className="text-base leading-none">
                          {countryToFlag(meta.country)}
                        </span>
                      )}
                      {getVisitorDisplayName(convo)}
                    </span>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {timeAgo(convo.updatedAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {preview
                        ? preview.slice(0, 50) + (preview.length > 50 ? "..." : "")
                        : convo.visitorEmail ?? meta.city
                          ? [meta.city, meta.country].filter(Boolean).join(", ")
                          : convo.visitorId}
                    </p>
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
                  </div>
                </div>
              </button>
            );
          })}
          {(!filteredConversations || filteredConversations.length === 0) && (
            <div className="p-8 text-center">
              <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No matching conversations" : "No conversations yet"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Chat Thread ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white/[0.02]">
        {selectedConvo && convoDetail ? (
          <>
            {/* Chat Header */}
            <div className="px-4 py-3 flex items-center gap-3 bg-card border-b border-border">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-foreground font-semibold text-sm">
                {getInitial(convoDetail.conversation)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground truncate">
                    {selectedMeta?.country && (
                      <span className="mr-1.5">
                        {countryToFlag(selectedMeta.country)}
                      </span>
                    )}
                    {getVisitorDisplayName(convoDetail.conversation)}
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {convoDetail.conversation.visitorEmail && (
                    <span>{convoDetail.conversation.visitorEmail}</span>
                  )}
                  {selectedMeta?.city && selectedMeta?.country && (
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {selectedMeta.city}
                      {selectedMeta.region ? `, ${selectedMeta.region}` : ""}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    In chat {formatDuration(convoDetail.conversation.createdAt)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full font-medium",
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
                  {getStatusLabel(convoDetail.conversation.status)}
                </span>
                {convoDetail.conversation.status !== "closed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      closeConversation.mutate(convoDetail.conversation.id)
                    }
                    disabled={closeConversation.isPending}
                    className="text-muted-foreground hover:text-destructive h-8 px-2"
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Visitor info bar */}
            {(selectedMeta?.ip || selectedMeta?.userAgent || selectedMeta?.url) && (
              <div className="px-4 py-1.5 bg-card/80 border-b border-border flex items-center gap-4 text-[11px] text-muted-foreground overflow-x-auto">
                {selectedMeta.ip && (
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <Globe className="w-3 h-3 shrink-0" />
                    {selectedMeta.ip}
                  </span>
                )}
                {selectedMeta.userAgent && (
                  <span className="flex items-center gap-1 truncate">
                    <Monitor className="w-3 h-3 shrink-0" />
                    {selectedMeta.userAgent.length > 60
                      ? selectedMeta.userAgent.slice(0, 60) + "..."
                      : selectedMeta.userAgent}
                  </span>
                )}
                {selectedMeta.url && (
                  <a
                    href={selectedMeta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 truncate hover:underline"
                  >
                    {selectedMeta.url}
                  </a>
                )}
              </div>
            )}

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'a\' patternUnits=\'userSpaceOnUse\' width=\'40\' height=\'40\'%3E%3Cpath d=\'M0 20h40M20 0v40\' fill=\'none\' stroke=\'%23000\' stroke-opacity=\'.02\' stroke-width=\'.5\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'200\' height=\'200\' fill=\'url(%23a)\'/%3E%3C/svg%3E")',
              }}
            >
              {/* Date separator for first message */}
              {convoDetail.messages.length > 0 && (
                <div className="flex justify-center mb-3">
                  <span className="px-3 py-1 rounded-lg bg-card/80 text-[11px] text-muted-foreground font-medium shadow-sm">
                    {new Date(
                      convoDetail.messages[0].createdAt,
                    ).toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}

              {convoDetail.messages.map((msg, idx) => {
                const isVisitor = msg.role === "visitor";
                const isBot = msg.role === "bot";
                const isAgent = msg.role === "agent";

                // Show date separator between messages on different days
                const prevMsg = idx > 0 ? convoDetail.messages[idx - 1] : null;
                const showDateSep =
                  prevMsg &&
                  new Date(msg.createdAt).toDateString() !==
                    new Date(prevMsg.createdAt).toDateString();

                return (
                  <div key={msg.id}>
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

                    <div
                      className={cn(
                        "flex mb-0.5",
                        isVisitor ? "justify-start" : "justify-end",
                      )}
                    >
                      <div
                        className={cn(
                          "relative max-w-[65%] rounded-lg px-3 py-2 shadow-sm",
                          isVisitor &&
                            "bg-card text-foreground rounded-tl-none",
                          isBot &&
                            "bg-primary/10 text-foreground rounded-tr-none border border-primary/20",
                          isAgent &&
                            "bg-primary/15 text-foreground rounded-tr-none border border-primary/20 border-l-2 border-status-replied/50",
                        )}
                      >
                        {/* Role label for bot/agent */}
                        {(isBot || isAgent) && (
                          <div className="flex items-center gap-1 mb-0.5">
                            {isBot && (
                              <span className="text-[11px] font-semibold text-status-active flex items-center gap-0.5">
                                <Bot className="w-3 h-3" />
                                Bot
                              </span>
                            )}
                            {isAgent && (
                              <span className="text-[11px] font-semibold text-status-replied flex items-center gap-0.5">
                                <Headphones className="w-3 h-3" />
                                Agent
                              </span>
                            )}
                          </div>
                        )}

                        {/* Message content */}
                        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
                          {msg.content}
                        </p>

                        {/* Timestamp + checkmarks */}
                        <div
                          className={cn(
                            "flex items-center gap-1 justify-end mt-0.5",
                          )}
                        >
                          <span className="text-[10px] text-muted-foreground/70">
                            {formatTime(msg.createdAt)}
                          </span>
                          {!isVisitor && (
                            <CheckCheck className="w-3.5 h-3.5 text-status-replied/70" />
                          )}
                          {isVisitor && (
                            <Check className="w-3 h-3 text-muted-foreground/40" />
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
            <div className="px-3 py-2 bg-card border-t border-border">
              {convoDetail.conversation.status === "closed" ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <XCircle className="w-4 h-4" />
                  This conversation is closed
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (replyText.trim()) sendReply.mutate();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!replyText.trim() || sendReply.isPending}
                    className="h-10 w-10 rounded-full"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
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
