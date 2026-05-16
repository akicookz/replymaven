import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ticket as TicketIcon,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ArrowLeft,
  Loader2,
  Mail,
  Send,
  X,
  Search,
  Filter,
  ArrowUpDown,
  Users,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";
import { DetailsPanel } from "@/components/DetailsPanel";
import { useSession } from "@/lib/auth-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
type TicketPriority = "low" | "medium" | "high" | "urgent";

interface TicketAssignee {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface Ticket {
  id: string;
  projectId: string;
  conversationId: string | null;
  visitorId: string | null;
  title: string;
  data: Record<string, string>;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assignee: TicketAssignee | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AssignableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
}

interface ComposeReply {
  subject: string;
  body: string;
}

type MailClient = "default" | "gmail" | "outlook" | "proton";

const MAIL_CLIENTS: { key: MailClient; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "gmail", label: "Gmail" },
  { key: "outlook", label: "Outlook" },
  { key: "proton", label: "Proton Mail" },
];

type StatusTab = "all" | TicketStatus;

type SortOption =
  | "createdAt:desc"
  | "updatedAt:desc"
  | "dueDate:asc"
  | "priority:desc"
  | "status:asc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "createdAt:desc", label: "Created (newest first)" },
  { value: "updatedAt:desc", label: "Updated (newest first)" },
  { value: "dueDate:asc", label: "Due date (soonest first)" },
  { value: "priority:desc", label: "Priority (highest first)" },
  { value: "status:asc", label: "Status" },
];

const STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-blue-500/10 text-blue-400" },
  in_progress: {
    label: "In progress",
    className: "bg-amber-500/10 text-amber-400",
  },
  resolved: {
    label: "Resolved",
    className: "bg-emerald-500/10 text-emerald-400",
  },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
};

const PRIORITY_CONFIG: Record<
  TicketPriority,
  { label: string; className: string }
> = {
  urgent: { label: "Urgent", className: "bg-red-500/10 text-red-400" },
  high: { label: "High", className: "bg-amber-500/10 text-amber-400" },
  medium: { label: "Medium", className: "bg-blue-500/10 text-blue-400" },
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
};

const PRIORITY_OPTIONS: TicketPriority[] = ["urgent", "high", "medium", "low"];
const STATUS_OPTIONS: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDue(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const absMins = Math.abs(diffMins);
  if (absMins < 60) {
    if (diffMins >= 0) return `in ${absMins}m`;
    return `${absMins}m ago`;
  }
  const diffHours = Math.round(diffMins / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
    if (diffHours >= 0) return `in ${absHours}h`;
    return `${absHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  const absDays = Math.abs(diffDays);
  if (absDays < 30) {
    if (diffDays >= 0) return `in ${absDays}d`;
    return `${absDays}d ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getVisitorEmail(data: Record<string, string>): string | null {
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().includes("email")) {
      const val = data[key];
      if (val && val.includes("@")) return val;
    }
  }
  return null;
}

function getVisitorName(data: Record<string, string>): string | null {
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().includes("name")) {
      const val = data[key];
      if (val) return val;
    }
  }
  return null;
}

function buildMailUrl(
  client: MailClient,
  to: string,
  subject: string,
  body: string,
): string {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  switch (client) {
    case "gmail":
      return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodedSubject}&body=${encodedBody}`;
    case "outlook":
      return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodedSubject}&body=${encodedBody}`;
    case "proton":
      return `https://mail.proton.me/u/0/compose?to=${encodeURIComponent(to)}&Subject=${encodedSubject}&Body=${encodedBody}`;
    default:
      return `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;
  }
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

function toDueDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromDueDateInputValue(value: string): string | null {
  if (!value) return null;
  // Treat value as end-of-day local time
  const [yyyy, mm, dd] = value.split("-").map((n) => Number(n));
  const date = new Date(yyyy, mm - 1, dd, 23, 59, 59, 999);
  return date.toISOString();
}

function isPastDue(ticket: Ticket): boolean {
  if (!ticket.dueDate) return false;
  if (ticket.status === "resolved" || ticket.status === "closed") return false;
  return new Date(ticket.dueDate).getTime() < Date.now();
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface TicketFilters {
  status: StatusTab;
  priority: TicketPriority[];
  assignee: "anyone" | "me" | "unassigned" | { kind: "user"; id: string };
  q: string;
  sort: SortOption;
}

function buildQueryString(
  filters: TicketFilters,
  sessionUserId: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.append("status", filters.status);
  for (const p of filters.priority) params.append("priority", p);
  if (filters.assignee === "unassigned") {
    params.set("unassigned", "true");
  } else if (filters.assignee === "me" && sessionUserId) {
    params.set("assigneeId", sessionUserId);
  } else if (
    typeof filters.assignee === "object" &&
    filters.assignee.kind === "user"
  ) {
    params.set("assigneeId", filters.assignee.id);
  }
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const [sortBy, sortDir] = filters.sort.split(":");
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);
  params.set("limit", "100");
  params.set("offset", "0");
  return params.toString();
}

function assigneeFilterKey(
  assignee: TicketFilters["assignee"],
): string {
  if (typeof assignee === "string") return assignee;
  return `user:${assignee.id}`;
}

function filtersAreActive(filters: TicketFilters): boolean {
  return (
    filters.status !== "all" ||
    filters.priority.length > 0 ||
    filters.assignee !== "anyone" ||
    filters.q.trim().length > 0
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function Tickets() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const sessionUserId = session?.user?.id ?? null;

  const [filters, setFilters] = useState<TicketFilters>({
    status: "all",
    priority: [],
    assignee: "anyone",
    q: "",
    sort: "createdAt:desc",
  });

  // Debounced search input
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput ? prev : { ...prev, q: searchInput }));
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<"details" | "compose">("details");
  const [composeData, setComposeData] = useState<ComposeReply | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    if (!sheetOpen) {
      const timer = setTimeout(() => {
        setView("details");
        setComposeData(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [sheetOpen]);

  const filterKey = useMemo(
    () => ({
      status: filters.status,
      priority: [...filters.priority].sort(),
      assignee: assigneeFilterKey(filters.assignee),
      q: filters.q,
      sort: filters.sort,
    }),
    [filters],
  );

  // ─── Queries ────────────────────────────────────────────────────────────────

  const {
    data: tickets,
    isLoading,
    isError,
    refetch,
  } = useQuery<Ticket[]>({
    queryKey: ["tickets", projectId, filterKey],
    queryFn: async () => {
      const qs = buildQueryString(filters, sessionUserId);
      const res = await fetch(`/api/projects/${projectId}/tickets?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: !!projectId,
  });

  const { data: assignableUsers } = useQuery<AssignableUser[]>({
    queryKey: ["assignable-users", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/assignable-users`,
      );
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: !!projectId,
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  interface PropertyPatch {
    ticketId: string;
    patch: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: string | null;
      dueDate?: string | null;
    };
  }

  const propertyMutation = useMutation({
    mutationFn: async ({ ticketId, patch }: PropertyPatch) => {
      const res = await fetch(
        `/api/projects/${projectId}/tickets/${ticketId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) throw new Error("Failed to update");
      return res.json() as Promise<Ticket>;
    },
    onMutate: async ({ ticketId, patch }) => {
      await queryClient.cancelQueries({ queryKey: ["tickets", projectId] });
      const previous = queryClient.getQueriesData<Ticket[]>({
        queryKey: ["tickets", projectId],
      });
      // Resolve the assignee object alongside assigneeId so the UI doesn't
      // render a stale name/avatar until onSuccess fires.
      const resolvedAssignee: TicketAssignee | null | undefined =
        patch.assigneeId === undefined
          ? undefined
          : patch.assigneeId === null
            ? null
            : assignableUsers?.find((u) => u.id === patch.assigneeId)
              ? {
                  id: patch.assigneeId,
                  name: assignableUsers.find((u) => u.id === patch.assigneeId)!
                    .name,
                  email: assignableUsers.find((u) => u.id === patch.assigneeId)!
                    .email,
                  image: assignableUsers.find((u) => u.id === patch.assigneeId)!
                    .image,
                }
              : null;
      const optimistic: Partial<Ticket> = {
        ...patch,
        ...(resolvedAssignee !== undefined ? { assignee: resolvedAssignee } : {}),
      };
      queryClient.setQueriesData<Ticket[]>(
        { queryKey: ["tickets", projectId] },
        (old) =>
          old
            ? old.map((t) =>
                t.id === ticketId ? { ...t, ...optimistic } : t,
              )
            : old,
      );
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket({ ...selectedTicket, ...optimistic });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, val] of context.previous) {
          queryClient.setQueryData(key, val);
        }
      }
      toast.error("Failed to update ticket");
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<Ticket[]>(
        { queryKey: ["tickets", projectId] },
        (old) => (old ? old.map((t) => (t.id === updated.id ? updated : t)) : old),
      );
      if (selectedTicket?.id === updated.id) {
        setSelectedTicket(updated);
      }
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: TicketStatus;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/tickets/bulk-status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status }),
        },
      );
      if (!res.ok) throw new Error("Failed to update");
      return { ids, status };
    },
    onSuccess: ({ ids, status }) => {
      queryClient.setQueriesData<Ticket[]>(
        { queryKey: ["tickets", projectId] },
        (old) =>
          old
            ? old.map((t) =>
                ids.includes(t.id) ? { ...t, status } : t,
              )
            : old,
      );
      setSelectedIds(new Set());
      toast.success(
        `${ids.length} ticket${ids.length > 1 ? "s" : ""} marked as ${STATUS_CONFIG[status].label.toLowerCase()}`,
      );
    },
    onError: () => toast.error("Failed to update tickets"),
  });

  const composeMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/tickets/${ticketId}/compose`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to compose");
      return res.json() as Promise<ComposeReply>;
    },
    onSuccess: (data) => {
      setComposeData(data);
      setEditSubject(data.subject);
      setEditBody(data.body);
      setView("compose");
    },
    onError: () => toast.error("Failed to compose reply"),
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const list = useMemo(() => tickets ?? [], [tickets]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === list.length && list.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(list.map((t) => t.id)));
    }
  }

  function handleBulkStatus(status: TicketStatus) {
    if (selectedIds.size === 0) return;
    bulkStatusMutation.mutate({ ids: Array.from(selectedIds), status });
  }

  function handleOpenTicket(ticket: Ticket) {
    setSelectedTicket(ticket);
    setView("details");
    setComposeData(null);
    setSheetOpen(true);
  }

  function handleCompose() {
    if (!selectedTicket) return;
    composeMutation.mutate(selectedTicket.id);
  }

  function handleOpenInMail(client: MailClient) {
    if (!selectedTicket) return;
    const email = getVisitorEmail(selectedTicket.data);
    if (!email) return;
    const url = buildMailUrl(client, email, editSubject, editBody);
    window.open(url, "_blank");
    localStorage.setItem("replymaven:mailClient", client);
    if (selectedTicket.status !== "resolved") {
      propertyMutation.mutate({
        ticketId: selectedTicket.id,
        patch: { status: "resolved" },
      });
    }
  }

  function handleCopyBody() {
    navigator.clipboard.writeText(editBody);
  }

  function clearFilters() {
    setFilters({
      status: "all",
      priority: [],
      assignee: "anyone",
      q: "",
      sort: filters.sort,
    });
    setSearchInput("");
  }

  function togglePriority(p: TicketPriority) {
    setFilters((prev) => {
      const has = prev.priority.includes(p);
      return {
        ...prev,
        priority: has
          ? prev.priority.filter((x) => x !== p)
          : [...prev.priority, p],
      };
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const savedClient = (localStorage.getItem("replymaven:mailClient") ||
    "default") as MailClient;

  const statusCounts = useMemo(() => {
    const counts = { all: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const t of list) {
      counts.all++;
      counts[t.status]++;
    }
    return counts;
  }, [list]);

  const assigneeLabel = useMemo(() => {
    const a = filters.assignee;
    if (a === "anyone") return "Anyone";
    if (a === "me") return "Assigned to me";
    if (a === "unassigned") return "Unassigned";
    const u = assignableUsers?.find((user) => user.id === a.id);
    return u?.name ?? "Assignee";
  }, [filters.assignee, assignableUsers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Tickets
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Track and respond to ticket submissions.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status segmented control */}
        <div className="inline-flex bg-muted rounded-lg p-0.5 shrink-0">
          {(["all", "open", "in_progress", "resolved", "closed"] as const).map(
            (tab) => (
              <button
                key={tab}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, status: tab }))
                }
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition-all flex items-center gap-1.5",
                  filters.status === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "all" ? "All" : STATUS_CONFIG[tab].label}
                <span className="text-[10px] opacity-60">
                  {statusCounts[tab]}
                </span>
              </button>
            ),
          )}
        </div>

        {/* Priority multi-select */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
            >
              <Filter className="w-3.5 h-3.5" />
              Priority
              {filters.priority.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 h-4 px-1 text-[10px] bg-primary/10 text-primary"
                >
                  {filters.priority.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1.5">
            <div className="space-y-0.5">
              {PRIORITY_OPTIONS.map((p) => {
                const checked = filters.priority.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePriority(p)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent"
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", PRIORITY_CONFIG[p].className)}
                    >
                      {PRIORITY_CONFIG[p].label}
                    </Badge>
                  </button>
                );
              })}
            </div>
            {filters.priority.length > 0 && (
              <button
                onClick={() =>
                  setFilters((prev) => ({ ...prev, priority: [] }))
                }
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 mt-1"
              >
                Clear
              </button>
            )}
          </PopoverContent>
        </Popover>

        {/* Assignee dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
            >
              <Users className="w-3.5 h-3.5" />
              {assigneeLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onSelect={() =>
                setFilters((prev) => ({ ...prev, assignee: "anyone" }))
              }
            >
              Anyone
              {filters.assignee === "anyone" && (
                <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!sessionUserId}
              onSelect={() =>
                setFilters((prev) => ({ ...prev, assignee: "me" }))
              }
            >
              Assigned to me
              {filters.assignee === "me" && (
                <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setFilters((prev) => ({ ...prev, assignee: "unassigned" }))
              }
            >
              Unassigned
              {filters.assignee === "unassigned" && (
                <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />
              )}
            </DropdownMenuItem>
            {assignableUsers && assignableUsers.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Team members
                </DropdownMenuLabel>
                {assignableUsers.map((u) => {
                  const active =
                    typeof filters.assignee === "object" &&
                    filters.assignee.id === u.id;
                  return (
                    <DropdownMenuItem
                      key={u.id}
                      onSelect={() =>
                        setFilters((prev) => ({
                          ...prev,
                          assignee: { kind: "user", id: u.id },
                        }))
                      }
                    >
                      <AssigneeAvatar user={u} size="xs" />
                      <span className="ml-2 truncate">{u.name}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tickets..."
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Sort */}
        <Select
          value={filters.sort}
          onValueChange={(v) =>
            setFilters((prev) => ({ ...prev, sort: v as SortOption }))
          }
        >
          <SelectTrigger
            className="h-9 w-auto gap-1.5 text-xs"
            size="sm"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-card/80 backdrop-blur-xl rounded-xl sticky top-2 z-20">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={bulkStatusMutation.isPending}
              onClick={() => handleBulkStatus(s)}
            >
              {STATUS_CONFIG[s].label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Failed to load tickets.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && list.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <TicketIcon className="w-6 h-6 text-muted-foreground" />
          </div>
          {filtersAreActive(filters) ? (
            <>
              <p className="text-sm text-muted-foreground">
                No tickets match these filters.
              </p>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                No tickets yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Visitors can submit a ticket using the ticket form in your
                widget. Submissions will appear here.
              </p>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && list.length > 0 && (
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 w-9">
                    <Checkbox
                      checked={
                        selectedIds.size === list.length && list.length > 0
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Title</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Assignee</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="px-3 py-2.5 font-medium">Created</th>
                  <th className="px-3 py-2.5 font-medium w-12 text-right">
                    Conversation
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <TicketRow
                    key={t.id}
                    ticket={t}
                    projectId={projectId!}
                    selected={selectedIds.has(t.id)}
                    onToggleSelect={() => toggleSelected(t.id)}
                    onOpen={() => handleOpenTicket(t)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Detail / Compose Sheet ───────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="sm:max-w-lg w-full flex flex-col gap-0"
        >
          {selectedTicket && view === "details" && (
            <DetailView
              ticket={selectedTicket}
              projectId={projectId!}
              assignableUsers={assignableUsers ?? []}
              onCompose={handleCompose}
              isComposing={composeMutation.isPending}
              onChange={(patch) =>
                propertyMutation.mutate({
                  ticketId: selectedTicket.id,
                  patch,
                })
              }
              isMutating={propertyMutation.isPending}
            />
          )}

          {selectedTicket && view === "compose" && (
            <ComposeView
              ticket={selectedTicket}
              composeData={composeData}
              isLoading={composeMutation.isPending}
              editSubject={editSubject}
              editBody={editBody}
              onSubjectChange={setEditSubject}
              onBodyChange={setEditBody}
              onBack={() => setView("details")}
              onCopyBody={handleCopyBody}
              onOpenInMail={handleOpenInMail}
              savedClient={savedClient}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function AssigneeAvatar({
  user,
  size = "sm",
}: {
  user: TicketAssignee | AssignableUser;
  size?: "xs" | "sm";
}) {
  const cls = size === "xs" ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]";
  if (user.image) {
    return (
      <img
        src={user.image}
        alt={user.name}
        className={cn("rounded-full object-cover shrink-0", cls)}
      />
    );
  }
  return (
    <div
      className={cn(
        "rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold shrink-0",
        cls,
      )}
    >
      {getInitials(user.name)}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  projectId,
  selected,
  onToggleSelect,
  onOpen,
}: {
  ticket: Ticket;
  projectId: string;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const email = getVisitorEmail(ticket.data);
  const visitorName = getVisitorName(ticket.data);
  const subInfo = email ?? visitorName;
  const overdue = isPastDue(ticket);

  return (
    <tr
      onClick={onOpen}
      className={cn(
        "cursor-pointer transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/40",
      )}
    >
      <td
        className="px-3 py-3 align-top"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
      </td>
      <td className="px-3 py-3 align-top max-w-[280px]">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {ticket.title || "Untitled ticket"}
          </span>
          {subInfo && (
            <span className="text-xs text-muted-foreground truncate mt-0.5">
              {subInfo}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            STATUS_CONFIG[ticket.status].className,
          )}
        >
          {STATUS_CONFIG[ticket.status].label}
        </Badge>
      </td>
      <td className="px-3 py-3 align-top">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            PRIORITY_CONFIG[ticket.priority].className,
          )}
        >
          {PRIORITY_CONFIG[ticket.priority].label}
        </Badge>
      </td>
      <td className="px-3 py-3 align-top">
        {ticket.assignee ? (
          <div className="flex items-center gap-2 min-w-0">
            <AssigneeAvatar user={ticket.assignee} size="xs" />
            <span className="text-xs text-foreground truncate">
              {ticket.assignee.name}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        {ticket.dueDate ? (
          <span
            className={cn(
              "text-xs",
              overdue ? "text-red-400 font-medium" : "text-muted-foreground",
            )}
          >
            {formatRelativeDue(ticket.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3 align-top">
        <span className="text-xs text-muted-foreground">
          {formatTimeAgo(ticket.createdAt)}
        </span>
      </td>
      <td
        className="px-3 py-3 align-top text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {ticket.conversationId && (
          <Link
            to={`/app/projects/${projectId}/conversations?id=${ticket.conversationId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Open conversation"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
      </td>
    </tr>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function DetailView({
  ticket,
  projectId,
  assignableUsers,
  onCompose,
  isComposing,
  onChange,
  isMutating,
}: {
  ticket: Ticket;
  projectId: string;
  assignableUsers: AssignableUser[];
  onCompose: () => void;
  isComposing: boolean;
  onChange: (patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string | null;
    dueDate?: string | null;
  }) => void;
  isMutating: boolean;
}) {
  const overdue = isPastDue(ticket);

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <SheetTitle className="truncate">
            {ticket.title || "Ticket details"}
          </SheetTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              STATUS_CONFIG[ticket.status].className,
            )}
          >
            {STATUS_CONFIG[ticket.status].label}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              PRIORITY_CONFIG[ticket.priority].className,
            )}
          >
            {PRIORITY_CONFIG[ticket.priority].label}
          </Badge>
        </div>
        <SheetDescription>
          Submitted {formatTimeAgo(ticket.createdAt)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Properties */}
        <div className="space-y-2.5">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Properties
          </h4>
          <div className="bg-muted/50 rounded-xl p-3 space-y-2.5">
            {/* Status */}
            <PropertyRow label="Status">
              <Select
                value={ticket.status}
                onValueChange={(v) =>
                  onChange({ status: v as TicketStatus })
                }
                disabled={isMutating}
              >
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_CONFIG[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            {/* Priority */}
            <PropertyRow label="Priority">
              <Select
                value={ticket.priority}
                onValueChange={(v) =>
                  onChange({ priority: v as TicketPriority })
                }
                disabled={isMutating}
              >
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_CONFIG[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            {/* Assignee */}
            <PropertyRow label="Assignee">
              <Select
                value={ticket.assigneeId ?? "__unassigned__"}
                onValueChange={(v) =>
                  onChange({
                    assigneeId: v === "__unassigned__" ? null : v,
                  })
                }
                disabled={isMutating}
              >
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            {/* Due date */}
            <PropertyRow label="Due date">
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={toDueDateInputValue(ticket.dueDate)}
                  onChange={(e) =>
                    onChange({ dueDate: fromDueDateInputValue(e.target.value) })
                  }
                  disabled={isMutating}
                  className={cn(
                    "h-8 px-2 text-xs rounded-lg bg-background border border-input outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    overdue && "text-red-400",
                  )}
                />
                {ticket.dueDate && (
                  <button
                    onClick={() => onChange({ dueDate: null })}
                    disabled={isMutating}
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                    aria-label="Clear due date"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </PropertyRow>
          </div>
        </div>

        {/* Form data */}
        {Object.keys(ticket.data).length > 0 && (
          <DetailsPanel
            fields={ticket.data}
            fieldsLabel="Submitted fields"
          />
        )}
      </div>

      {/* Footer */}
      <SheetFooter className="flex-col gap-2 pt-3">
        <div className="flex items-center gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={onCompose}
            disabled={isComposing}
            className="gap-1.5"
          >
            {isComposing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {isComposing ? "Composing…" : "Compose Reply"}
          </Button>
          {ticket.conversationId && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="gap-1.5 text-muted-foreground"
            >
              <Link
                to={`/app/projects/${projectId}/conversations?id=${ticket.conversationId}`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open conversation
              </Link>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 w-full">
          {STATUS_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={ticket.status === s ? "default" : "outline"}
              size="sm"
              disabled={isMutating || ticket.status === s}
              onClick={() => onChange({ status: s })}
              className="h-7 text-xs"
            >
              {STATUS_CONFIG[s].label}
            </Button>
          ))}
        </div>
      </SheetFooter>
    </>
  );
}

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </span>
      <div className="min-w-[160px]">{children}</div>
    </div>
  );
}

// ─── Compose View ─────────────────────────────────────────────────────────────

function ComposeView({
  ticket,
  composeData,
  isLoading,
  editSubject,
  editBody,
  onSubjectChange,
  onBodyChange,
  onBack,
  onCopyBody,
  onOpenInMail,
  savedClient,
}: {
  ticket: Ticket;
  composeData: ComposeReply | null;
  isLoading: boolean;
  editSubject: string;
  editBody: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onBack: () => void;
  onCopyBody: () => void;
  onOpenInMail: (client: MailClient) => void;
  savedClient: MailClient;
}) {
  const [bodyCopied, setBodyCopied] = useState(false);
  const email = getVisitorEmail(ticket.data);

  function handleCopy() {
    onCopyBody();
    setBodyCopied(true);
    setTimeout(() => setBodyCopied(false), 1500);
  }

  function handleOpenInMail(client: MailClient) {
    onOpenInMail(client);
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <SheetTitle>Compose Reply</SheetTitle>
        </div>
        {email && <SheetDescription>To: {email}</SheetDescription>}
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-4 px-4 py-3">
        {isLoading && !composeData && (
          <div className="space-y-3">
            <div className="h-10 rounded-lg bg-muted/50 animate-pulse" />
            <div className="h-48 rounded-xl bg-muted/50 animate-pulse" />
            <p className="text-xs text-muted-foreground text-center">
              Composing reply…
            </p>
          </div>
        )}

        {composeData && (
          <>
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 block">
                Subject
              </label>
              <Input
                value={editSubject}
                onChange={(e) => onSubjectChange(e.target.value)}
                className="text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 block">
                Body
              </label>
              <textarea
                value={editBody}
                onChange={(e) => onBodyChange(e.target.value)}
                className="w-full min-h-[240px] bg-muted/30 rounded-xl p-4 text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}
      </div>

      {composeData && (
        <SheetFooter className="flex-row gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5"
          >
            {bodyCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {bodyCopied ? "Copied" : "Copy"}
          </Button>

          <div className="flex items-center ml-auto">
            <Button
              size="sm"
              onClick={() => handleOpenInMail(savedClient)}
              className="gap-1.5 rounded-r-none"
              disabled={!email}
            >
              <Send className="w-3.5 h-3.5" />
              Open in{" "}
              {MAIL_CLIENTS.find((c) => c.key === savedClient)?.label ?? "Mail"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  disabled={!email}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MAIL_CLIENTS.map((client) => (
                  <DropdownMenuItem
                    key={client.key}
                    onSelect={() => handleOpenInMail(client.key)}
                  >
                    <Mail className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    {client.label}
                    {client.key === savedClient && (
                      <Check className="w-3 h-3 ml-auto text-emerald-400" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetFooter>
      )}
    </>
  );
}

export default Tickets;
