interface TabRef {
  id: string;
}

interface CategoryTabRef {
  tabId: string | null;
}

/** Same rule as the public site: a category with no tab, or a deleted one, belongs to the first tab. */
export function resolveCategoryTabId(
  category: CategoryTabRef,
  tabs: TabRef[],
): string | null {
  if (category.tabId && tabs.some((tab) => tab.id === category.tabId)) {
    return category.tabId;
  }
  return tabs[0]?.id ?? null;
}
