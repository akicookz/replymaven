import { useState, useEffect, useCallback } from "react";
import { Outlet, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Globe,
  House,
  LogOut,
  Palette,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut, useSession } from "@/lib/auth-client";
import { MobileSidebarContext } from "@/lib/mobile-sidebar";
import { cn } from "@/lib/utils";

interface ProjectData {
  id: string;
  name: string;
}

const widgetNav = [
  {
    label: "Appearance",
    path: "appearance",
    icon: Palette,
  },
  {
    label: "Widget Home",
    path: "home",
    icon: House,
  },
  {
    label: "Quick Actions",
    path: "quick-actions",
    icon: Zap,
  },
  {
    label: "Tools",
    path: "tools",
    icon: Wrench,
  },
  {
    label: "Embed and Visibility",
    path: "embed",
    icon: Globe,
  },
] as const;

function WidgetLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: project } = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      return res.json();
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  function isActive(href: string): boolean {
    return location.pathname === href;
  }

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";

  return (
    <div className="flex h-screen bg-background">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar w-60 transition-all duration-200",
          "hidden md:flex",
          mobileOpen
            ? "fixed inset-y-0 left-0 z-50 flex"
            : "fixed inset-y-0 left-0 z-50 -translate-x-full md:translate-x-0 md:relative",
        )}
      >
        <div className="flex items-center justify-between px-4 h-14">
          <Link to="/app">
            <Logo size="sm" />
          </Link>
          <button
            onClick={closeMobile}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground transition-colors md:hidden"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <Link
            to={projectId ? `/app/projects/${projectId}` : "/app"}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3">
          <p className="px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {project ? `${project.name} widgets` : "Widgets"}
          </p>
          <div className="space-y-0.5">
            {widgetNav.map((item) => {
              const href = projectId
                ? `/app/projects/${projectId}/widget/${item.path}`
                : `/app/widget/${item.path}`;
              const active = isActive(href);

              return (
                <Link
                  key={item.path}
                  to={href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                    active
                      ? "glow-surface-subtle text-card-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-[18px] h-[18px] shrink-0",
                      active && "text-card-foreground",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="px-3 pb-3 pt-2 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate">
                {userName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {userEmail}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <MobileSidebarContext.Provider
        value={{ openSidebar: () => setMobileOpen(true) }}
      >
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-8 mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </MobileSidebarContext.Provider>
    </div>
  );
}

export default WidgetLayout;
