export type ProjectDestination =
  | "sources"
  | "help-center"
  | "sops"
  | "company-info"
  | "chat-widget"
  | "greetings"
  | "tools"
  | "dashboard"
  | "customers"
  | "mcp-connections"
  | "settings";

export type ChatWidgetTab = "appearance" | "actions";

const destinationPaths: Record<ProjectDestination, string> = {
  sources: "/knowledgebase/sources",
  "help-center": "/knowledgebase/help-center",
  sops: "/knowledgebase/sops",
  "company-info": "/knowledgebase/company-info",
  "chat-widget": "/support-chat/widget",
  greetings: "/support-chat/greetings",
  tools: "/support-chat/tools",
  dashboard: "",
  customers: "/customers",
  "mcp-connections": "/mcp-connections",
  settings: "/settings",
};

export function projectRoute(
  projectId: string,
  destination: ProjectDestination,
): string {
  return `/app/projects/${projectId}${destinationPaths[destination]}`;
}

export function getInboxDestination(
  projectId: string,
  inboxCounts: Record<string, number> | undefined,
): string {
  return (inboxCounts?.["needs-you"] ?? 0) > 0
    ? `/app/projects/${projectId}/conversations?filter=needs-you&focus=true`
    : `/app/projects/${projectId}/conversations?filter=inbox`;
}

export function normalizeChatWidgetTab(value: string | null): ChatWidgetTab {
  return value === "actions" ? "actions" : "appearance";
}

export function getLegacySettingsDestination(
  projectId: string,
  value: string | null,
): string | null {
  if (value === "general") return projectRoute(projectId, "company-info");
  if (value === "mcp") return projectRoute(projectId, "mcp-connections");
  return null;
}
