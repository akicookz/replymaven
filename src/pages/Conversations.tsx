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
  Zap,
  Tag,
  FileText,
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
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";
import { DetailsPanel } from "@/components/DetailsPanel";

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

interface Conversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  closeReason: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  toolExecutions?: ToolExecutionInfo[];
}

interface SourceReference {
  title: string;
  url?: string | null;
  type?: "webpage" | "pdf" | "faq";
}

interface CannedResponse {
  id: string;
  trigger: string;
  response: string;
  status: "draft" | "approved" | "rejected";
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
  const queryClient = useQueryClient();
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedToolCards, setExpandedToolCards] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations, isLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: convoDetail, isPending: isDetailLoading } = useQuery<{
    conversation: Conversation;
    messages: Message[];
    botName: string | null;
    agentName: string | null;
    inquiry: {
      id: string;
      data: Record<string, string>;
      status: string;
      createdAt: string;
    } | null;
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

  const { data: cannedResponses } = useQuery<CannedResponse[]>({
    queryKey: ["canned-responses", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/canned-responses`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const approvedCanned = cannedResponses?.filter(
    (cr) => cr.status === "approved",
  );

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
      <div className="-m-4 md:-m-8 h-screen flex">
        <div className="w-full md:w-[360px] border-r border-border bg-card/30">
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
    <div className="-m-4 md:-m-8 h-screen flex overflow-hidden">
      {/* ─── Left Panel: Conversation List ─────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-card transition-all",
          // On mobile: show full width when no convo selected, hide when convo selected
          selectedConvo ? "hidden md:flex md:w-[360px]" : "w-full md:w-[360px]",
        )}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <MobileMenuButton />
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Conversations</h1>
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
                    <span className="hidden md:inline-flex items-center gap-1">
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
                    <div className="px-4 py-1.5 bg-card/80 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground w-full overflow-hidden cursor-pointer hover:bg-accent/50 transition-colors">
                      {isIdentified ? (
                        <>
                          {customEntries.slice(0, 3).map(([key, value]) => (
                            <span
                              key={key}
                              className="flex items-center gap-1 whitespace-nowrap bg-primary/10 text-primary px-1.5 py-0.5 rounded-md"
                            >
                              <Tag className="w-2.5 h-2.5 shrink-0" />
                              <span className="font-medium">{key}:</span> {value}
                            </span>
                          ))}
                          {currentPage && (
                            <span className="flex items-center gap-1 truncate" title={currentPage}>
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Page:</span>
                              <span className="truncate">{currentPage.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {referrer && (
                            <span className="flex items-center gap-1 truncate" title={referrer}>
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium shrink-0">Referrer:</span>
                              <span className="truncate">{referrer.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                          {currentPage && (
                            <span className="flex items-center gap-1 truncate" title={currentPage}>
                              <Globe className="w-3 h-3 shrink-0" />
                              <span className="font-medium shrink-0">Page:</span>
                              <span className="truncate">{currentPage.replace(/^https?:\/\//, "")}</span>
                            </span>
                          )}
                          {timezone && (
                            <span className="flex items-center gap-1 whitespace-nowrap" title={timezone}>
                              <Clock className="w-3 h-3 shrink-0" />
                              <span className="font-medium">Timezone:</span>
                              {timezone}
                            </span>
                          )}
                          {browserName !== "Unknown" && (
                            <span className="flex items-center gap-1 whitespace-nowrap">
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
              className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-1 min-w-0"
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
                                className="bg-white/[0.03] backdrop-blur-sm rounded-lg border border-border/50 overflow-hidden"
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
                                  <div className="border-t border-border/30">
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
                        "flex mb-0.5 min-w-0",
                        isVisitor ? "justify-start" : "justify-end",
                      )}
                    >
                      <div
                        className={cn(
                          "relative max-w-[85%] sm:max-w-[65%] rounded-lg px-3 py-2 shadow-sm overflow-hidden",
                          isVisitor &&
                            "bg-muted/50 text-foreground rounded-tl-none",
                          isBot &&
                            "bg-primary/[0.07] text-foreground rounded-tr-none",
                          isAgent &&
                            "bg-primary/[0.10] text-foreground rounded-tr-none border-l-2 border-status-replied/50",
                        )}
                      >
                        {/* Role label for bot/agent */}
                        {(isBot || isAgent) && (
                          <div className="flex items-center gap-1 mb-0.5">
                            {isBot && (
                              <span className="text-[11px] font-semibold text-status-active flex items-center gap-0.5">
                                <Bot className="w-3 h-3" />
                                {convoDetail.botName ?? "Bot"}
                              </span>
                            )}
                            {isAgent && (
                              <span className="text-[11px] font-semibold text-status-replied flex items-center gap-0.5">
                                <Headphones className="w-3 h-3" />
                                {convoDetail.agentName ?? "Agent"}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Message content */}
                        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {msg.content}
                        </p>

                        {/* Source links */}
                        {isBot && msg.sources && (() => {
                          try {
                            const sources: SourceReference[] = JSON.parse(msg.sources);
                            if (!Array.isArray(sources) || sources.length === 0) return null;
                            return (
                              <div className="mt-1.5 pt-1.5 border-t border-border/30 space-y-0.5">
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

              {/* Inquiry bubble */}
              {convoDetail.inquiry && (() => {
                const inq = convoDetail.inquiry;
                // Filter out noisy internal fields
                const hiddenKeys = new Set(["Conversation ID", "Recent chat", "Type"]);
                const fields = Object.entries(inq.data).filter(
                  ([key]) => !hiddenKeys.has(key),
                );
                if (fields.length === 0) return null;
                return (
                  <div className="flex justify-start mb-0.5">
                    <div className="relative max-w-[85%] sm:max-w-[65%] rounded-lg rounded-tl-none px-3 py-2 shadow-sm bg-muted/50 text-foreground overflow-hidden">
                      <div className="flex items-center gap-1 mb-1.5">
                        <FileText className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          Inquiry
                        </span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full ml-1",
                          inq.status === "new" && "bg-blue-500/10 text-blue-400",
                          inq.status === "replied" && "bg-emerald-500/10 text-emerald-400",
                          inq.status === "closed" && "bg-muted text-muted-foreground",
                        )}>
                          {inq.status === "new" ? "New" : inq.status === "replied" ? "Replied" : "Closed"}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {fields.map(([key, value]) => (
                          <div key={key} className="text-[13px] leading-relaxed">
                            <span className="font-medium text-foreground/80">{key}:</span>{" "}
                            <span className="text-foreground/70 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-end mt-1">
                        <span className="text-[10px] text-muted-foreground/70">
                          {formatTime(String(inq.createdAt))}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input */}
            <div className="px-3 py-2 bg-card border-t border-border">
              {convoDetail.conversation.status === "closed" ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <XCircle className="w-4 h-4" />
                  {getCloseReasonLabel(convoDetail.conversation.closeReason)}
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (replyText.trim()) sendReply.mutate();
                  }}
                  className="flex items-center gap-2"
                >
                  {approvedCanned && approvedCanned.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Zap className="w-4 h-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        align="start"
                        className="w-72 p-1 max-h-64 overflow-y-auto"
                      >
                        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                          Canned responses
                        </div>
                        {approvedCanned.map((cr) => (
                          <button
                            key={cr.id}
                            type="button"
                            className="flex flex-col gap-0.5 w-full px-2 py-1.5 text-left rounded-lg hover:bg-accent transition-colors"
                            onClick={() => setReplyText(cr.response)}
                          >
                            <span className="text-xs font-medium text-foreground truncate w-full">
                              {cr.trigger}
                            </span>
                            <span className="text-xs text-muted-foreground line-clamp-2">
                              {cr.response}
                            </span>
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
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
