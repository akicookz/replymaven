import { parsePopularArticleIds } from "../../shared/help-home-markdown";
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
  publishedArticles: PopularArticleEntry[];
}

const BLOCK_RE =
  /<div\b[^>]*\bdata-help-block="(search|categories|popular)"[^>]*>\s*<\/div>/gi;

function articleIdsFromTag(tag: string): string[] {
  const match = /\bdata-article-ids="([^"]*)"/i.exec(tag);
  return parsePopularArticleIds(match?.[1]);
}

function pickPopularArticles(
  tag: string,
  published: PopularArticleEntry[],
): PopularArticleEntry[] {
  const ids = articleIdsFromTag(tag);
  if (ids.length === 0) return [];
  const byId = new Map(
    published.map((entry) => [entry.article.id.toLowerCase(), entry]),
  );
  const picked: PopularArticleEntry[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry) picked.push(entry);
  }
  return picked;
}

export function expandHelpHomeBlocks(
  html: string,
  ctx: ExpandHelpHomeBlocksContext,
): string {
  return html.replace(BLOCK_RE, (tag, kind: string) => {
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
        popularArticles: pickPopularArticles(tag, ctx.publishedArticles),
      })?.toString() ?? ""
    );
  });
}

export type { CategoryWithCount, PopularArticleEntry };
