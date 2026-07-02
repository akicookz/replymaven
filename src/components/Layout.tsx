import { useState, useEffect, useCallback } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  FolderOpen,
  Palette,
  LogOut,
  ChevronDown,
  ChevronsUpDown,
  Plus,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Users,
  Building2,
  CreditCard,
  Zap,
  BookOpen,
  Home,
  Inbox,
  Mail,
  Flag,
  Clock,
  CheckCircle2,
} from "lucide-react";
import ProfileSetupDialog from "@/components/ProfileSetupDialog";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import { useTeams } from "@/hooks/use-teams";
import { formatPlanName, getTrialDaysRemaining, usagePercent } from "@/lib/plan";
import { useNeedsYouPing } from "@/lib/use-needs-you-ping";
import { formatTitleWithBadge } from "@/lib/title-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";


interface Project {
  id: string;
  name: string;
  slug: string;
}

interface ProfileSetupState {
  id: string;
  profileSetupCompletedAt: string | null;
  profileSetupDismissedAt: string | null;
}

import { MobileSidebarContext } from "@/lib/mobile-sidebar";
export { useMobileSidebar } from "@/lib/mobile-sidebar";

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: session } = useSession();
  const { data: subData } = useSubscription();
  const { data: teamsData } = useTeams();
  const queryClient = useQueryClient();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [switchingTeam, setSwitchingTeam] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [forceProfileSetup, setForceProfileSetup] = useState(false);

  // Open the profile setup dialog when the URL contains ?setup=profile
  // (e.g. right after a team member accepts an invite).
  useEffect(() => {
    if (searchParams.get("setup") === "profile") {
      setForceProfileSetup(true);
      searchParams.delete("setup");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  const { data: profile } = useQuery<ProfileSetupState>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  // Derive current project strictly from URL param
  const currentProject = params.projectId
    ? projects?.find((p) => p.id === params.projectId)
    : projects?.[0];

  // Redirect to first project if URL projectId is invalid
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (params.projectId && !projects.find((p) => p.id === params.projectId)) {
      navigate(`/app/projects/${projects[0].id}`, { replace: true });
    }
  }, [params.projectId, projects, navigate]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const sidebarCtx = { openSidebar: openMobile };

  const { data: suggestionCountsData } = useQuery<{ total: number }>({
    queryKey: ["knowledge-suggestion-counts", currentProject?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${currentProject!.id}/knowledge-suggestions/counts`,
      );
      if (!res.ok) return { total: 0 };
      return res.json();
    },
    enabled: !!currentProject,
    staleTime: 60_000,
  });

  const { data: inboxCounts } = useQuery<Record<string, number>>({
    queryKey: ["inbox-counts", currentProject?.id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${currentProject!.id}/inbox-counts`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!currentProject,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Needs-review ping surfaces (toast + chime + browser notification) —
  // self-contained; polls Task 14's endpoint independently of inboxCounts.
  useNeedsYouPing(currentProject?.id);

  // Tab-title badge: "(N) …" while conversations wait for review.
  useEffect(() => {
    const { title, base } = formatTitleWithBadge(
      document.title,
      inboxCounts?.["needs-you"] ?? 0,
    );
    document.title = title;
    return () => { document.title = base; };
  }, [inboxCounts]);

  const inboxNav = currentProject ? [
    { label: "Needs You",         filter: "needs-you", icon: Inbox },
    { label: "All Conversations", filter: "all",       icon: Mail },
    { label: "Snoozed",           filter: "snoozed",   icon: Clock },
    { label: "Resolved",          filter: "resolved",  icon: CheckCircle2 },
    { label: "Flagged",           filter: "flagged",   icon: Flag },
  ].map((i) => ({ ...i, href: `/app/projects/${currentProject.id}/conversations?filter=${i.filter}` })) : [];

  const workspaceNav = currentProject ? [
    { label: "Dashboard",     href: `/app/projects/${currentProject.id}`,              icon: LayoutDashboard, exact: true },
    { label: "Knowledgebase", href: `/app/projects/${currentProject.id}/knowledgebase`, icon: FolderOpen, badge: suggestionCountsData?.total ?? 0 },
    { label: "Help Center",   href: `/app/projects/${currentProject.id}/help`,          icon: BookOpen },
  ] : [];

  const widgetNav = currentProject ? [
    { label: "Configuration", href: `/app/projects/${currentProject.id}/configuration`, icon: Palette },
    { label: "Home Screen",   href: `/app/projects/${currentProject.id}/widget/home`,   icon: Home },
    { label: "Quick Actions", href: `/app/projects/${currentProject.id}/quick-actions`,  icon: Zap },
  ] : [];

  function switchProject(project: Project) {
    setSelectorOpen(false);
    if (params.projectId) {
      const newPath = location.pathname.replace(
        `/projects/${params.projectId}`,
        `/projects/${project.id}`,
      );
      navigate(newPath);
    } else {
      navigate(`/app/projects/${project.id}`);
    }
  }

  const teams = teamsData?.teams ?? [];
  const activeTeam = teams.find((t) => t.isActive);

  async function switchTeam(teamId: string) {
    setTeamOpen(false);
    if (switchingTeam || teamId === teamsData?.activeTeamId) return;
    setSwitchingTeam(true);
    try {
      const res = await fetch("/api/teams/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) throw new Error("Failed to switch team");
      // Projects, conversations, settings, billing, and team all change with the
      // active team — drop the whole cache and land on the new team's dashboard.
      queryClient.clear();
      navigate("/app");
    } catch {
      // Leave the user where they are on failure.
    } finally {
      setSwitchingTeam(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  function isActive(item: { label: string; href: string; exact?: boolean }) {
    return item.label === "Dashboard" || item.exact
      ? location.pathname === item.href
      : location.pathname.startsWith(item.href);
  }

  type NavItem = {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    exact?: boolean;
    filter?: string;
    count?: number;
  };

  function SectionHeader({ label }: { label: string }) {
    if (collapsed) return null;
    return (
      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold text-ink-7 uppercase tracking-wider">
        {label}
      </p>
    );
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = item.filter != null
      ? location.pathname.includes("/conversations") && searchParams.get("filter") === item.filter
      : isActive(item);

    return (
      <Link
        to={item.href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
          active
            ? "bg-glass-raised text-ink-1"
            : "text-ink-4 hover:bg-glass-button hover:text-ink-1",
        )}
      >
        <item.icon
          className={cn(
            "w-[18px] h-[18px] shrink-0",
            active ? "text-[--brand]" : "text-ink-5",
          )}
        />
        {!collapsed && item.label}
        {!collapsed && item.filter != null && (
          <span
            className={cn(
              "ml-auto text-[11px] font-medium tabular-nums",
              active ? "text-[--brand]" : "text-ink-7",
            )}
          >
            {item.count ?? 0}
          </span>
        )}
        {!collapsed && item.badge != null && item.badge > 0 ? (
          <span className="ml-auto inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
            {item.badge}
          </span>
        ) : null}
      </Link>
    );
  }

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const showProfileSetup =
    forceProfileSetup ||
    (!!profile &&
      !profile.profileSetupCompletedAt &&
      !profile.profileSetupDismissedAt);

  function handleProfileSetupChange(open: boolean) {
    if (!open) {
      setForceProfileSetup(false);
    }
  }

  return (
    <div className="flex h-screen">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col glass-sidebar border-r border-hairline transition-all duration-200",
          // Desktop: static sidebar
          "hidden md:flex",
          collapsed ? "md:w-[68px]" : "md:w-[248px]",
          // Mobile: slide-out overlay
          mobileOpen
            ? "fixed inset-y-0 left-0 z-50 flex w-[248px]"
            : "fixed inset-y-0 left-0 z-50 -translate-x-full md:translate-x-0 md:relative",
        )}
      >
        {/* Brand wordmark + sidebar toggle. When collapsed the wordmark hides and
            the toggle becomes the top-left icon (the only way to re-expand), kept
            aligned with the nav icons below it. */}
        <div
          className={cn(
            "flex items-center h-12",
            collapsed ? "justify-center px-0" : "justify-between px-4",
          )}
        >
          {!collapsed && (
            <Link to="/app" className="text-[14px] font-semibold text-ink-1">
              ReplyMaven
            </Link>
          )}
          {/* Mobile close button — same icon as the desktop collapse toggle */}
          <button
            onClick={closeMobile}
            className="p-1 rounded-md hover:bg-glass-button text-ink-5 transition-colors md:hidden"
            aria-label="Close menu"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          {/* Desktop collapse / expand toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "hidden md:flex items-center justify-center rounded-md hover:bg-glass-button text-ink-5 transition-colors",
              collapsed ? "w-9 h-9" : "p-1",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Team Switcher (only when the user belongs to more than one team) */}
        {teams.length > 1 && !collapsed && (
          <div className="px-3 pb-2">
            <Popover open={teamOpen} onOpenChange={setTeamOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={switchingTeam}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-glass-button transition-colors disabled:opacity-60"
                >
                  <Building2 className="w-4 h-4 shrink-0 text-ink-5" />
                  <span className="truncate font-medium flex-1 text-left text-ink-2 text-[13px]">
                    {activeTeam?.name ?? "Select team"}
                  </span>
                  <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 text-ink-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-1">
                <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Teams
                </p>
                <div className="space-y-0.5">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => switchTeam(team.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                        team.isActive
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="flex-1 truncate">
                        {team.name}
                        {team.own && (
                          <span className="text-muted-foreground"> (you)</span>
                        )}
                      </span>
                      <span className="text-[11px] capitalize text-muted-foreground shrink-0">
                        {team.role}
                      </span>
                      {team.isActive && (
                        <Check className="w-4 h-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Project Selector */}
        {currentProject && projects && !collapsed && (
          <div className="px-3 pb-3">
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-glass-button text-sm hover:bg-glass-raised transition-colors">
                  <span className="truncate font-medium flex-1 text-left text-ink-2 text-[13px]">
                    {currentProject.name}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 text-ink-5 transition-transform",
                      selectorOpen && "rotate-180",
                    )}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1">
                <div className="space-y-0.5">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => switchProject(project)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                        project.id === currentProject.id
                          ? "bg-accent text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.id === currentProject.id && (
                        <Check className="w-4 h-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="h-px bg-muted my-1" />
                <Link
                  to="/app/new-project"
                  onClick={() => setSelectorOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New Project
                </Link>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3">
          {/* Inbox */}
          {inboxNav.length > 0 && (
            <div>
              <SectionHeader label="Inbox" />
              <div className="space-y-0.5">
                {inboxNav.map((item) => (
                  <NavLink
                    key={item.href}
                    item={{ ...item, count: inboxCounts?.[item.filter] ?? 0 }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Workspace */}
          {workspaceNav.length > 0 && (
            <div>
              <SectionHeader label="Workspace" />
              <div className="space-y-0.5">
                {workspaceNav.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Widget */}
          {widgetNav.length > 0 && (
            <div>
              <SectionHeader label="Widget" />
              <div className="space-y-0.5">
                {widgetNav.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
            </div>
          )}

          {!currentProject && (
            <Link
              to="/app/onboarding"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-ink-4 hover:bg-glass-button hover:text-ink-1"
            >
              <Plus className="w-[18px] h-[18px]" />
              {!collapsed && "Create Project"}
            </Link>
          )}
        </nav>

        {/* Plan Status */}
        {subData?.subscription && !collapsed && (
          <div className="px-3 pb-1">
            <Link
              to="/app/account"
              className="block px-3 py-2 rounded-lg bg-glass-button hover:bg-glass-raised transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-ink-7 uppercase tracking-wider">
                  {formatPlanName(subData.subscription.plan)}
                </span>
                {subData.subscription.status === "trialing" && (
                  <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                    {getTrialDaysRemaining(subData.subscription.trialEndsAt)}d trial
                  </span>
                )}
                {subData.subscription.status === "past_due" && (
                  <span className="text-[10px] font-medium text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded-full">
                    Past due
                  </span>
                )}
              </div>
              {subData.limits && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      usagePercent(subData.usage.messagesUsed, subData.limits.maxMessagesPerMonth) >= 90
                        ? "bg-destructive"
                        : usagePercent(subData.usage.messagesUsed, subData.limits.maxMessagesPerMonth) >= 70
                          ? "bg-yellow-500"
                          : "bg-primary",
                    )}
                    style={{
                      width: `${usagePercent(subData.usage.messagesUsed, subData.limits.maxMessagesPerMonth)}%`,
                    }}
                  />
                </div>
              )}
              {subData.limits && (
                <p className="text-[10px] text-ink-7 mt-1">
                  {subData.usage.messagesUsed}/{subData.limits.maxMessagesPerMonth} messages
                </p>
              )}
            </Link>
          </div>
        )}

        {/* User */}
        <div className="px-3 pb-3 pt-2">
          <Popover>
            <PopoverTrigger asChild>
              <button className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-glass-button transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                  {userName.charAt(0).toUpperCase()}
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[13px] font-medium text-ink-2 truncate">
                      {userName}
                    </p>
                    <p className="text-[11px] text-ink-6 truncate">
                      {userEmail}
                    </p>
                  </div>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-52 p-1">
              <Link
                to="/app/account"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <User className="w-4 h-4 shrink-0" />
                My Profile
              </Link>
              <Link
                to="/app/account/team"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Users className="w-4 h-4 shrink-0" />
                Team
              </Link>
              <Link
                to="/app/account/billing"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                Billing
              </Link>
              <div className="h-px bg-muted my-1" />
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Sign Out
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      {/* Main Content */}
      <MobileSidebarContext.Provider value={sidebarCtx}>
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </MobileSidebarContext.Provider>

      {/* Profile setup prompt (shows once after onboarding) */}
      <ProfileSetupDialog
        open={showProfileSetup}
        onOpenChange={handleProfileSetupChange}
      />
    </div>
  );
}

export default Layout;
