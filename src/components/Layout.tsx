import { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  Palette,
  Bot,
  Send,
  Wrench,
  Zap,
  LogOut,
  ChevronDown,
  Plus,
  Check,
  PanelLeftClose,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

interface Project {
  id: string;
  name: string;
  slug: string;
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const { data: session } = useSession();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
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

  const mainNav = currentProject
    ? [
        {
          label: "Dashboard",
          href: `/app/projects/${currentProject.id}`,
          icon: LayoutDashboard,
        },
        {
          label: "Conversations",
          href: `/app/projects/${currentProject.id}/conversations`,
          icon: MessageSquare,
        },
        {
          label: "Knowledgebase",
          href: `/app/projects/${currentProject.id}/knowledgebase`,
          icon: FolderOpen,
        },
      ]
    : [];

  const toolsNav = currentProject
    ? [
        {
          label: "Widget",
          href: `/app/projects/${currentProject.id}/widget`,
          icon: Palette,
        },
        {
          label: "Quick Actions",
          href: `/app/projects/${currentProject.id}/quick-actions`,
          icon: Zap,
        },
        {
          label: "Canned Responses",
          href: `/app/projects/${currentProject.id}/canned-responses`,
          icon: Bot,
        },
        {
          label: "Telegram",
          href: `/app/projects/${currentProject.id}/telegram`,
          icon: Send,
        },
        {
          label: "Tools",
          href: `/app/projects/${currentProject.id}/tools`,
          icon: Wrench,
        },
      ]
    : [];

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

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  function isActive(item: { label: string; href: string }) {
    return item.label === "Dashboard"
      ? location.pathname === item.href
      : location.pathname.startsWith(item.href);
  }

  function NavLink({ item }: { item: { label: string; href: string; icon: React.ComponentType<{ className?: string }> } }) {
    const active = isActive(item);
    return (
      <Link
        to={item.href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
          active
            ? "glow-surface-subtle text-card-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <item.icon className={cn("w-[18px] h-[18px] shrink-0", active && "text-card-foreground")} />
        {!collapsed && item.label}
      </Link>
    );
  }

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        {/* Logo + Collapse */}
        <div className="flex items-center justify-between px-4 h-14">
          <Link to="/app" className="min-w-0">
            <Logo size="sm" iconOnly={collapsed} />
          </Link>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="sr-only"
            >
              Expand
            </button>
          )}
        </div>

        {/* Project Selector */}
        {currentProject && projects && !collapsed && (
          <div className="px-3 pb-3">
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm hover:bg-accent transition-colors">
                  <span className="truncate font-medium flex-1 text-left text-foreground text-[13px]">
                    {currentProject.name}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform",
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
                <Separator className="my-1" />
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
        <nav className="flex-1 overflow-y-auto px-3 space-y-5">
          {/* Main */}
          <div className="space-y-0.5">
            {mainNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>

          {/* Tools */}
          {toolsNav.length > 0 && (
            <div className="space-y-1">
              {!collapsed && (
                <p className="px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Tools
                </p>
              )}
              <div className="space-y-0.5">
                {toolsNav.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </div>
            </div>
          )}

          {!currentProject && (
            <Link
              to="/app/onboarding"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="w-[18px] h-[18px]" />
              {!collapsed && "Create Project"}
            </Link>
          )}
        </nav>

        {/* User */}
        <div className="px-3 pb-3 pt-2 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">
                  {userName}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {userEmail}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleSignOut}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default Layout;
