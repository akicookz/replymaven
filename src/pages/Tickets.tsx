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
  Check,
  X,
  Search,
  Filter,
  ArrowUpDown,
  Users,
  ExternalLink,
  Calendar as CalendarIcon,
  MessageSquare,
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

const PAGE_SIZE = 25;

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
  page: number,
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
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
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

  // Page is reset to 0 whenever the filter set changes — staying on page 5
  // after switching to a smaller filtered result would render empty.
  const [page, setPage] = useState(0);
  // Serializing filterKey gives a stable dependency value for useEffect.
  const filterKeySerialized = JSON.stringify(filterKey);
  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [filterKeySerialized]);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const {
    data: ticketsPage,
    isLoading,
    isError,
    refetch,
  } = useQuery<{ rows: Ticket[]; hasMore: boolean }>({
    queryKey: ["tickets", projectId, filterKey, page],
    queryFn: async () => {
      const qs = buildQueryString(filters, sessionUserId, page);
      const res = await fetch(`/api/projects/${projectId}/tickets?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: !!projectId,
  });
  const tickets = ticketsPage?.rows;
  const hasMore = ticketsPage?.hasMore ?? false;

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
      const previous = queryClient.getQueriesData<{
        rows: Ticket[];
        hasMore: boolean;
      }>({
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
      queryClient.setQueriesData<{ rows: Ticket[]; hasMore: boolean }>(
        { queryKey: ["tickets", projectId] },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.map((t) =>
                  t.id === ticketId ? { ...t, ...optimistic } : t,
                ),
              }
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
      queryClient.setQueriesData<{ rows: Ticket[]; hasMore: boolean }>(
        { queryKey: ["tickets", projectId] },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.map((t) =>
                  t.id === updated.id ? updated : t,
                ),
              }
            : old,
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
      queryClient.setQueriesData<{ rows: Ticket[]; hasMore: boolean }>(
        { queryKey: ["tickets", projectId] },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.map((t) =>
                  ids.includes(t.id) ? { ...t, status } : t,
                ),
              }
            : old,
      );
      setSelectedIds(new Set());
      toast.success(
        `${ids.length} ticket${ids.length > 1 ? "s" : ""} marked as ${STATUS_CONFIG[status].label.toLowerCase()}`,
      );
    },
    onError: () => toast.error("Failed to update tickets"),
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
    setSheetOpen(true);
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
          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
              <span>
                {`Showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + list.length}${hasMore ? "" : ` of ${page * PAGE_SIZE + list.length}`}`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="px-2">Page {page + 1}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Detail / Compose Sheet ───────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="sm:max-w-lg w-full flex flex-col gap-0"
        >
          {selectedTicket && (
            <DetailView
              ticket={selectedTicket}
              projectId={projectId!}
              assignableUsers={assignableUsers ?? []}
              onChange={(patch) =>
                propertyMutation.mutate({
                  ticketId: selectedTicket.id,
                  patch,
                })
              }
              isMutating={propertyMutation.isPending}
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
  onChange,
  isMutating,
}: {
  ticket: Ticket;
  projectId: string;
  assignableUsers: AssignableUser[];
  onChange: (patch: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigneeId?: string | null;
    dueDate?: string | null;
  }) => void;
  isMutating: boolean;
}) {
  const overdue = isPastDue(ticket);
  const dueValue = toDueDateInputValue(ticket.dueDate);
  const dueDisplay = ticket.dueDate
    ? new Date(ticket.dueDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <>
      {/* ─── Header: title + submitted-time ────────────────────────────────── */}
      <SheetHeader className="pb-3">
        <SheetTitle className="text-base font-semibold truncate">
          {ticket.title || "Ticket"}
        </SheetTitle>
        <SheetDescription className="text-xs">
          Submitted {formatTimeAgo(ticket.createdAt)}
          {overdue && (
            <span className="ml-2 text-destructive font-medium">· Overdue</span>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-6">
        {/* ─── Properties (label / control rows) ─────────────────────────── */}
        <section>
          <SectionLabel>Properties</SectionLabel>
          <div className="rounded-xl bg-muted/40 divide-y divide-transparent">
            <PropertyRow label="Status">
              <Select
                value={ticket.status}
                onValueChange={(v) => onChange({ status: v as TicketStatus })}
                disabled={isMutating}
              >
                <SelectTrigger className="h-8 text-xs w-[160px]" size="sm">
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

            <PropertyRow label="Priority">
              <Select
                value={ticket.priority}
                onValueChange={(v) =>
                  onChange({ priority: v as TicketPriority })
                }
                disabled={isMutating}
              >
                <SelectTrigger className="h-8 text-xs w-[160px]" size="sm">
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
                <SelectTrigger className="h-8 text-xs w-[160px]" size="sm">
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

            <PropertyRow label="Due date">
              <div
                className={cn(
                  "relative inline-flex items-center w-[160px] h-8 rounded-lg bg-background border border-input focus-within:ring-1 focus-within:ring-ring",
                  overdue && "border-destructive/40",
                )}
              >
                <CalendarIcon
                  className={cn(
                    "absolute left-2 w-3.5 h-3.5 pointer-events-none",
                    overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                />
                {/* Native input is the picker. Text rendered transparent so
                    we can overlay a formatted, theme-consistent date label. */}
                <input
                  type="date"
                  value={dueValue}
                  onChange={(e) =>
                    onChange({
                      dueDate: fromDueDateInputValue(e.target.value),
                    })
                  }
                  disabled={isMutating}
                  aria-label="Due date"
                  className={cn(
                    "absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-lg",
                    "[color-scheme:dark]",
                  )}
                />
                <span
                  className={cn(
                    "pl-7 pr-7 text-xs pointer-events-none truncate",
                    overdue
                      ? "text-destructive"
                      : dueDisplay
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {dueDisplay ?? "Set date"}
                </span>
                {ticket.dueDate && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange({ dueDate: null });
                    }}
                    disabled={isMutating}
                    className="absolute right-1 z-10 p-1 rounded hover:bg-muted text-muted-foreground"
                    aria-label="Clear due date"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </PropertyRow>
          </div>
        </section>

        {/* ─── Submitted form data ───────────────────────────────────────── */}
        {Object.keys(ticket.data).length > 0 && (
          <section>
            <SectionLabel>Submitted fields</SectionLabel>
            <div className="rounded-xl bg-muted/40 p-3">
              <DetailsPanel fields={ticket.data} />
            </div>
          </section>
        )}
      </div>

      {/* ─── Footer: single primary action ─────────────────────────────────── */}
      <SheetFooter className="px-4 py-3 bg-card/50">
        {ticket.conversationId ? (
          <Button asChild className="w-full gap-1.5">
            <Link
              to={`/app/projects/${projectId}/conversations?id=${ticket.conversationId}`}
            >
              <MessageSquare className="w-4 h-4" />
              Reply in conversation
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground text-center w-full">
            No linked conversation. Reach the visitor at their submitted email.
          </p>
        )}
      </SheetFooter>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
      {children}
    </h4>
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
    <div className="flex items-center justify-between gap-3 px-3 py-2 first:pt-3 last:pb-3">
      <span className="text-xs text-muted-foreground font-medium">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

export default Tickets;
