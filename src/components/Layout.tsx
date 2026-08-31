import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Database,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MessagesSquare,
  Plug,
  Wrench,
  LogOut,
  ChevronDown,
  Plus,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Users,
  CreditCard,
  BookOpen,
  Inbox,
  Hand,
  Archive,
  Flag,
  Clock,
  CheckCircle2,
} from "lucide-react";
import ProfileSetupDialog from "@/components/ProfileSetupDialog";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/use-subscription";
import { getTrialDaysRemaining, usagePercent } from "@/lib/plan";
import { canCreateProjects } from "@/lib/team-permissions";
import { useNeedsYouPing } from "@/lib/use-needs-you-ping";
import { formatTitleWithBadge } from "@/lib/title-badge";
import { projectRoute } from "@/lib/dashboard-routes";
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
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
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
    { label: "Needs You", filter: "needs-you", icon: Hand },
    { label: "Inbox",     filter: "inbox",     icon: Inbox },
    { label: "Snoozed",           filter: "snoozed",   icon: Clock },
    { label: "Resolved",          filter: "resolved",  icon: CheckCircle2 },
    { label: "Archived",          filter: "archived",  icon: Archive },
    { label: "Flagged",           filter: "flagged",   icon: Flag },
  ].map((i) => ({ ...i, href: `/app/projects/${currentProject.id}/conversations?filter=${i.filter}` })) : [];

  const knowledgebaseNav = currentProject ? [
    { label: "Sources", href: projectRoute(currentProject.id, "sources"), icon: Database },
    { label: "Help Center", href: projectRoute(currentProject.id, "help-center"), icon: BookOpen },
    { label: "SOPs", href: projectRoute(currentProject.id, "sops"), icon: ListChecks },
    { label: "Company info", href: projectRoute(currentProject.id, "company-info"), icon: Building2 },
  ] : [];

  const supportChatNav = currentProject ? [
    { label: "Chat Widget", href: projectRoute(currentProject.id, "chat-widget"), icon: MessageSquare },
    { label: "Greetings", href: projectRoute(currentProject.id, "greetings"), icon: MessagesSquare },
    { label: "Tools", href: projectRoute(currentProject.id, "tools"), icon: Wrench },
  ] : [];

  const workspaceNav = currentProject ? [
    { label: "Dashboard", href: projectRoute(currentProject.id, "dashboard"), icon: LayoutDashboard, exact: true },
    { label: "Customers", href: projectRoute(currentProject.id, "customers"), icon: Users },
    { label: "MCP Connections", href: projectRoute(currentProject.id, "mcp-connections"), icon: Plug },
  ] : [];

  function switchProject(project: Project) {
    setSelectorOpen(false);
    if (params.projectId) {
      const newPath = location.pathname.replace(
        `/projects/${params.projectId}`,
        `/projects/${project.id}`,
      );
      navigate({ pathname: newPath, search: location.search });
    } else {
      navigate(`/app/projects/${project.id}`);
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
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    badge?: number;
    exact?: boolean;
    filter?: string;
    count?: number;
  };

  function isSectionOpen(id: string) {
    return collapsed || !collapsedSections[id];
  }

  function toggleSection(id: string) {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function SectionHeader({ id, label }: { id: string; label: string }) {
    if (collapsed) return null;
    const open = isSectionOpen(id);
    return (
      <button
        type="button"
        onClick={() => toggleSection(id)}
        aria-expanded={open}
        aria-controls={`nav-section-${id}`}
        className="flex w-full items-center gap-0.5 px-2 pt-3.5 pb-1 text-[11px] font-medium text-ink-6 hover:text-ink-4"
      >
        {label}
        <ChevronDown
          className={cn(
            "size-3 shrink-0 transition-transform",
            !open && "-rotate-90",
          )}
          strokeWidth={1.5}
        />
      </button>
    );
  }

  function NavSection({
    id,
    label,
    children,
  }: {
    id: string;
    label: string;
    children: ReactNode;
  }) {
    return (
      <div>
        <SectionHeader id={id} label={label} />
        {isSectionOpen(id) && (
          <div id={`nav-section-${id}`} className="space-y-1">
            {children}
          </div>
        )}
      </div>
    );
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = item.filter != null
      ? location.pathname.includes("/conversations") && searchParams.get("filter") === item.filter
      : isActive(item);

    return (
      <Link
        to={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md text-[13px] font-medium transition-colors",
          collapsed ? "justify-center px-0" : "px-2",
          active
            ? "bg-glass-raised text-ink-1"
            : "text-ink-4 hover:bg-glass-button hover:text-ink-1",
        )}
      >
        <item.icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-ink-2" : "text-ink-5",
          )}
          strokeWidth={1.5}
        />
        {!collapsed && item.label}
        {!collapsed && item.filter != null && (
          <span
            className={cn(
              "ml-auto text-[11px] font-medium tabular-nums",
              active ? "text-ink-5" : "text-ink-7",
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
        {/* Workspace name + sidebar toggle. When the rail is collapsed the
            name hides and the toggle is the only way to re-expand. */}
        <div
          className={cn(
            "flex items-center gap-1",
            collapsed ? "h-10 justify-center px-0" : "h-10 px-2",
          )}
        >
          {currentProject && projects && !collapsed && (
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <button className="min-w-0 flex-1 flex h-8 items-center gap-1 rounded-md px-2 text-[13px] hover:bg-glass-button transition-colors">
                  <span className="truncate font-semibold flex-1 text-left text-ink-1">
                    {currentProject.name}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3 shrink-0 text-ink-5 transition-transform",
                      selectorOpen && "rotate-180",
                    )}
                    strokeWidth={1.5}
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
                {canCreateProjects(subData?.role) && (
                  <Link
                    to="/app/new-project"
                    onClick={() => setSelectorOpen(false)}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </Link>
                )}
              </PopoverContent>
            </Popover>
          )}
          {/* Mobile close button — same icon as the desktop collapse toggle */}
          <button
            onClick={closeMobile}
            className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-glass-button text-ink-5 transition-colors md:hidden"
            aria-label="Close menu"
          >
            <PanelLeftClose className="size-4" strokeWidth={1.5} />
          </button>
          {/* Desktop collapse / expand toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden md:flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-glass-button text-ink-5 transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.5} />
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2">
          {inboxNav.length > 0 && (
            <NavSection id="inbox" label="Inbox">
              {inboxNav.map((item) => (
                <NavLink
                  key={item.href}
                  item={{ ...item, count: inboxCounts?.[item.filter] ?? 0 }}
                />
              ))}
            </NavSection>
          )}

          {knowledgebaseNav.length > 0 && (
            <NavSection id="knowledgebase" label="Knowledgebase">
              {knowledgebaseNav.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </NavSection>
          )}

          {supportChatNav.length > 0 && (
            <NavSection id="support-chat" label="Support Chat">
              {supportChatNav.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </NavSection>
          )}

          {workspaceNav.length > 0 && (
            <NavSection id="workspace" label="Workspace">
              {workspaceNav.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </NavSection>
          )}

          {!currentProject && canCreateProjects(subData?.role) && (
            <Link
              to="/app/onboarding"
              className={cn(
                "flex h-8 items-center gap-2 rounded-md text-[13px] font-medium text-ink-4 hover:bg-glass-button hover:text-ink-1",
                collapsed ? "justify-center px-0" : "px-2",
              )}
            >
              <Plus className="size-4" strokeWidth={1.5} />
              {!collapsed && "Create Project"}
            </Link>
          )}
        </nav>

        {/* Usage — bare bar + count above the user button; links to billing.
            Trial and past-due states surface as a quiet suffix on the count. */}
        {subData?.subscription && subData.limits && !collapsed && (
          <div className="px-2">
            <Link
              to={currentProject ? `/app/projects/${currentProject.id}/settings?tab=billing` : "/app/account/billing"}
              className="group block rounded-md px-2 py-1"
            >
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
              <p className="mt-1.5 text-[10px] text-ink-7 transition-colors group-hover:text-ink-4">
                {subData.usage.messagesUsed}/{subData.limits.maxMessagesPerMonth} messages
                {subData.subscription.status === "trialing" &&
                  ` · ${getTrialDaysRemaining(subData.subscription.trialEndsAt)}d trial`}
                {subData.subscription.status === "past_due" && " · past due"}
              </p>
            </Link>
          </div>
        )}

        {/* User */}
        <div className="px-2 pb-2 pt-1">
          <Popover>
            <PopoverTrigger asChild>
              <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-glass-button transition-colors">
                <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
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
                to={currentProject ? `/app/projects/${currentProject.id}/settings?tab=profile` : "/app/account"}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <User className="w-4 h-4 shrink-0" />
                My Profile
              </Link>
              <Link
                to={currentProject ? `/app/projects/${currentProject.id}/settings?tab=team` : "/app/account/team"}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Users className="w-4 h-4 shrink-0" />
                Team
              </Link>
              <Link
                to={currentProject ? `/app/projects/${currentProject.id}/settings?tab=billing` : "/app/account/billing"}
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
