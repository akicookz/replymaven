import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import OnboardingGuard from "./components/OnboardingGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Conversations from "./pages/Conversations";
import Resources from "./pages/Resources";
import WidgetConfig from "./pages/WidgetConfig";
import ProjectSettings from "./pages/ProjectSettings";
import QuickActions from "./pages/QuickActions";
import CannedResponses from "./pages/CannedResponses";
import TelegramConfig from "./pages/TelegramConfig";
import AuthCallback from "./pages/AuthCallback";

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

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
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
          path="projects/:projectId/resources"
          element={<Resources />}
        />
        <Route
          path="projects/:projectId/widget"
          element={<WidgetConfig />}
        />
        <Route
          path="projects/:projectId/settings"
          element={<ProjectSettings />}
        />
        <Route
          path="projects/:projectId/quick-actions"
          element={<QuickActions />}
        />
        <Route
          path="projects/:projectId/canned-responses"
          element={<CannedResponses />}
        />
        <Route
          path="projects/:projectId/telegram"
          element={<TelegramConfig />}
        />
      </Route>
    </Routes>
  );
}

export default App;
