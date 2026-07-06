import { useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ThemeContext } from "@/lib/theme";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import OnboardingGuard from "./components/OnboardingGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import { useSubscription } from "./hooks/use-subscription";

import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Conversations from "./pages/Conversations";
import Knowledge from "./pages/Knowledge";
import QuickActions from "./pages/QuickActions";
import Configuration from "./pages/Configuration";
import Settings from "./pages/Settings";
import AuthCallback from "./pages/AuthCallback";
import Docs from "./pages/Docs";
import TeamAccept from "./pages/TeamAccept";
import HelpCenterSettings from "./pages/HelpCenterSettings";
import HelpArticleEditor from "./pages/HelpArticleEditor";

// ─── Redirect /app to first project's dashboard ──────────────────────────────
function DashboardRedirect() {
  const { data: subData, isPending: subPending } = useSubscription();
  const isTeamMember =
    subData?.role === "admin" || subData?.role === "member";

  const { data: projects, isPending: projectsPending } = useQuery<
    { id: string }[]
  >({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    enabled: !subPending,
  });

  // Wait for both the role and the projects list before deciding where to go.
  if (subPending || projectsPending || subData === undefined) return null;

  if (projects && projects.length > 0) {
    return <Navigate to={`/app/projects/${projects[0].id}`} replace />;
  }

  // Team members must never be redirected to onboarding -- they access the
  // owner's projects. If the owner genuinely has no projects there's nothing
  // to show, so render a placeholder rather than bouncing to onboarding.
  if (isTeamMember) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">
          No projects available yet. Ask your team owner to create one.
        </div>
      </div>
    );
  }

  // If the newly-authenticated user has a pending invite for their email,
  // route them straight to the accept page instead of the owner onboarding
  // flow. Once accepted, they come back here as a team member.
  if (subData.pendingInvite) {
    return (
      <Navigate
        to={`/app/team/accept/${subData.pendingInvite.id}`}
        replace
      />
    );
  }

  return <Navigate to="/app/onboarding" replace />;
}

function AccountRedirect({ tab }: { tab: string }) {
  const { data: projects, isPending } = useQuery<{ id: string }[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  if (isPending) return null;
  if (projects && projects.length > 0) {
    return (
      <Navigate
        to={`/app/projects/${projects[0].id}/settings?tab=${tab}`}
        replace
      />
    );
  }
  return <Navigate to="/app" replace />;
}

function ProjectPageRedirect({ target }: { target: string }) {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/app" replace />;
  }

  return <Navigate to={`/app/projects/${projectId}/${target}`} replace />;
}

function App() {
  // The landing pages and the dashboard are dark-only — no theme switching.
  // (The deployed help-desk widget keeps its own light/dark via per-project
  // widget config; that is independent of this global app theme.)
  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: "dark", setTheme: () => {}, toggleTheme: () => {} }}>
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: "!bg-card !text-foreground !border-border",
      }}
    />
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<Docs />} />

      <Route
        path="/api/auth/*"
        element={<AuthCallback />}
      />

      {/* Onboarding -- full screen, no sidebar */}
      <Route
        path="/app/onboarding"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <Onboarding />
            </AuthGuard>
          </ErrorBoundary>
        }
      />

      {/* Team invite accept -- standalone page */}
      <Route
        path="/app/team/accept/:inviteId"
        element={
          <ErrorBoundary>
            <TeamAccept />
          </ErrorBoundary>
        }
      />

      {/* Legacy account URLs -- now tabs in project Settings */}
      <Route
        path="/app/account"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <AccountRedirect tab="profile" />
            </AuthGuard>
          </ErrorBoundary>
        }
      />
      <Route
        path="/app/account/team"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <AccountRedirect tab="team" />
            </AuthGuard>
          </ErrorBoundary>
        }
      />
      <Route
        path="/app/account/billing"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <AccountRedirect tab="billing" />
            </AuthGuard>
          </ErrorBoundary>
        }
      />
      <Route
        path="/app/account/members"
        element={<Navigate to="/app/account/team" replace />}
      />

      {/* /app index -- redirect to first project dashboard */}
      <Route
        path="/app"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <OnboardingGuard>
                <Layout />
              </OnboardingGuard>
            </AuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<DashboardRedirect />} />
        <Route path="new-project" element={<Onboarding />} />
        <Route
          path="projects/:projectId"
          element={<Dashboard />}
        />
        <Route
          path="projects/:projectId/conversations"
          element={<Conversations />}
        />
        <Route
          path="projects/:projectId/knowledge"
          element={<Knowledge />}
        />
        <Route
          path="projects/:projectId/company"
          element={<ProjectPageRedirect target="settings?tab=general" />}
        />
        <Route
          path="projects/:projectId/knowledgebase"
          element={<ProjectPageRedirect target="knowledge?tab=sources" />}
        />
        <Route
          path="projects/:projectId/knowledgebase/company-info"
          element={<ProjectPageRedirect target="company" />}
        />
        <Route
          path="projects/:projectId/knowledgebase/sops"
          element={<ProjectPageRedirect target="knowledge?tab=sops" />}
        />
        <Route
          path="projects/:projectId/resources"
          element={<ProjectPageRedirect target="knowledge?tab=sources" />}
        />
        <Route
          path="projects/:projectId/settings"
          element={<Settings />}
        />
        <Route
          path="projects/:projectId/configuration"
          element={<Configuration />}
        />
        <Route
          path="projects/:projectId/widget"
          element={<ProjectPageRedirect target="configuration?section=appearance" />}
        />
        <Route
          path="projects/:projectId/widget/home"
          element={<ProjectPageRedirect target="configuration?section=appearance" />}
        />
        <Route
          path="projects/:projectId/widget/greetings"
          element={<ProjectPageRedirect target="configuration?section=greetings" />}
        />
        <Route
          path="projects/:projectId/widget/installation"
          element={<ProjectPageRedirect target="configuration?section=installation" />}
        />
        <Route
          path="projects/:projectId/widget/quick-actions"
          element={<ProjectPageRedirect target="quick-actions" />}
        />
        <Route
          path="projects/:projectId/widget/tools"
          element={<ProjectPageRedirect target="quick-actions?tab=tools" />}
        />
        <Route
          path="projects/:projectId/widget/*"
          element={<ProjectPageRedirect target="widget" />}
        />
        <Route
          path="projects/:projectId/tickets"
          element={<Navigate to="../conversations?filter=needs-you" replace />}
        />
        <Route
          path="projects/:projectId/inquiries"
          element={<Navigate to="../conversations?filter=needs-you" replace />}
        />
        <Route
          path="projects/:projectId/quick-actions"
          element={<QuickActions />}
        />
        <Route
          path="projects/:projectId/tools"
          element={<ProjectPageRedirect target="quick-actions?tab=tools" />}
        />
        <Route
          path="projects/:projectId/help"
          element={<ProjectPageRedirect target="knowledge?tab=articles" />}
        />
        <Route
          path="projects/:projectId/help/settings"
          element={<HelpCenterSettings />}
        />
        <Route
          path="projects/:projectId/help/articles/new"
          element={<HelpArticleEditor />}
        />
        <Route
          path="projects/:projectId/help/articles/:articleId"
          element={<HelpArticleEditor />}
        />
      </Route>
    </Routes>
    </ThemeContext.Provider>
  );
}

export default App;
