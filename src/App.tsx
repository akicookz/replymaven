import { useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import {
  getInboxDestination,
  projectRoute,
} from "@/lib/dashboard-routes";
import { ThemeContext } from "@/lib/theme";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import OnboardingGuard from "./components/OnboardingGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import LandingMocks from "./pages/LandingMocks";
import { useSubscription } from "./hooks/use-subscription";

import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Conversations from "./pages/Conversations";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import ChatWidget from "./pages/ChatWidget";
import GeneralSettings from "./pages/GeneralSettings";
import HelpCenter from "./pages/HelpCenter";
import McpConnections from "./pages/McpConnections";
import Resources from "./pages/Resources";
import Sops from "./pages/Sops";
import Tools from "./pages/Tools";
import Settings from "./pages/Settings";
import WidgetGreetings from "./pages/WidgetGreetings";
import AuthCallback from "./pages/AuthCallback";
import TeamAccept from "./pages/TeamAccept";
import HelpCenterSettings from "./pages/HelpCenterSettings";
import HelpArticleEditor from "./pages/HelpArticleEditor";
import HelpHomeEditor from "./pages/HelpHomeEditor";

// ─── Redirect /app to first project's inbox ──────────────────────────────────
function AppRedirect() {
  const { data: subData, isPending: subPending } = useSubscription();
  const isTeamMember =
    subData?.role === "admin" || subData?.role === "member";

  const {
    data: projects,
    isPending: projectsPending,
  } = useQuery<{ id: string }[]>({
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
    return <InboxRedirect />;
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

function InboxRedirect() {
  const {
    data: projects,
    isPending: projectsPending,
    isFetching: projectsFetching,
  } = useQuery<{ id: string }[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
    staleTime: 0,
  });

  const projectId = projects?.[0]?.id;
  const {
    data: inboxCounts,
    isPending: countsPending,
    isFetching: countsFetching,
  } = useQuery<Record<string, number>>({
    queryKey: ["inbox-counts", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/inbox-counts`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: Boolean(projectId),
    staleTime: 0,
  });

  if (
    projectsPending ||
    projectsFetching ||
    (projectId && (countsPending || countsFetching))
  ) {
    return null;
  }
  if (!projectId) return <Navigate to="/app" replace />;

  const destination = getInboxDestination(projectId, inboxCounts);

  return <Navigate to={destination} replace />;
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

function LegacyKnowledgeRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;

  const tab = searchParams.get("tab");
  const destination = tab === "sources"
    ? "sources"
    : tab === "sops"
      ? "sops"
      : "help-center";

  return <Navigate to={projectRoute(projectId, destination)} replace />;
}

function LegacyConfigurationRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;

  const section = searchParams.get("section") ?? searchParams.get("tab");
  if (section === "greetings") {
    return <Navigate to={projectRoute(projectId, "greetings")} replace />;
  }
  if (section === "installation") {
    return (
      <Navigate
        to={`${projectRoute(projectId, "chat-widget")}?install=open`}
        replace
      />
    );
  }
  if (section === "conversation") {
    return <Navigate to={projectRoute(projectId, "company-info")} replace />;
  }
  if (section === "actions") {
    const destination = searchParams.get("tab") === "tools"
      ? projectRoute(projectId, "tools")
      : `${projectRoute(projectId, "chat-widget")}?tab=actions`;
    return <Navigate to={destination} replace />;
  }

  return <Navigate to={projectRoute(projectId, "chat-widget")} replace />;
}

function LegacyQuickActionsRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;

  const destination = searchParams.get("tab") === "tools"
    ? projectRoute(projectId, "tools")
    : `${projectRoute(projectId, "chat-widget")}?tab=actions`;
  return <Navigate to={destination} replace />;
}

function LegacyHelpRedirect({ target }: { target: "index" | "settings" | "new" | "article" }) {
  const { projectId, articleId } = useParams<{
    projectId: string;
    articleId?: string;
  }>();
  const location = useLocation();

  if (!projectId) return <Navigate to="/app" replace />;

  const base = projectRoute(projectId, "help-center");
  const pathname = target === "settings"
    ? `${base}/settings`
    : target === "new"
      ? `${base}/articles/new`
      : target === "article" && articleId
        ? `${base}/articles/${articleId}`
        : base;

  return (
    <Navigate
      to={{ pathname, search: location.search }}
      replace
    />
  );
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
      <Route path="/landing-mocks" element={<LandingMocks />} />

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

      <Route
        path="/app/inbox"
        element={
          <ErrorBoundary>
            <AuthGuard>
              <OnboardingGuard>
                <InboxRedirect />
              </OnboardingGuard>
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

      {/* /app index -- redirect to the first project's prioritized inbox */}
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
        <Route index element={<AppRedirect />} />
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
          path="projects/:projectId/customers"
          element={<Customers />}
        />
        <Route
          path="projects/:projectId/customers/:customerId"
          element={<CustomerDetail />}
        />
        <Route
          path="projects/:projectId/knowledge"
          element={<LegacyKnowledgeRedirect />}
        />
        <Route
          path="projects/:projectId/company"
          element={<ProjectPageRedirect target="knowledgebase/company-info" />}
        />
        <Route
          path="projects/:projectId/knowledgebase"
          element={<ProjectPageRedirect target="knowledgebase/sources" />}
        />
        <Route
          path="projects/:projectId/knowledgebase/sources"
          element={<Resources />}
        />
        <Route
          path="projects/:projectId/knowledgebase/help-center"
          element={<HelpCenter />}
        />
        <Route
          path="projects/:projectId/knowledgebase/company-info"
          element={<GeneralSettings />}
        />
        <Route
          path="projects/:projectId/knowledgebase/sops"
          element={<Sops />}
        />
        <Route
          path="projects/:projectId/resources"
          element={<ProjectPageRedirect target="knowledgebase/sources" />}
        />
        <Route
          path="projects/:projectId/settings"
          element={<Settings />}
        />
        <Route
          path="projects/:projectId/mcp-connections"
          element={<McpConnections />}
        />
        <Route
          path="projects/:projectId/support-chat/widget"
          element={<ChatWidget />}
        />
        <Route
          path="projects/:projectId/support-chat/greetings"
          element={<WidgetGreetings />}
        />
        <Route
          path="projects/:projectId/support-chat/tools"
          element={<Tools />}
        />
        <Route
          path="projects/:projectId/configuration"
          element={<LegacyConfigurationRedirect />}
        />
        <Route
          path="projects/:projectId/widget"
          element={<ProjectPageRedirect target="support-chat/widget" />}
        />
        <Route
          path="projects/:projectId/widget/home"
          element={<ProjectPageRedirect target="support-chat/widget" />}
        />
        <Route
          path="projects/:projectId/widget/greetings"
          element={<ProjectPageRedirect target="support-chat/greetings" />}
        />
        <Route
          path="projects/:projectId/widget/installation"
          element={<ProjectPageRedirect target="support-chat/widget?install=open" />}
        />
        <Route
          path="projects/:projectId/widget/quick-actions"
          element={<ProjectPageRedirect target="support-chat/widget?tab=actions" />}
        />
        <Route
          path="projects/:projectId/widget/tools"
          element={<ProjectPageRedirect target="support-chat/tools" />}
        />
        <Route
          path="projects/:projectId/widget/*"
          element={<ProjectPageRedirect target="support-chat/widget" />}
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
          element={<LegacyQuickActionsRedirect />}
        />
        <Route
          path="projects/:projectId/tools"
          element={<ProjectPageRedirect target="support-chat/tools" />}
        />
        <Route
          path="projects/:projectId/help"
          element={<LegacyHelpRedirect target="index" />}
        />
        <Route
          path="projects/:projectId/help/settings"
          element={<LegacyHelpRedirect target="settings" />}
        />
        <Route
          path="projects/:projectId/help/articles/new"
          element={<LegacyHelpRedirect target="new" />}
        />
        <Route
          path="projects/:projectId/help/articles/:articleId"
          element={<LegacyHelpRedirect target="article" />}
        />
        <Route
          path="projects/:projectId/knowledgebase/help-center/home"
          element={<HelpHomeEditor />}
        />
        <Route
          path="projects/:projectId/knowledgebase/help-center/settings"
          element={<HelpCenterSettings />}
        />
        <Route
          path="projects/:projectId/knowledgebase/help-center/articles/new"
          element={<HelpArticleEditor />}
        />
        <Route
          path="projects/:projectId/knowledgebase/help-center/articles/:articleId"
          element={<HelpArticleEditor />}
        />
      </Route>
    </Routes>
    </ThemeContext.Provider>
  );
}

export default App;
