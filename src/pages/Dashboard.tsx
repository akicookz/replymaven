import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  FolderOpen,
  Users,
  Bot,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Mail,
  Clock,
  Globe,
} from "lucide-react";
import { Link, useParams, Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationsByDay {
  day: string;
  count: number;
}

interface RecentConversation {
  id: string;
  projectId: string;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  metadata: string | null;
  updatedAt: string;
}

interface ConvoMeta {
  country?: string;
  city?: string;
  region?: string;
  [key: string]: unknown;
}

function parseConvoMeta(metadata: string | null): ConvoMeta {
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

interface RecentBooking {
  id: string;
  visitorName: string;
  visitorEmail: string;
  startTime: string;
  status: string;
  createdAt: string;
}

interface RecentContactSubmission {
  id: string;
  visitorId: string | null;
  data: string;
  createdAt: string;
}

interface DashboardData {
  totalProjects?: number;
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  totalResources: number;
  pendingCannedDrafts: number;
  conversationsByDay: ConversationsByDay[];
  recentConversations: RecentConversation[];
  recentBookings: RecentBooking[];
  recentContactSubmissions: RecentContactSubmission[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  waiting_agent: "Waiting",
  agent_replied: "Replied",
  closed: "Closed",
};

const STATUS_BADGE_STYLES: Record<string, string> = {
  active: "bg-status-active/10 text-status-active border-status-active/25",
  waiting_agent: "bg-status-waiting/10 text-status-waiting border-status-waiting/25",
  agent_replied: "bg-status-replied/10 text-status-replied border-status-replied/25",
  closed: "bg-status-closed/10 text-status-closed border-status-closed/25",
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  change,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  change?: { value: number; positive: boolean };
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
          <Icon className="w-[18px] h-[18px] text-muted-foreground" />
        </div>
        <span className="text-[13px] text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold text-foreground tracking-tight">
          {value.toLocaleString()}
        </span>
        {change && (
          <span
            className={cn(
              "text-[13px] font-medium flex items-center gap-0.5",
              change.positive ? "text-success" : "text-destructive",
            )}
          >
            {change.positive ? (
              <ArrowUpRight className="w-3.5 h-3.5" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5" />
            )}
            {change.positive ? "+" : ""}
            {change.value}%
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fillDailyData(data: ConversationsByDay[]): ConversationsByDay[] {
  const filled: ConversationsByDay[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split("T")[0];
    const existing = data.find((item) => item.day === dayStr);
    filled.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      count: existing?.count ?? 0,
    });
  }
  return filled;
}

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
  return `${diffDays}d ago`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "there";

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?projectId=${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    enabled: !!projectId,
  });

  if (!projectId) {
    return <Navigate to="/app" replace />;
  }

  // ─── Loading State ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Greeting */}
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              Hello, {userName.split(" ")[0]}
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              What are you working on?
            </p>
          </div>
        </div>
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[104px] rounded-xl bg-card border border-border animate-pulse"
            />
          ))}
        </div>
        {/* Chart + actions skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 h-[340px] rounded-xl bg-card border border-border animate-pulse" />
          <div className="h-[340px] rounded-xl bg-card border border-border animate-pulse" />
        </div>
        {/* Table + status skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 h-[280px] rounded-xl bg-card border border-border animate-pulse" />
          <div className="h-[280px] rounded-xl bg-card border border-border animate-pulse" />
        </div>
      </div>
    );
  }

  // ─── Empty State ──────────────────────────────────────────────────────────

  if (!data || data.totalConversations === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            Welcome to ReplyMaven
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            No conversations yet. Add knowledge resources and embed the chat widget on your site to get started.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link to={`/app/projects/${projectId}/knowledgebase`}>
            <Button variant="outline" className="gap-2">
              <FolderOpen className="w-4 h-4" />
              Add Knowledge
            </Button>
          </Link>
          <Link to={`/app/projects/${projectId}/widget`}>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Configure Widget
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ─── Data Preparation ─────────────────────────────────────────────────────

    const dailyData = fillDailyData(data.conversationsByDay);

    // ─── Build Activity Timeline ────────────────────────────────────────────
    type TimelineItem = {
      id: string;
      type: "booking" | "contact_form";
      title: string;
      subtitle: string;
      timestamp: string;
      status?: string;
    };

    const timelineItems: TimelineItem[] = [];

    for (const b of data.recentBookings) {
      const startDate = new Date(b.startTime);
      timelineItems.push({
        id: b.id,
        type: "booking",
        title: b.visitorName,
        subtitle: `Booking for ${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
        timestamp: b.createdAt,
        status: b.status,
      });
    }

    for (const s of data.recentContactSubmissions) {
      let parsedData: Record<string, string> = {};
      try {
        parsedData = JSON.parse(s.data);
      } catch {
        // ignore
      }
      const firstValue = Object.values(parsedData)[0] ?? "Unknown";
      const fieldCount = Object.keys(parsedData).length;
      timelineItems.push({
        id: s.id,
        type: "contact_form",
        title: parsedData["Name"] ?? parsedData["name"] ?? parsedData["Email"] ?? parsedData["email"] ?? firstValue,
        subtitle: `Contact form with ${fieldCount} field${fieldCount !== 1 ? "s" : ""}`,
        timestamp: s.createdAt,
      });
    }

    timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Hello, {userName.split(" ")[0]}
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            What are you working on?
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Conversations"
          value={data.totalConversations}
          icon={MessageSquare}
        />
        <StatCard
          label="Active Conversations"
          value={data.activeConversations}
          icon={Users}
        />
        <StatCard
          label="Knowledge Resources"
          value={data.totalResources}
          icon={FolderOpen}
        />
        <StatCard
          label="Pending Drafts"
          value={data.pendingCannedDrafts}
          icon={Bot}
        />
      </div>

      {/* Chart + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversations Chart */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-foreground">
              Conversations over time
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  Conversations
                </span>
              </div>
            </div>
          </div>
          {dailyData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dailyData} barSize={32}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={30}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(255,255,255,0.05)",
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Conversations"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
              No conversations this week
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Activity
            </h2>
          </div>
          {timelineItems.length > 0 ? (
            <div className="space-y-1">
              {timelineItems.slice(0, 8).map((item) => (
                <Link
                  key={item.id}
                  to={
                    item.type === "booking"
                      ? `/app/projects/${projectId}/bookings`
                      : `/app/projects/${projectId}/contact-form`
                  }
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors group"
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      item.type === "booking"
                        ? "bg-primary/10"
                        : "bg-orange-500/10",
                    )}
                  >
                    {item.type === "booking" ? (
                      <Calendar className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Mail className="w-3.5 h-3.5 text-orange-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {item.title}
                      </span>
                      {item.status && (
                        <span
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize shrink-0",
                            item.status === "confirmed"
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
                              : "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground truncate">
                      {item.subtitle}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">
                    {formatTimeAgo(item.timestamp)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-sm text-muted-foreground gap-1">
              <Clock className="w-5 h-5 mb-1 text-muted-foreground/50" />
              No bookings or form submissions yet
            </div>
          )}
        </div>
      </div>

      {/* Recent Conversations */}
      <div>
        <div className="bg-card rounded-xl">
          <div className="flex items-center justify-between px-4 sm:px-6 py-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Recent Conversations
              </h2>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                {data.recentConversations.length}
              </span>
            </div>
            <Link
              to={`/app/projects/${projectId}/conversations`}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              See all
            </Link>
          </div>

          {data.recentConversations.length > 0 ? (
            <div className="">
              {/* Table rows */}
              {data.recentConversations.map((convo) => {
                const meta = parseConvoMeta(convo.metadata);
                const displayName = convo.visitorName ?? convo.visitorEmail?.split("@")[0] ?? convo.visitorId.slice(0, 14);
                const location = [meta.city, meta.region].filter(Boolean).join(", ");

                return (
                  <Link
                    key={convo.id}
                    to={`/app/projects/${projectId}/conversations?id=${convo.id}`}
                    className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_100px_100px] items-center px-4 sm:px-6 py-3 hover:bg-accent/50 transition-colors group gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm">
                        {meta.country ? countryToFlag(meta.country) : (
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[13px] font-medium text-foreground truncate block">
                          {displayName}
                        </span>
                        {location && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                            <Globe className="w-3 h-3 shrink-0" />
                            {location}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-full border w-fit capitalize",
                        STATUS_BADGE_STYLES[convo.status] ??
                        "bg-status-closed/10 text-status-closed border-status-closed/25",
                      )}
                    >
                      {STATUS_LABELS[convo.status] ?? convo.status.replace("_", " ")}
                    </span>
                    <span className="hidden sm:block text-[12px] text-muted-foreground text-right">
                      {formatTimeAgo(convo.updatedAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No conversations yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
