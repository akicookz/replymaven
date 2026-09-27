import { useEffect, type ReactNode } from "react";
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
  getLegacySettingsDestination,
  projectRoute,
  settingsRoute,
  type ProjectDestination,
} from "@/lib/dashboard-routes";
import { ThemeContext } from "@/lib/theme";

import Layout from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import OnboardingGuard from "./components/OnboardingGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./pages/Landing";
import ContactSales from "./pages/ContactSales";
import LandingMocks from "./pages/LandingMocks";
import { useSubscription } from "./hooks/use-subscription";

import Onboarding from "./pages/Onboarding";
import Conversations from "./pages/Conversations";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import HelpCenter from "./pages/HelpCenter";
import McpConnections from "./pages/McpConnections";
import Resources from "./pages/Resources";
import SourceDetail from "./pages/SourceDetail";
import CrawledPageDetail from "./pages/CrawledPageDetail";
import Sops from "./pages/Sops";
import Tools from "./pages/Tools";
import WidgetGreetings from "./pages/WidgetGreetings";
import AuthCallback from "./pages/AuthCallback";
import TeamAccept from "./pages/TeamAccept";
import LinkTelegram from "./pages/LinkTelegram";
import HelpCenterSettings from "./pages/HelpCenterSettings";
import HelpArticleEditor from "./pages/HelpArticleEditor";
import HelpHomeEditor from "./pages/HelpHomeEditor";
import ProjectSettings from "./pages/ProjectSettings";
import { SettingsPage } from "./components/settings/SettingsPage";
import Team from "./pages/Team";
import Billing from "./pages/Billing";
import Profile from "./pages/Profile";
import {
  AppearanceSettings,
  QuickActionsSettings,
} from "./pages/settings/WidgetSettingsPages";
import { InstallSettings } from "./pages/settings/InstallSettings";
import { ChannelsSettings } from "./pages/settings/ChannelSettings";

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

function InboxRedirect({ projectId: targetProjectId }: { projectId?: string }) {
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

  const projectId = targetProjectId ?? projects?.[0]?.id;
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
        to={getLegacySettingsDestination(projects[0].id, tab)}
        replace
      />
    );
  }
  return <Navigate to="/app" replace />;
}

function ProjectHomeRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  return <InboxRedirect projectId={projectId} />;
}

// Old URLs keep working; the query string rides along unless a target sets its own.
function ProjectRedirect({ to }: { to: ProjectDestination }) {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  if (!projectId) return <Navigate to="/app" replace />;
  return (
    <Navigate
      to={{ pathname: projectRoute(projectId, to), search: location.search }}
      replace
    />
  );
}

function SettingsIndexRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  if (!projectId) return <Navigate to="/app" replace />;
  return (
    <Navigate
      to={getLegacySettingsDestination(projectId, searchParams.get("tab"))}
      replace
    />
  );
}

function LegacyKnowledgeRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;

  const destination = ({
    sources: "knowledge",
    sops: "behavior",
  } as const)[searchParams.get("tab") ?? ""] ?? "help-center";

  return <Navigate to={projectRoute(projectId, destination)} replace />;
}

function LegacyChatWidgetRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;
  if (searchParams.get("install") === "open") {
    return <Navigate to={settingsRoute(projectId, "install")} replace />;
  }
  if (searchParams.get("tab") === "actions") {
    return <Navigate to={settingsRoute(projectId, "quick-actions")} replace />;
  }
  return <Navigate to={settingsRoute(projectId, "appearance")} replace />;
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
    return <Navigate to={settingsRoute(projectId, "install")} replace />;
  }
  if (section === "conversation") {
    return <Navigate to={settingsRoute(projectId, "project")} replace />;
  }
  if (section === "actions") {
    const destination = searchParams.get("tab") === "tools"
      ? projectRoute(projectId, "connectors")
      : settingsRoute(projectId, "quick-actions");
    return <Navigate to={destination} replace />;
  }

  return <Navigate to={settingsRoute(projectId, "appearance")} replace />;
}

function LegacyQuickActionsRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  if (!projectId) return <Navigate to="/app" replace />;

  const destination = searchParams.get("tab") === "tools"
    ? projectRoute(projectId, "connectors")
    : settingsRoute(projectId, "quick-actions");
  return <Navigate to={destination} replace />;
}

function LegacyHelpRedirect({ target }: { target: "index" | "settings" | "new" | "article" | "home" }) {
  const { projectId, articleId } = useParams<{
    projectId: string;
    articleId?: string;
  }>();
  const location = useLocation();

  if (!projectId) return <Navigate to="/app" replace />;

  const base = projectRoute(projectId, "help-center");
  const pathnames: Record<typeof target, string> = {
    index: base,
    settings: settingsRoute(projectId, "help-center"),
    new: `${base}/articles/new`,
    article: articleId ? `${base}/articles/${articleId}` : base,
    home: projectRoute(projectId, "help-home"),
  };

  return (
    <Navigate
      to={{ pathname: pathnames[target], search: location.search }}
      replace
    />
  );
}

// Width frame for Settings sections that render their own header; matches SettingsPage.
function SettingsFrame({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-4xl">{children}</div>;
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
      <Route path="/contact-sales" element={<ContactSales />} />
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

      {/* Telegram account link -- standalone page */}
      <Route
        path="/app/link/telegram"
        element={
          <ErrorBoundary>
            <LinkTelegram />
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
        <Route path="new-project" element={<Navigate to="/app/onboarding?new=1" replace />} />
        <Route path="projects/:projectId" element={<ProjectHomeRedirect />} />
        <Route path="projects/:projectId/conversations" element={<Conversations />} />
        <Route path="projects/:projectId/customers" element={<Customers />} />
        <Route path="projects/:projectId/customers/:customerId" element={<CustomerDetail />} />

        {/* Maven */}
        <Route path="projects/:projectId/maven/knowledge" element={<Resources />} />
        <Route path="projects/:projectId/maven/knowledge/:resourceId" element={<SourceDetail />} />
        <Route path="projects/:projectId/maven/knowledge/:resourceId/pages/:pageId" element={<CrawledPageDetail />} />
        <Route path="projects/:projectId/maven/behavior" element={<Sops />} />
        <Route path="projects/:projectId/maven/connectors" element={<Tools />} />
        <Route path="projects/:projectId/maven/greetings" element={<WidgetGreetings />} />

        {/* Help Center */}
        <Route path="projects/:projectId/help-center" element={<HelpCenter />} />
        <Route path="projects/:projectId/help-center/home" element={<HelpHomeEditor />} />
        <Route path="projects/:projectId/help-center/articles/new" element={<HelpArticleEditor />} />
        <Route path="projects/:projectId/help-center/articles/:articleId" element={<HelpArticleEditor />} />

        {/* Settings */}
        <Route path="projects/:projectId/settings" element={<SettingsIndexRedirect />} />
        <Route path="projects/:projectId/settings/appearance" element={<AppearanceSettings />} />
        <Route path="projects/:projectId/settings/quick-actions" element={<QuickActionsSettings />} />
        <Route path="projects/:projectId/settings/install" element={<InstallSettings />} />
        <Route path="projects/:projectId/settings/channels" element={<ChannelsSettings />} />
        <Route path="projects/:projectId/settings/email" element={<ProjectRedirect to="settings-channels" />} />
        <Route path="projects/:projectId/settings/telegram" element={<ProjectRedirect to="settings-channels" />} />
        <Route path="projects/:projectId/settings/slack" element={<ProjectRedirect to="settings-channels" />} />
        <Route path="projects/:projectId/settings/help-center" element={<SettingsFrame><HelpCenterSettings /></SettingsFrame>} />
        <Route path="projects/:projectId/settings/connected-apps" element={<SettingsFrame><McpConnections /></SettingsFrame>} />
        <Route path="projects/:projectId/settings/project" element={<ProjectSettings />} />
        <Route path="projects/:projectId/settings/team" element={<SettingsPage title="Team"><Team /></SettingsPage>} />
        <Route path="projects/:projectId/settings/billing" element={<SettingsFrame><Billing /></SettingsFrame>} />
        <Route path="projects/:projectId/settings/profile" element={<SettingsFrame><Profile /></SettingsFrame>} />

        {/* Legacy URLs */}
        <Route path="projects/:projectId/knowledge" element={<LegacyKnowledgeRedirect />} />
        <Route path="projects/:projectId/company" element={<ProjectRedirect to="knowledge" />} />
        <Route path="projects/:projectId/knowledgebase" element={<ProjectRedirect to="knowledge" />} />
        <Route path="projects/:projectId/knowledgebase/sources" element={<ProjectRedirect to="knowledge" />} />
        <Route path="projects/:projectId/knowledgebase/sops" element={<ProjectRedirect to="behavior" />} />
        <Route path="projects/:projectId/knowledgebase/company-info" element={<ProjectRedirect to="knowledge" />} />
        <Route path="projects/:projectId/help-center" element={<LegacyHelpRedirect target="index" />} />
        <Route path="projects/:projectId/help-center/home" element={<LegacyHelpRedirect target="home" />} />
        <Route path="projects/:projectId/settings/help-center" element={<LegacyHelpRedirect target="settings" />} />
        <Route path="projects/:projectId/help-center/articles/new" element={<LegacyHelpRedirect target="new" />} />
        <Route path="projects/:projectId/help-center/articles/:articleId" element={<LegacyHelpRedirect target="article" />} />
        <Route path="projects/:projectId/resources" element={<ProjectRedirect to="knowledge" />} />
        <Route path="projects/:projectId/mcp-connections" element={<ProjectRedirect to="settings-connected-apps" />} />
        <Route path="projects/:projectId/support-chat/widget" element={<LegacyChatWidgetRedirect />} />
        <Route path="projects/:projectId/support-chat/greetings" element={<ProjectRedirect to="greetings" />} />
        <Route path="projects/:projectId/support-chat/tools" element={<ProjectRedirect to="connectors" />} />
        <Route path="projects/:projectId/configuration" element={<LegacyConfigurationRedirect />} />
        <Route path="projects/:projectId/widget" element={<ProjectRedirect to="settings-appearance" />} />
        <Route path="projects/:projectId/widget/home" element={<ProjectRedirect to="settings-appearance" />} />
        <Route path="projects/:projectId/widget/greetings" element={<ProjectRedirect to="greetings" />} />
        <Route path="projects/:projectId/widget/installation" element={<ProjectRedirect to="settings-install" />} />
        <Route path="projects/:projectId/widget/quick-actions" element={<ProjectRedirect to="settings-quick-actions" />} />
        <Route path="projects/:projectId/widget/tools" element={<ProjectRedirect to="connectors" />} />
        <Route path="projects/:projectId/widget/*" element={<ProjectRedirect to="settings-appearance" />} />
        <Route path="projects/:projectId/tickets" element={<Navigate to="../conversations?filter=needs-you" replace />} />
        <Route path="projects/:projectId/inquiries" element={<Navigate to="../conversations?filter=needs-you" replace />} />
        <Route path="projects/:projectId/quick-actions" element={<LegacyQuickActionsRedirect />} />
        <Route path="projects/:projectId/tools" element={<ProjectRedirect to="connectors" />} />
        <Route path="projects/:projectId/help" element={<LegacyHelpRedirect target="index" />} />
        <Route path="projects/:projectId/help/settings" element={<LegacyHelpRedirect target="settings" />} />
        <Route path="projects/:projectId/help/articles/new" element={<LegacyHelpRedirect target="new" />} />
        <Route path="projects/:projectId/help/articles/:articleId" element={<LegacyHelpRedirect target="article" />} />
      </Route>
    </Routes>
    </ThemeContext.Provider>
  );
}

export default App;
