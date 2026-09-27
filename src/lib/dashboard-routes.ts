export type SettingsSection =
  | "appearance"
  | "quick-actions"
  | "install"
  | "channels"
  | "help-center"
  | "connected-apps"
  | "project"
  | "team"
  | "billing"
  | "profile";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  "appearance",
  "quick-actions",
  "install",
  "channels",
  "help-center",
  "connected-apps",
  "project",
  "team",
  "billing",
  "profile",
];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "appearance";

export type ProjectDestination =
  | "customers"
  | "knowledge"
  | "behavior"
  | "connectors"
  | "greetings"
  | "help-center"
  | "help-home"
  | "settings"
  | `settings-${SettingsSection}`;

const destinationPaths: Record<ProjectDestination, string> = {
  customers: "/customers",
  knowledge: "/maven/knowledge",
  behavior: "/maven/behavior",
  connectors: "/maven/connectors",
  greetings: "/maven/greetings",
  "help-center": "/help-center",
  "help-home": "/help-center/home",
  settings: "/settings",
  "settings-appearance": "/settings/appearance",
  "settings-quick-actions": "/settings/quick-actions",
  "settings-install": "/settings/install",
  "settings-channels": "/settings/channels",
  "settings-help-center": "/settings/help-center",
  "settings-connected-apps": "/settings/connected-apps",
  "settings-project": "/settings/project",
  "settings-team": "/settings/team",
  "settings-billing": "/settings/billing",
  "settings-profile": "/settings/profile",
};

export function projectRoute(
  projectId: string,
  destination: ProjectDestination,
): string {
  return `/app/projects/${projectId}${destinationPaths[destination]}`;
}

export function settingsRoute(
  projectId: string,
  section: SettingsSection,
): string {
  return projectRoute(projectId, `settings-${section}`);
}

export function isSettingsSection(value: string | null | undefined): value is SettingsSection {
  return value != null && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function helpArticleRoute(projectId: string, articleId: string): string {
  return `${projectRoute(projectId, "help-center")}/articles/${articleId}`;
}

export function getInboxDestination(
  projectId: string,
  inboxCounts: Record<string, number> | undefined,
): string {
  return (inboxCounts?.["needs-you"] ?? 0) > 0
    ? `/app/projects/${projectId}/conversations?filter=needs-you&focus=true`
    : `/app/projects/${projectId}/conversations?filter=inbox`;
}

// Old `/settings?tab=` values and the pages that used to own them.
const LEGACY_SETTINGS_TABS: Record<string, ProjectDestination> = {
  team: "settings-team",
  billing: "settings-billing",
  profile: "settings-profile",
  project: "settings-project",
  general: "settings-project",
  mcp: "settings-connected-apps",
};

export function getLegacySettingsDestination(
  projectId: string,
  value: string | null,
): string {
  const destination = value ? LEGACY_SETTINGS_TABS[value] : undefined;
  return projectRoute(
    projectId,
    destination ?? `settings-${DEFAULT_SETTINGS_SECTION}`,
  );
}
