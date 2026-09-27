import { useState, useEffect, useCallback, useRef } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import ProfileSetupDialog from "@/components/ProfileSetupDialog";
import { Favicon } from "@/components/ui/favicon";
import { CommandKeycap } from "@/components/commands/CommandKeycap";
import {
  DashboardCommandProvider,
  useOpenCommandMenu,
} from "@/components/commands/DashboardCommandProvider";
import { NAV_ICONS } from "@/components/icons/nav-icon-map";
import {
  MoreIcon,
  SearchIcon,
  SettingsIcon,
  TeamIcon,
} from "@/components/icons/nav-icons";
import { signOut, useSession } from "@/lib/auth-client";
import { resetFirstPartyPostHog } from "@/lib/posthog";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobileViewport } from "@/hooks/use-media-query";
import { useSubscription } from "@/hooks/use-subscription";
import { getTrialDaysRemaining, usagePercent } from "@/lib/plan";
import { canCreateProjects } from "@/lib/team-permissions";
import { useNeedsYouPing } from "@/lib/use-needs-you-ping";
import { formatTitleWithBadge } from "@/lib/title-badge";
import { projectRoute, settingsRoute } from "@/lib/dashboard-routes";
import {
  dashboardNav,
  isSettingsPath,
  NAV_GROUP_LABELS,
  projectSwitchHref,
  SETTINGS_GROUPS,
  type DashboardNavGroup,
  type DashboardNavItem,
} from "@/lib/dashboard/nav";
import { MobileSidebarContext } from "@/lib/mobile-sidebar";

export { useMobileSidebar } from "@/lib/mobile-sidebar";

interface Project {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
}

interface ProfileSetupState {
  id: string;
  profileSetupCompletedAt: string | null;
  profileSetupDismissedAt: string | null;
}

// Counts only earn space on views that ask for action.
const COUNTED_VIEWS = new Set<DashboardNavItem["id"]>(["needs-you", "inbox", "snoozed", "flagged"]);

// ─── Rows ─────────────────────────────────────────────────────────────────────

function RowCount({ item }: { item: DashboardNavItem }) {
  const count = item.count ?? 0;
  if (!COUNTED_VIEWS.has(item.id) || count <= 0) return null;
  if (item.id === "needs-you") {
    return (
      <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-[11px] font-medium leading-[18px] tabular-nums text-brand">
        {count}
      </span>
    );
  }
  return (
    <span className="ml-auto text-[11px] font-medium tabular-nums text-ink-7">
      {count}
    </span>
  );
}

function rowClass(active: boolean, collapsed: boolean): string {
  return cn(
    "flex h-7 w-full items-center gap-2 rounded-md text-[13px] font-medium transition-colors",
    collapsed ? "justify-center px-0" : "px-2",
    active
      ? "bg-glass-raised text-ink-1"
      : "text-ink-4 hover:bg-glass-button hover:text-ink-1",
  );
}

function NavRow({ item, collapsed }: { item: DashboardNavItem; collapsed: boolean }) {
  const Icon = NAV_ICONS[item.id];
  return (
    <Link
      to={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={item.active ? "page" : undefined}
      className={rowClass(item.active, collapsed)}
    >
      <Icon
        active={item.active}
        className={item.active ? "text-ink-2" : "text-ink-6"}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && <RowCount item={item} />}
    </Link>
  );
}

function MoreRow({ items, collapsed }: { items: DashboardNavItem[]; collapsed: boolean }) {
  const active = items.some((item) => item.active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? "More" : undefined}
          className={rowClass(active, collapsed)}
        >
          <MoreIcon className={active ? "text-ink-2" : "text-ink-6"} />
          {!collapsed && <span>More</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-48">
        {items.map((item) => {
          const Icon = NAV_ICONS[item.id];
          return (
            <DropdownMenuItem key={item.id} asChild>
              <Link to={item.href} className={cn(item.active && "bg-accent")}>
                <Icon active={item.active} className="text-ink-5" />
                {item.label}
                <RowCount item={item} />
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle?: () => void;
}) {
  if (!onToggle) {
    return (
      <p className="flex h-6 items-center px-2 text-[12px] font-medium text-ink-7">
        {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex h-6 w-full items-center gap-1 px-2 text-[12px] font-medium text-ink-7 transition-colors hover:text-ink-4"
    >
      {label}
      <svg
        viewBox="0 0 8 8"
        aria-hidden="true"
        className={cn(
          "size-2 fill-current opacity-0 transition-[opacity,rotate] group-hover:opacity-100 group-focus-visible:opacity-100",
          !open && "-rotate-90 opacity-100",
        )}
      >
        <path d="M1 2.5h6L4 6Z" />
      </svg>
    </button>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

// Widget logo when one is configured, else the site's favicon, else the first letter.
function ProjectTile({ project, logoUrl }: { project: Project; logoUrl?: string | null }) {
  return (
    <Favicon
      name={project.name}
      src={logoUrl}
      domain={project.domain}
      className="size-5 shrink-0 rounded-[5px] bg-glass-button"
      letterClassName="text-[11px] text-ink-2"
    />
  );
}

function SearchButton() {
  const openMenu = useOpenCommandMenu();
  return (
    <button
      type="button"
      onClick={openMenu}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-5 transition-colors hover:bg-glass-button hover:text-ink-1"
      aria-label="Search"
      title="Search (⌘K)"
    >
      <SearchIcon />
    </button>
  );
}

interface ProjectMenuProps {
  projects: Project[];
  currentProject: Project;
  currentLogoUrl: string | null;
  userEmail: string;
  canCreate: boolean;
  onSwitch: (project: Project) => void;
  onSignOut: () => void;
}

function ProjectMenu({
  projects,
  currentProject,
  currentLogoUrl,
  userEmail,
  canCreate,
  onSwitch,
  onSignOut,
}: ProjectMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-[13px] transition-colors hover:bg-glass-button"
        >
          <ProjectTile project={currentProject} logoUrl={currentLogoUrl} />
          <span className="truncate font-semibold text-ink-1">
            {currentProject.name}
          </span>
          <ChevronDown className="size-3 shrink-0 text-ink-6" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {userEmail && (
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {userEmail}
          </DropdownMenuLabel>
        )}
        <DropdownMenuItem asChild>
          <Link to={projectRoute(currentProject.id, "settings")}>
            <SettingsIcon />
            Settings
            <CommandKeycap keycap={{ keys: ["G", "S"] }} className="ml-auto" />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={settingsRoute(currentProject.id, "team")}>
            <TeamIcon />
            Invite and manage members
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <ProjectTile project={currentProject} logoUrl={currentLogoUrl} />
            Switch project
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => onSwitch(project)}>
                <ProjectTile
                  project={project}
                  logoUrl={project.id === currentProject.id ? currentLogoUrl : null}
                />
                <span className="flex-1 truncate">{project.name}</span>
                {project.id === currentProject.id && (
                  <Check className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            {canCreate && (
              <DropdownMenuItem asChild>
                <Link to="/app/onboarding?new=1">
                  <Plus />
                  New project
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={onSignOut} className="mt-1">
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: session } = useSession();
  const { data: subData } = useSubscription();
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Partial<Record<DashboardNavGroup, boolean>>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobileViewport = useIsMobileViewport();
  const [forceProfileSetup, setForceProfileSetup] = useState(false);
  const inSettings = isSettingsPath(location.pathname);
  const lastAppPathRef = useRef<string | null>(null);

  // Open the profile setup dialog when the URL contains ?setup=profile
  // (e.g. right after a team member accepts an invite).
  useEffect(() => {
    if (searchParams.get("setup") === "profile") {
      setForceProfileSetup(true);
      searchParams.delete("setup");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // "Back to app" returns to the last page outside Settings.
  useEffect(() => {
    if (!inSettings) lastAppPathRef.current = location.pathname + location.search;
  }, [inSettings, location.pathname, location.search]);

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

  // Same key and endpoint as useWidgetSettings, so the widget pages share this cache.
  const { data: widgetLogo } = useQuery<{ avatarUrl: string | null }>({
    queryKey: ["widget-config", currentProject?.id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${currentProject!.id}/widget-config`);
      if (!res.ok) throw new Error("Failed to fetch widget config");
      return res.json();
    },
    enabled: !!currentProject,
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

  // Needs-review ping surfaces (toast + chime + browser notification).
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

  const navItems = currentProject
    ? dashboardNav({
        projectId: currentProject.id,
        pathname: location.pathname,
        search: location.search,
        counts: inboxCounts,
      })
    : [];

  function itemsIn(group: DashboardNavGroup): DashboardNavItem[] {
    return navItems.filter((item) => item.group === group);
  }

  function switchProject(project: Project) {
    if (params.projectId) {
      navigate(
        projectSwitchHref(
          location.pathname,
          location.search,
          params.projectId,
          project.id,
        ),
      );
    } else {
      navigate(`/app/projects/${project.id}`);
    }
  }

  async function handleSignOut() {
    resetFirstPartyPostHog();
    await signOut();
    navigate("/");
  }

  function isSectionOpen(group: DashboardNavGroup) {
    return collapsed || !collapsedSections[group];
  }

  function toggleSection(group: DashboardNavGroup) {
    setCollapsedSections((prev) => ({ ...prev, [group]: !prev[group] }));
  }

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

  const usage = subData?.subscription && subData.messageAllowance !== null
    ? usagePercent(subData.usage.messagesUsed, subData.messageAllowance)
    : null;
  const showUsage =
    usage !== null &&
    !collapsed &&
    !inSettings &&
    (usage >= 70 ||
      subData?.subscription?.status === "trialing" ||
      subData?.subscription?.status === "past_due");

  function usageBarClass(percent: number): string {
    if (percent >= 90) return "bg-destructive";
    if (percent >= 70) return "bg-yellow-500";
    return "bg-primary";
  }

  function renderSection(group: DashboardNavGroup, collapsible: boolean) {
    const items = itemsIn(group);
    if (items.length === 0) return null;
    const label = NAV_GROUP_LABELS[group];
    const open = isSectionOpen(group);
    return (
      <div key={group} className="pt-2 first:pt-0">
        {label && !collapsed && (
          <SectionHeader
            label={label}
            open={open}
            onToggle={collapsible ? () => toggleSection(group) : undefined}
          />
        )}
        {open && (
          <div className="space-y-px">
            {items.map((item) => (
              <NavRow key={item.id} item={item} collapsed={collapsed} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const collapseToggle = (
    <>
      <button
        onClick={closeMobile}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-5 transition-colors hover:bg-glass-button md:hidden"
        aria-label="Close menu"
      >
        <PanelLeftClose className="size-4" strokeWidth={1.5} />
      </button>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="hidden size-7 shrink-0 items-center justify-center rounded-md text-ink-5 transition-colors hover:bg-glass-button md:flex"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" strokeWidth={1.5} />
        ) : (
          <PanelLeftClose className="size-4" strokeWidth={1.5} />
        )}
      </button>
    </>
  );

  const appNav = (
    <>
      <div
        className={cn(
          "flex h-14 items-center gap-0.5 pt-2",
          collapsed ? "justify-center px-0" : "px-2",
        )}
      >
        {currentProject && projects && !collapsed && (
          <ProjectMenu
            projects={projects}
            currentProject={currentProject}
            currentLogoUrl={widgetLogo?.avatarUrl ?? null}
            userEmail={userEmail}
            canCreate={canCreateProjects(subData?.role)}
            onSwitch={switchProject}
            onSignOut={() => void handleSignOut()}
          />
        )}
        {currentProject && !collapsed && <SearchButton />}
        {collapseToggle}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {currentProject && (
          <div className="space-y-px">
            {itemsIn("main").map((item) => (
              <NavRow key={item.id} item={item} collapsed={collapsed} />
            ))}
            <MoreRow items={itemsIn("more")} collapsed={collapsed} />
          </div>
        )}
        {renderSection("maven", true)}
        {renderSection("help-center", true)}

        {!currentProject && canCreateProjects(subData?.role) && (
          <Link
            to="/app/onboarding?new=1"
            className={rowClass(false, collapsed)}
          >
            <Plus className="size-4" strokeWidth={1.5} />
            {!collapsed && "Create Project"}
          </Link>
        )}
      </nav>

      {showUsage && currentProject && subData?.subscription && (
        <div className="px-2 pb-3">
          <Link
            to={settingsRoute(currentProject.id, "billing")}
            className="group block rounded-md px-2 py-1"
          >
            <div className="h-1 overflow-hidden rounded-full bg-glass-button">
              <div
                className={cn("h-full rounded-full transition-all", usageBarClass(usage))}
                style={{ width: `${usage}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-7 transition-colors group-hover:text-ink-4">
              {subData.usage.messagesUsed}/{subData.messageAllowance} messages
              {subData.subscription.status === "trialing" &&
                ` · ${getTrialDaysRemaining(subData.subscription.trialEndsAt)}d trial`}
              {subData.subscription.status === "past_due" && " · past due"}
            </p>
          </Link>
        </div>
      )}
    </>
  );

  const backHref =
    lastAppPathRef.current ??
    (currentProject ? `/app/projects/${currentProject.id}/conversations` : "/app");

  const settingsNav = (
    <>
      <div
        className={cn(
          "flex h-14 items-center gap-0.5 pt-2",
          collapsed ? "justify-center px-0" : "px-2",
        )}
      >
        {!collapsed && (
          <Link
            to={backHref}
            className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:bg-glass-button hover:text-ink-1"
          >
            <ChevronLeft className="size-4 shrink-0 text-ink-6" strokeWidth={1.75} />
            Back to app
          </Link>
        )}
        {collapseToggle}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {SETTINGS_GROUPS.map((group) => renderSection(group, false))}
      </nav>
    </>
  );

  const sidebarContent = inSettings ? settingsNav : appNav;

  return (
    <DashboardCommandProvider projectId={currentProject?.id ?? null}>
    <div className="flex h-screen">
      {isMobileViewport ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="glass-sidebar w-[244px] gap-0 sm:max-w-[244px]"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Workspace projects and settings</SheetDescription>
            </SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          className={cn(
            "hidden md:flex flex-col glass-sidebar border-r border-hairline transition-all duration-200",
            collapsed ? "md:w-[56px]" : "md:w-[244px]",
          )}
        >
          {sidebarContent}
        </aside>
      )}

      {/* Main Content */}
      <MobileSidebarContext.Provider value={sidebarCtx}>
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
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
    </DashboardCommandProvider>
  );
}

export default Layout;
