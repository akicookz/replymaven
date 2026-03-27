import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import Layout from "./components/Layout";
import AccountLayout from "./components/AccountLayout";
import WidgetLayout from "./components/WidgetLayout";
import AuthGuard from "./components/AuthGuard";
import OnboardingGuard from "./components/OnboardingGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";

import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Conversations from "./pages/Conversations";
import Resources from "./pages/Resources";
import QuickActions from "./pages/QuickActions";
import CannedResponses from "./pages/CannedResponses";
import Tools from "./pages/Tools";
import Inquiries from "./pages/Inquiries";
import CompanyInfo from "./pages/CompanyInfo";
import Sops from "./pages/Sops";
import Profile from "./pages/Profile";
import Team from "./pages/Team";
import Billing from "./pages/Billing";
import AuthCallback from "./pages/AuthCallback";
import Docs from "./pages/Docs";
import WidgetAppearance from "./pages/widgets/WidgetAppearance";
import WidgetHome from "./pages/widgets/WidgetHome";
import WidgetEmbedVisibility from "./pages/widgets/WidgetEmbedVisibility";

// ─── Redirect /app to first project's dashboard ──────────────────────────────
function DashboardRedirect() {
  const { data: projects, isLoading } = useQuery<{ id: string }[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  if (isLoading) return null;

  if (!projects || projects.length === 0) {
    return <Navigate to="/app/onboarding" replace />;
  }

  return <Navigate to={`/app/projects/${projects[0].id}`} replace />;
}

function ProjectWidgetRedirect({
  target,
}: {
  target: "quick-actions" | "tools";
}) {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/app" replace />;
  }

  return (
    <Navigate to={`/app/projects/${projectId}/widget/${target}`} replace />
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<Docs />} />

      <Route
        path="/api/auth/callback/:provider"
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

      {/* Account pages -- separate layout */}
      <Route
        path="/app/account"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <AccountLayout />
            </AuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<Profile />} />
        <Route path="team" element={<Team />} />
        <Route path="billing" element={<Billing />} />
        <Route
          path="members"
          element={<Navigate to="/app/account/team" replace />}
        />
      </Route>

      <Route
        path="/app/projects/:projectId/widget"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <OnboardingGuard>
                <WidgetLayout />
              </OnboardingGuard>
            </AuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<Navigate to="appearance" replace />} />
        <Route path="appearance" element={<WidgetAppearance />} />
        <Route path="home" element={<WidgetHome />} />
        <Route path="quick-actions" element={<QuickActions />} />
        <Route path="tools" element={<Tools />} />
        <Route path="embed" element={<WidgetEmbedVisibility />} />
      </Route>

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
          path="projects/:projectId/knowledgebase"
          element={<Resources />}
        />
        <Route
          path="projects/:projectId/knowledgebase/company-info"
          element={<CompanyInfo />}
        />
        <Route
          path="projects/:projectId/knowledgebase/sops"
          element={<Sops />}
        />
        <Route
          path="projects/:projectId/resources"
          element={<Navigate to="../knowledgebase" replace />}
        />
        <Route
          path="projects/:projectId/settings"
          element={<Navigate to="../knowledgebase" replace />}
        />
        <Route
          path="projects/:projectId/canned-responses"
          element={<CannedResponses />}
        />
        <Route
          path="projects/:projectId/inquiries"
          element={<Inquiries />}
        />
        <Route
          path="projects/:projectId/quick-actions"
          element={<ProjectWidgetRedirect target="quick-actions" />}
        />
        <Route
          path="projects/:projectId/tools"
          element={<ProjectWidgetRedirect target="tools" />}
        />
      </Route>
    </Routes>
  );
}

export default App;
