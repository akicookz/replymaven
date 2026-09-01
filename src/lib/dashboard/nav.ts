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
  | "inbox"
  | "knowledgebase"
  | "support-chat"
  | "workspace";

export type DashboardNavIcon =
  | "layout-dashboard"
  | "hand"
  | "inbox"
  | "clock"
  | "check-circle"
  | "archive"
  | "flag"
  | "database"
  | "book-open"
  | "list-checks"
  | "building-2"
  | "message-square"
  | "messages-square"
  | "wrench"
  | "users"
  | "plug"
  | "settings";

export type DashboardNavCommandId =
  | "navigate-dashboard"
  | "navigate-needs-you"
  | "navigate-inbox"
  | "navigate-snoozed"
  | "navigate-resolved"
  | "navigate-archived"
  | "navigate-flagged"
  | "navigate-sources"
  | "navigate-help-center"
  | "navigate-sops"
  | "navigate-company-info"
  | "navigate-chat-widget"
  | "navigate-greetings"
  | "navigate-tools"
  | "navigate-customers"
  | "navigate-mcp-connections"
  | "navigate-settings";

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
  icon: DashboardNavIcon;
  active: boolean;
  count?: number;
  searchTerms: string[];
  navigationCommandId: DashboardNavCommandId;
  sequence: DashboardNavSequence;
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
  icon: DashboardNavIcon;
  searchTerms: string[];
  navigationCommandId: DashboardNavCommandId;
  sequenceKey: string;
}

const PROJECT_LABELS: Record<ProjectDestination, string> = {
  dashboard: "Dashboard",
  sources: "Sources",
  "help-center": "Help Center",
  sops: "SOPs",
  "company-info": "Company info",
  "chat-widget": "Chat Widget",
  greetings: "Greetings",
  tools: "Tools",
  customers: "Customers",
  "mcp-connections": "MCP Connections",
  settings: "Settings",
};

const NAV_RECORDS: NavRecord[] = [
  {
    id: "needs-you",
    group: "inbox",
    icon: "hand",
    searchTerms: ["needs you", "review", "waiting", "handoff"],
    navigationCommandId: "navigate-needs-you",
    sequenceKey: "y",
  },
  {
    id: "inbox",
    group: "inbox",
    icon: "inbox",
    searchTerms: ["inbox", "all conversations", "open"],
    navigationCommandId: "navigate-inbox",
    sequenceKey: "i",
  },
  {
    id: "snoozed",
    group: "inbox",
    icon: "clock",
    searchTerms: ["snoozed", "later"],
    navigationCommandId: "navigate-snoozed",
    sequenceKey: "z",
  },
  {
    id: "resolved",
    group: "inbox",
    icon: "check-circle",
    searchTerms: ["resolved", "closed", "done"],
    navigationCommandId: "navigate-resolved",
    sequenceKey: "r",
  },
  {
    id: "archived",
    group: "inbox",
    icon: "archive",
    searchTerms: ["archived"],
    navigationCommandId: "navigate-archived",
    sequenceKey: "a",
  },
  {
    id: "flagged",
    group: "inbox",
    icon: "flag",
    searchTerms: ["flagged", "spam"],
    navigationCommandId: "navigate-flagged",
    sequenceKey: "f",
  },
  {
    id: "sources",
    group: "knowledgebase",
    icon: "database",
    searchTerms: ["sources", "knowledge", "resources"],
    navigationCommandId: "navigate-sources",
    sequenceKey: "s",
  },
  {
    id: "help-center",
    group: "knowledgebase",
    icon: "book-open",
    searchTerms: ["help center", "docs", "articles"],
    navigationCommandId: "navigate-help-center",
    sequenceKey: "h",
  },
  {
    id: "sops",
    group: "knowledgebase",
    icon: "list-checks",
    searchTerms: ["sops", "guidelines", "procedures"],
    navigationCommandId: "navigate-sops",
    sequenceKey: "o",
  },
  {
    id: "company-info",
    group: "knowledgebase",
    icon: "building-2",
    searchTerms: ["company info", "company", "general"],
    navigationCommandId: "navigate-company-info",
    sequenceKey: "c",
  },
  {
    id: "chat-widget",
    group: "support-chat",
    icon: "message-square",
    searchTerms: ["chat widget", "widget", "appearance"],
    navigationCommandId: "navigate-chat-widget",
    sequenceKey: "w",
  },
  {
    id: "greetings",
    group: "support-chat",
    icon: "messages-square",
    searchTerms: ["greetings", "intro", "welcome"],
    navigationCommandId: "navigate-greetings",
    sequenceKey: "g",
  },
  {
    id: "tools",
    group: "support-chat",
    icon: "wrench",
    searchTerms: ["tools", "integrations"],
    navigationCommandId: "navigate-tools",
    sequenceKey: "t",
  },
  {
    id: "dashboard",
    group: "workspace",
    icon: "layout-dashboard",
    searchTerms: ["dashboard", "home", "overview"],
    navigationCommandId: "navigate-dashboard",
    sequenceKey: "d",
  },
  {
    id: "customers",
    group: "workspace",
    icon: "users",
    searchTerms: ["customers", "people"],
    navigationCommandId: "navigate-customers",
    sequenceKey: "u",
  },
  {
    id: "mcp-connections",
    group: "workspace",
    icon: "plug",
    searchTerms: ["mcp connections", "mcp"],
    navigationCommandId: "navigate-mcp-connections",
    sequenceKey: "m",
  },
  {
    id: "settings",
    group: "workspace",
    icon: "settings",
    searchTerms: ["settings", "preferences", "account"],
    navigationCommandId: "navigate-settings",
    sequenceKey: "p",
  },
];

function isInboxDestination(
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
  if (record.id === "dashboard") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
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
      icon: record.icon,
      active: isNavActive(record, href, input.pathname, input.search),
      searchTerms: searchTermsFor(record, label),
      navigationCommandId: record.navigationCommandId,
      sequence: navSequence(record.sequenceKey),
    };
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
    return projectRoute(toProjectId, "dashboard");
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
