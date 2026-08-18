import type {
  HelpArticleRow,
  HelpCategoryRow,
} from "../db/schema";
import {
  HelpCategoryGrid,
  HelpPopularArticles,
  HelpSearchForm,
  type CategoryWithCount,
  type PopularArticleEntry,
} from "./help-home-widgets";

export interface ExpandHelpHomeBlocksContext {
  projectSlug: string;
  customUrl: string | null;
  searchAction: string;
  categories: CategoryWithCount[];
  popularArticles: PopularArticleEntry[];
}

const BLOCK_RE =
  /<div\b[^>]*\bdata-help-block="(search|categories|popular)"[^>]*>\s*<\/div>/gi;

export function expandHelpHomeBlocks(
  html: string,
  ctx: ExpandHelpHomeBlocksContext,
): string {
  return html.replace(BLOCK_RE, (_match, kind: string) => {
    if (kind === "search") {
      return HelpSearchForm({ action: ctx.searchAction }).toString();
    }
    if (kind === "categories") {
      return HelpCategoryGrid({
        projectSlug: ctx.projectSlug,
        customUrl: ctx.customUrl,
        categories: ctx.categories,
      }).toString();
    }
    return (
      HelpPopularArticles({
        projectSlug: ctx.projectSlug,
        customUrl: ctx.customUrl,
        popularArticles: ctx.popularArticles,
      })?.toString() ?? ""
    );
  });
}

export type { HelpArticleRow, HelpCategoryRow, CategoryWithCount, PopularArticleEntry };
