import { projectRoute, type ProjectDestination } from "../dashboard-routes";
import {
  INBOX_FILTERS,
  INBOX_FILTER_IDS,
  parseInboxFilter,
  type InboxFilter,
} from "../inbox/filters";

export const NAV_SEQUENCE_TIMEOUT_MS = 1000;

export type DashboardNavDestinationId = InboxFilter | ProjectDestination;

export type DashboardNavGroup =
  | "main"
  | "more"
  | "maven"
  | "help-center"
  | "settings-widget"
  | "settings-help-center"
  | "settings-apps"
  | "settings-workspace"
  | "settings-account"
  | "command-only";

export type DashboardNavCommandId = `navigate-${DashboardNavDestinationId}`;

export interface DashboardNavSequence {
  kind: "sequence";
  strokes: [{ key: "g" }, { key: string }];
  timeoutMs: typeof NAV_SEQUENCE_TIMEOUT_MS;
  keycap: { keys: [string, string] };
}

export interface DashboardNavItem {
  id: DashboardNavDestinationId;
  group: DashboardNavGroup;
  label: string;
  href: string;
  active: boolean;
  count?: number;
  searchTerms: string[];
  navigationCommandId: DashboardNavCommandId;
  sequence?: DashboardNavSequence;
}

export interface DashboardNavInput {
  projectId: string;
  pathname: string;
  search: string;
  counts?: Partial<Record<InboxFilter, number>>;
}

interface NavRecord {
  id: DashboardNavDestinationId;
  group: DashboardNavGroup;
  searchTerms: string[];
  sequenceKey?: string;
}

const PROJECT_LABELS: Record<ProjectDestination, string> = {
  customers: "Customers",
  knowledge: "Knowledge",
  behavior: "Behavior",
  connectors: "Connectors",
  greetings: "Greetings",
  "help-center": "Articles",
  "help-home": "Home page",
  settings: "Settings",
  "settings-appearance": "Appearance",
  "settings-quick-actions": "Quick actions",
  "settings-install": "Install",
  "settings-channels": "Channels",
  "settings-help-center": "Domain & site",
  "settings-connected-apps": "MCP",
  "settings-project": "Project",
  "settings-team": "Team",
  "settings-billing": "Billing",
  "settings-profile": "Profile",
};

export const NAV_GROUP_LABELS: Record<DashboardNavGroup, string | null> = {
  main: null,
  more: null,
  maven: "Maven",
  "help-center": "Help Center",
  "settings-widget": "Chat widget",
  "settings-help-center": "Help Center",
  "settings-apps": "Integrations",
  "settings-workspace": "Workspace",
  "settings-account": "Account",
  "command-only": null,
};

export const SIDEBAR_GROUPS: readonly DashboardNavGroup[] = [
  "main",
  "maven",
  "help-center",
];

export const SETTINGS_GROUPS: readonly DashboardNavGroup[] = [
  "settings-widget",
  "settings-help-center",
  "settings-apps",
  "settings-workspace",
  "settings-account",
];

const NAV_RECORDS: NavRecord[] = [
  {
    id: "needs-you",
    group: "main",
    searchTerms: ["needs you", "review", "waiting", "handoff"],
    sequenceKey: "y",
  },
  {
    id: "inbox",
    group: "main",
    searchTerms: ["inbox", "all conversations", "open"],
    sequenceKey: "i",
  },
  {
    id: "customers",
    group: "main",
    searchTerms: ["customers", "people", "contacts"],
    sequenceKey: "u",
  },
  {
    id: "snoozed",
    group: "more",
    searchTerms: ["snoozed", "later"],
    sequenceKey: "z",
  },
  {
    id: "resolved",
    group: "more",
    searchTerms: ["resolved", "closed", "done"],
    sequenceKey: "r",
  },
  {
    id: "archived",
    group: "more",
    searchTerms: ["archived"],
    sequenceKey: "a",
  },
  {
    id: "flagged",
    group: "more",
    searchTerms: ["spam", "flagged"],
    sequenceKey: "f",
  },
  {
    id: "knowledge",
    group: "maven",
    searchTerms: ["knowledge", "sources", "resources", "company", "context", "working hours"],
    sequenceKey: "k",
  },
  {
    id: "behavior",
    group: "maven",
    searchTerms: ["behavior", "sops", "guidelines", "persona", "tone", "voice", "assistant name"],
    sequenceKey: "b",
  },
  {
    id: "connectors",
    group: "maven",
    searchTerms: ["connectors", "tools", "mcp servers", "http", "webhooks"],
    sequenceKey: "c",
  },
  {
    id: "greetings",
    group: "maven",
    searchTerms: ["greetings", "intro", "welcome", "announcements"],
    sequenceKey: "g",
  },
  {
    id: "help-center",
    group: "help-center",
    searchTerms: ["help center", "docs", "articles"],
    sequenceKey: "h",
  },
  {
    id: "help-home",
    group: "help-center",
    searchTerms: ["help center home", "home page", "landing"],
  },
  {
    id: "settings",
    group: "command-only",
    searchTerms: ["settings", "preferences"],
    sequenceKey: "s",
  },
  {
    id: "settings-appearance",
    group: "settings-widget",
    searchTerms: ["appearance", "widget", "colors", "theme"],
  },
  {
    id: "settings-quick-actions",
    group: "settings-widget",
    searchTerms: ["quick actions", "widget buttons", "actions"],
  },
  {
    id: "settings-install",
    group: "settings-widget",
    searchTerms: ["install", "embed", "snippet", "identity secret", "signing"],
  },
  {
    id: "settings-help-center",
    group: "settings-help-center",
    searchTerms: ["help center settings", "custom domain", "top nav", "analytics", "custom css"],
  },
  {
    id: "settings-channels",
    group: "settings-apps",
    searchTerms: ["channels", "email", "inbound email", "forwarding", "telegram", "slack", "handoff"],
  },
  {
    id: "settings-connected-apps",
    group: "settings-apps",
    searchTerms: ["mcp", "connected apps", "oauth", "claude", "cursor", "vs code"],
  },
  {
    id: "settings-project",
    group: "settings-workspace",
    searchTerms: ["project", "slug", "auto-close", "delete project"],
  },
  {
    id: "settings-team",
    group: "settings-workspace",
    searchTerms: ["team", "members", "invite"],
  },
  {
    id: "settings-billing",
    group: "settings-workspace",
    searchTerms: ["billing", "plan", "usage", "seats", "message packs"],
  },
  {
    id: "settings-profile",
    group: "settings-account",
    searchTerms: ["profile", "account", "email"],
  },
];

export const NAV_DESTINATION_IDS: readonly DashboardNavDestinationId[] =
  NAV_RECORDS.map((record) => record.id);

export const NAV_COMMAND_IDS: readonly DashboardNavCommandId[] =
  NAV_DESTINATION_IDS.map((id) => navCommandId(id));

export function navCommandId(
  destination: DashboardNavDestinationId,
): DashboardNavCommandId {
  return `navigate-${destination}`;
}

export function navSequenceKey(
  destination: DashboardNavDestinationId,
): string | undefined {
  return NAV_RECORDS.find((record) => record.id === destination)?.sequenceKey;
}

export function isInboxDestination(
  destination: DashboardNavDestinationId,
): destination is InboxFilter {
  return (INBOX_FILTER_IDS as readonly string[]).includes(destination);
}

function searchParamsFrom(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

export function destinationHref(
  projectId: string,
  destination: DashboardNavDestinationId,
): string {
  if (isInboxDestination(destination)) {
    return `/app/projects/${projectId}/conversations?filter=${destination}`;
  }
  return projectRoute(projectId, destination);
}

export function destinationLabel(destination: DashboardNavDestinationId): string {
  if (isInboxDestination(destination)) {
    return INBOX_FILTERS.find((filter) => filter.id === destination)?.title
      ?? destination;
  }
  return PROJECT_LABELS[destination];
}

function navSequence(secondKey: string): DashboardNavSequence {
  return {
    kind: "sequence",
    strokes: [{ key: "g" }, { key: secondKey }],
    timeoutMs: NAV_SEQUENCE_TIMEOUT_MS,
    keycap: { keys: ["G", secondKey.toUpperCase()] },
  };
}

function searchTermsFor(
  record: NavRecord,
  label: string,
): string[] {
  const terms = new Set<string>([label.toLowerCase(), ...record.searchTerms]);
  return [...terms];
}

function isNavActive(
  record: NavRecord,
  href: string,
  pathname: string,
  search: string,
): boolean {
  if (isInboxDestination(record.id)) {
    if (!pathname.includes("/conversations")) return false;
    const current = parseInboxFilter(searchParamsFrom(search).get("filter"))
      ?? "needs-you";
    return current === record.id;
  }
  const path = href.split("?")[0] ?? href;
  // Home page is a child path of Articles; keep only the deeper row lit.
  if (record.id === "help-center" && pathname.startsWith(`${path}/home`)) {
    return false;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isSettingsPath(pathname: string): boolean {
  return /^\/app\/projects\/[^/]+\/settings(\/|$)/.test(pathname);
}

export function dashboardNav(input: DashboardNavInput): DashboardNavItem[] {
  return NAV_RECORDS.map((record) => {
    const href = destinationHref(input.projectId, record.id);
    const label = destinationLabel(record.id);
    const item: DashboardNavItem = {
      id: record.id,
      group: record.group,
      label,
      href,
      active: isNavActive(record, href, input.pathname, input.search),
      searchTerms: searchTermsFor(record, label),
      navigationCommandId: navCommandId(record.id),
    };
    if (record.sequenceKey) item.sequence = navSequence(record.sequenceKey);
    if (isInboxDestination(record.id)) {
      item.count = input.counts?.[record.id] ?? 0;
    }
    return item;
  });
}

export function projectSwitchHref(
  pathname: string,
  search: string,
  fromProjectId: string,
  toProjectId: string,
): string {
  const prefix = `/app/projects/${fromProjectId}`;
  if (!pathname.startsWith(prefix)) {
    return `/app/projects/${toProjectId}`;
  }
  const nextPath = `/app/projects/${toProjectId}${pathname.slice(prefix.length)}`;
  const params = searchParamsFrom(search);
  params.delete("id");
  params.delete("msg");
  params.delete("focus");
  const query = params.toString();
  if (query === "") return nextPath;
  return `${nextPath}?${query}`;
}
