import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  FolderOpen,
  Users,
  Bot,
  Plus,
  Clock,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";

interface ConversationsByDay {
  day: string;
  count: number;
}

interface ConversationsByStatus {
  status: string;
  count: number;
}

interface RecentConversation {
  id: string;
  visitorId: string;
  visitorName: string | null;
  status: string;
  updatedAt: string;
}

interface DashboardData {
  totalProjects: number;
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  totalResources: number;
  pendingCannedDrafts: number;
  conversationsByDay: ConversationsByDay[];
  conversationsByStatus: ConversationsByStatus[];
  recentConversations: RecentConversation[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  waiting_agent: "#eab308",
  agent_replied: "#3b82f6",
  closed: "#a1a1aa",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  waiting_agent: "Waiting",
  agent_replied: "Replied",
  closed: "Closed",
};

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold text-card-foreground mt-1">
            {value}
          </p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
    </div>
  );
}

function fillDailyData(data: ConversationsByDay[]): ConversationsByDay[] {
  const filled: ConversationsByDay[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split("T")[0];
    const existing = data.find((item) => item.day === dayStr);
    filled.push({
      day: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      count: existing?.count ?? 0,
    });
  }
  return filled;
}

function Dashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl bg-muted/50 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-64 rounded-2xl bg-muted/50 animate-pulse" />
          <div className="h-64 rounded-2xl bg-muted/50 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data || data.totalProjects === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Welcome to ReplyMaven
          </h1>
          <p className="text-muted-foreground">
            Create your first project to get started
          </p>
        </div>
        <Link to="/app/new-project">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create Project
          </Button>
        </Link>
      </div>
    );
  }

  const dailyData = fillDailyData(data.conversationsByDay);
  const statusData = data.conversationsByStatus.map((item) => ({
    name: STATUS_LABELS[item.status] ?? item.status,
    value: item.count,
    color: STATUS_COLORS[item.status] ?? "#a1a1aa",
  }));

  const statusBadgeColors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    waiting_agent: "bg-yellow-100 text-yellow-700",
    agent_replied: "bg-blue-100 text-blue-700",
    closed: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>

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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversations Over Time */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
          <h2 className="text-sm font-medium text-foreground mb-4">
            Conversations (Last 7 Days)
          </h2>
          {dailyData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Conversations"
                  fill="hsl(var(--primary))"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
              No conversations this week
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
          <h2 className="text-sm font-medium text-foreground mb-4">
            Conversation Status
          </h2>
          {statusData.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={statusData}
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.75rem",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {statusData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {item.name}
                    </span>
                    <span className="text-sm font-medium text-foreground ml-auto">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[160px] text-sm text-muted-foreground">
              No data yet
            </div>
          )}
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="bg-card/50 backdrop-blur-xl rounded-2xl border border-border p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">
          Recent Conversations
        </h2>
        {data.recentConversations.length > 0 ? (
          <div className="space-y-2">
            {data.recentConversations.map((convo) => (
              <div
                key={convo.id}
                className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-muted/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {convo.visitorName ?? convo.visitorId.slice(0, 12)}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {new Date(convo.updatedAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full whitespace-nowrap",
                    statusBadgeColors[convo.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {convo.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No conversations yet
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
