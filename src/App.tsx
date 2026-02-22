import { Routes, Route } from "react-router-dom";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import NewProject from "./pages/NewProject";
import Conversations from "./pages/Conversations";
import Resources from "./pages/Resources";
import WidgetConfig from "./pages/WidgetConfig";
import ProjectSettings from "./pages/ProjectSettings";
import QuickActions from "./pages/QuickActions";
import CannedResponses from "./pages/CannedResponses";
import TelegramConfig from "./pages/TelegramConfig";
import AuthCallback from "./pages/AuthCallback";

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
      <Route
        path="/app"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <Layout />
            </AuthGuard>
          </ErrorBoundary>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="new-project" element={<NewProject />} />
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
