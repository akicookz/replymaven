import { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  Palette,
  Settings,
  Bot,
  Send,
  Zap,
  LogOut,
  ChevronDown,
  Plus,
  Check,
} from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
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

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string }>();
  const { data: session } = useSession();
  const [selectorOpen, setSelectorOpen] = useState(false);

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

  // Redirect to first project if URL projectId is invalid (stale bookmark, deleted project)
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (params.projectId && !projects.find((p) => p.id === params.projectId)) {
      navigate(`/app/projects/${projects[0].id}`, { replace: true });
    }
  }, [params.projectId, projects, navigate]);

  const navItems = currentProject
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
          label: "Resources",
          href: `/app/projects/${currentProject.id}/resources`,
          icon: FolderOpen,
        },
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
          label: "Settings",
          href: `/app/projects/${currentProject.id}/settings`,
          icon: Settings,
        },
      ]
    : [];

  function switchProject(project: Project) {
    setSelectorOpen(false);

    // Navigate to the same sub-page for the new project
    // e.g. /app/projects/OLD_ID/conversations -> /app/projects/NEW_ID/conversations
    if (params.projectId) {
      const newPath = location.pathname.replace(
        `/projects/${params.projectId}`,
        `/projects/${project.id}`,
      );
      navigate(newPath);
    } else {
      // On non-project page, go to dashboard for the selected project
      navigate(`/app/projects/${project.id}`);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-sidebar-border">
          <Link to="/app" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-sidebar-primary flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <span className="font-semibold text-sidebar-foreground">
              ReplyMaven
            </span>
          </Link>
        </div>

        {/* Project Selector */}
        {currentProject && projects && (
          <div className="p-3 border-b border-sidebar-border">
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-sm hover:bg-sidebar-accent/80 transition-colors">
                  <span className="truncate font-medium flex-1 text-left">
                    {currentProject.name}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 shrink-0 opacity-50 transition-transform",
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
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground hover:bg-accent/50",
                      )}
                    >
                      <span className="flex-1 truncate">{project.name}</span>
                      {project.id === currentProject.id && (
                        <Check className="w-4 h-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border mt-1 pt-1">
                  <Link
                    to="/app/new-project"
                    onClick={() => setSelectorOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </Link>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              item.label === "Dashboard"
                ? location.pathname === item.href
                : location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}

          {!currentProject && (
            <Link
              to="/app/onboarding"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </Link>
          )}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-medium text-sidebar-accent-foreground">
              {session?.user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {session?.user?.name ?? "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {session?.user?.email}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg hover:bg-sidebar-accent text-muted-foreground"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default Layout;
