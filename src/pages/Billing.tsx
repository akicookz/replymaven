import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CreditCard,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSubscription } from "@/hooks/use-subscription";
import { formatPlanName, usagePercent, getTrialDaysRemaining } from "@/lib/plan";
import { MobileMenuButton } from "@/components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageLogRow {
  conversationId: string;
  projectId: string;
  projectName: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  botMessageCount: number;
  createdAt: string;
  metadata: Record<string, string> | null;
}

// ─── Usage Bar ────────────────────────────────────────────────────────────────

function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const percent = usagePercent(used, max);
  const isWarning = percent >= 80;
  const isDanger = percent >= 95;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {used.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isDanger
              ? "bg-destructive"
              : isWarning
                ? "bg-yellow-500"
                : "bg-primary"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Status Badge (Subscription) ──────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
    active: { label: "Active", icon: CheckCircle2, className: "text-green-600 bg-green-50" },
    trialing: { label: "Trial", icon: Clock, className: "text-blue-600 bg-blue-50" },
    past_due: { label: "Past Due", icon: AlertTriangle, className: "text-yellow-600 bg-yellow-50" },
    canceled: { label: "Canceled", icon: XCircle, className: "text-red-600 bg-red-50" },
    unpaid: { label: "Unpaid", icon: AlertTriangle, className: "text-red-600 bg-red-50" },
    incomplete: { label: "Incomplete", icon: Clock, className: "text-gray-600 bg-gray-50" },
  };

  const c = config[status] ?? config.incomplete;
  const Icon = c.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.className}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

// ─── Conversation Status Badge ────────────────────────────────────────────────

function ConvoStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-status-active/10 text-status-active" },
    waiting_agent: { label: "Waiting", className: "bg-status-waiting/10 text-status-waiting" },
    agent_replied: { label: "Agent", className: "bg-status-replied/10 text-status-replied" },
    closed: { label: "Closed", className: "bg-status-closed/10 text-status-closed" },
  };

  const c = config[status] ?? { label: status, className: "bg-status-closed/10 text-status-closed" };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

// ─── Sort Header ──────────────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  currentSort,
  currentOrder,
  onSort,
}: {
  label: string;
  field: "botMessages" | "createdAt";
  currentSort: string;
  currentOrder: string;
  onSort: (field: "botMessages" | "createdAt", order: "asc" | "desc") => void;
}) {
  const isActive = currentSort === field;

  return (
    <th
      className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() =>
        onSort(field, isActive && currentOrder === "asc" ? "desc" : "asc")
      }
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentOrder === "asc" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatConvoDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Usage Log Table ──────────────────────────────────────────────────────────

function UsageLog() {
  const navigate = useNavigate();
  const PAGE_SIZE = 25;

  const [sortBy, setSortBy] = useState<"botMessages" | "createdAt">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [metaKey, setMetaKey] = useState<string>("");
  const [metaValue, setMetaValue] = useState<string>("");
  const [appliedMetaKey, setAppliedMetaKey] = useState<string>("");
  const [appliedMetaValue, setAppliedMetaValue] = useState<string>("");
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useQuery<{
    rows: UsageLogRow[];
    total: number;
    metaKeys: string[];
  }>({
    queryKey: [
      "billing-usage-log",
      sortBy,
      sortOrder,
      statusFilter,
      appliedMetaKey,
      appliedMetaValue,
      page,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sortBy,
        sortOrder,
      });
      if (statusFilter) params.set("status", statusFilter);
      if (appliedMetaKey && appliedMetaValue) {
        params.set("metaKey", appliedMetaKey);
        params.set("metaValue", appliedMetaValue);
      }
      const res = await fetch(`/api/billing/usage-log?${params}`);
      if (!res.ok) throw new Error("Failed to fetch usage log");
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const metaKeys = data?.metaKeys ?? [];
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const rangeStart = page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);

  function handleSort(field: "botMessages" | "createdAt", order: "asc" | "desc") {
    setSortBy(field);
    setSortOrder(order);
    setPage(0);
  }

  function handleApplyMeta() {
    if (metaKey && metaValue) {
      setAppliedMetaKey(metaKey);
      setAppliedMetaValue(metaValue);
      setPage(0);
    }
  }

  function handleClearMeta() {
    setMetaKey("");
    setMetaValue("");
    setAppliedMetaKey("");
    setAppliedMetaValue("");
    setPage(0);
  }

  const isMultiProject = rows.length > 0 && rows.some((r) => r.projectId !== rows[0]?.projectId);

  if (isError) {
    return (
      <div className="rounded-xl bg-card p-6 text-center space-y-2">
        <AlertTriangle className="w-6 h-6 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">Failed to load usage log.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Usage Log
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI messages by conversation this billing period.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
            Status
          </label>
          <Select
            value={statusFilter || "all"}
            onValueChange={(v) => {
              setStatusFilter(v === "all" ? "" : v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="waiting_agent">Waiting</SelectItem>
              <SelectItem value="agent_replied">Agent</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {metaKeys.length > 0 && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Metadata
              </label>
              <Select value={metaKey || "none"} onValueChange={(v) => setMetaKey(v === "none" ? "" : v)}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="Key" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Key...</SelectItem>
                  {metaKeys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {metaKey && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                  Contains
                </label>
                <Input
                  value={metaValue}
                  onChange={(e) => setMetaValue(e.target.value)}
                  placeholder="Value..."
                  className="w-[140px] h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApplyMeta();
                  }}
                />
              </div>
            )}

            {metaKey && metaValue && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleApplyMeta}>
                Apply
              </Button>
            )}

            {appliedMetaKey && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs gap-1 text-muted-foreground"
                onClick={handleClearMeta}
              >
                <X className="w-3 h-3" />
                {appliedMetaKey}={appliedMetaValue}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-6">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-6 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Visitor
              </th>
              <SortHeader
                label="AI Messages"
                field="botMessages"
                currentSort={sortBy}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <SortHeader
                label="Date"
                field="createdAt"
                currentSort={sortBy}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-6 py-3" colSpan={4}>
                    <div className="h-4 bg-muted/50 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center">
                  <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No conversations this period.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.conversationId}
                  className="hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() =>
                    navigate(
                      `/app/projects/${row.projectId}/conversations?conv=${row.conversationId}`,
                    )
                  }
                >
                  <td className="px-6 py-2.5">
                    <div className="text-sm font-medium text-foreground truncate max-w-[200px]">
                      {row.visitorName || "Anonymous"}
                    </div>
                    {row.visitorEmail && (
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {row.visitorEmail}
                      </div>
                    )}
                    {isMultiProject && (
                      <div className="text-[10px] text-muted-foreground/70 truncate">
                        {row.projectName}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-medium text-foreground tabular-nums">
                    {row.botMessageCount}
                  </td>
                  <td className="px-3 py-2.5">
                    <ConvoStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {formatConvoDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            {rangeStart}–{rangeEnd} of {total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {page + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Billing Page ─────────────────────────────────────────────────────────────

function Billing() {
  const { data, isLoading } = useSubscription();

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/app/account`,
        }),
      });
      if (!res.ok) throw new Error("Failed to create portal session");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (result) => {
      if (result.url) window.location.href = result.url;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sub = data?.subscription;
  const limits = data?.limits;
  const usage = data?.usage;
  const seats = data?.seats;

  // No subscription
  if (!sub) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Billing</h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Manage your subscription and billing details.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-card p-8 text-center space-y-4">
          <CreditCard className="w-10 h-10 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">No active subscription</p>
            <p className="text-sm text-muted-foreground">
              Choose a plan to get started with ReplyMaven.
            </p>
          </div>
          <Button onClick={() => (window.location.href = "/app/onboarding?step=4")}>
            Choose a Plan
          </Button>
        </div>
      </div>
    );
  }

  const trialDays = getTrialDaysRemaining(sub.trialEndsAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage your subscription and billing details.
          </p>
        </div>
      </div>

      {/* Trial Banner */}
      {sub.status === "trialing" && trialDays > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50">
          <Clock className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              {trialDays} day{trialDays !== 1 ? "s" : ""} left in your trial
            </p>
            <p className="text-xs text-blue-700">
              Your card will be charged when the trial ends.
            </p>
          </div>
        </div>
      )}

      {/* Past Due Banner */}
      {sub.status === "past_due" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center px-4 py-3 rounded-xl bg-yellow-50">
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900">
                Payment failed
              </p>
              <p className="text-xs text-yellow-700">
                Please update your payment method to keep your subscription active.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            className="w-full sm:w-auto shrink-0"
          >
            Update Payment
          </Button>
        </div>
      )}

      {/* Current Plan */}
      <div className="rounded-xl bg-card p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {formatPlanName(sub.plan)} Plan
            </h2>
            <p className="text-sm text-muted-foreground capitalize">
              Billed {sub.interval}
              {sub.cancelAtPeriodEnd && " (cancels at end of period)"}
            </p>
          </div>
          <StatusBadge status={sub.status} />
        </div>

        <Button
          onClick={() => portalMutation.mutate()}
          disabled={portalMutation.isPending}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {portalMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4 mr-2" />
          )}
          Manage Subscription
        </Button>
        <p className="text-xs text-muted-foreground">
          Change plan, update payment method, view invoices, or cancel.
        </p>
      </div>

      {/* Usage */}
      {limits && (
        <div className="rounded-xl bg-card p-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-foreground">Usage</h2>
            {data?.usagePeriodStart && data?.usagePeriodEnd && (
              <p className="text-xs text-muted-foreground">
                {new Date(data.usagePeriodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" — "}
                {new Date(data.usagePeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            )}
          </div>

          <UsageBar
            label="Messages this period"
            used={usage?.messagesUsed ?? 0}
            max={limits.maxMessagesPerMonth}
          />

          <UsageBar
            label="Seats"
            used={seats?.current ?? 1}
            max={limits.maxSeats}
          />
        </div>
      )}

      {/* Usage Log */}
      <UsageLog />
    </div>
  );
}

export default Billing;
