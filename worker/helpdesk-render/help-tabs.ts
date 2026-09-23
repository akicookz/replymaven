import type { HelpCategoryRow, HelpTabRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import { buildHelpUrl } from "./build-help-url";

export interface HelpTabLink {
  id: string;
  name: string;
  href: string;
}

export interface HelpTabContext {
  /** Tabs for the top bar and drawer. Empty unless two or more are visible. */
  links: HelpTabLink[];
  /** First visible tab. Home and search belong to it. */
  homeTabId: string | null;
  tabIdForCategory: (category: HelpCategoryRow) => string | null;
  /** Navigable categories of one tab (with a published article), in sidebar order. */
  categoriesForTab: (tabId: string | null) => HelpCategoryRow[];
  tabName: (tabId: string | null) => string | null;
}

interface ResolveHelpTabsInput {
  tabs: HelpTabRow[];
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  projectSlug: string;
  customUrl: string | null;
}

// A tab is visible once one of its categories has a published article; it
// links to that category's first article, except the home tab, which links home.
export function resolveHelpTabs(input: ResolveHelpTabsInput): HelpTabContext {
  const { tabs } = input;
  // Reader navigation never lands on a category page, so empty categories stay out of it.
  const categories = input.categories.filter(
    (category) => (input.articlesByCategory.get(category.id)?.length ?? 0) > 0,
  );
  if (tabs.length === 0) {
    return {
      links: [],
      homeTabId: null,
      tabIdForCategory: () => null,
      categoriesForTab: () => categories,
      tabName: () => null,
    };
  }

  const tabIds = new Set(tabs.map((tab) => tab.id));
  const firstTabId = tabs[0]!.id;
  const tabIdForCategory = (category: HelpCategoryRow): string =>
    category.tabId && tabIds.has(category.tabId) ? category.tabId : firstTabId;

  const categoriesByTab = new Map<string, HelpCategoryRow[]>();
  for (const category of categories) {
    const tabId = tabIdForCategory(category);
    const list = categoriesByTab.get(tabId);
    if (list) list.push(category);
    else categoriesByTab.set(tabId, [category]);
  }

  const visible = tabs.flatMap((tab) => {
    const landing = categoriesByTab.get(tab.id)?.[0];
    return landing ? [{ tab, landing }] : [];
  });
  const homeTabId = visible[0]?.tab.id ?? firstTabId;

  const links =
    visible.length < 2
      ? []
      : visible.map(({ tab, landing }) => ({
          id: tab.id,
          name: tab.name,
          href:
            tab.id === homeTabId
              ? buildHelpUrl({
                  projectSlug: input.projectSlug,
                  customUrl: input.customUrl,
                })
              : buildHelpUrl({
                  projectSlug: input.projectSlug,
                  customUrl: input.customUrl,
                  category: landing.slug,
                  article: input.articlesByCategory.get(landing.id)?.[0]?.slug,
                }),
        }));

  const namesById = new Map(tabs.map((tab) => [tab.id, tab.name]));
  return {
    links,
    homeTabId,
    tabIdForCategory,
    categoriesForTab: (tabId) =>
      tabId ? (categoriesByTab.get(tabId) ?? []) : categories,
    tabName: (tabId) => (tabId ? (namesById.get(tabId) ?? null) : null),
  };
}

/** What the top bar and drawer need to draw the tabs and the Ask button. */
export interface HelpNav {
  tabs: HelpTabLink[];
  activeTabId: string | null;
  botName: string | null;
}

export function buildHelpNav(
  tabContext: HelpTabContext,
  activeTabId: string | null,
  botName: string | null | undefined,
): HelpNav {
  return {
    tabs: tabContext.links,
    activeTabId,
    botName: botName?.trim() || null,
  };
}
