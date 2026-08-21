import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import { buildHelpUrl } from "./build-help-url";

export interface HelpSearchResult {
  article: HelpArticleNav;
  category: HelpCategoryRow;
  score: number | null;
}

export interface HelpSearchResultCard {
  id: string;
  title: string;
  excerpt: string | null;
  href: string;
  breadcrumb: string;
}

export function helpArticlesFolderFilter(projectId: string): {
  $gte: string;
  $lt: string;
} {
  return {
    $gte: `${projectId}/articles/`,
    $lt: `${projectId}/articles0`,
  };
}

export function matchHelpArticlesFromQuery(
  query: string,
  articles: HelpArticleNav[],
  categories: HelpCategoryRow[],
): HelpSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const results: HelpSearchResult[] = [];

  for (const article of articles) {
    const category = categoriesById.get(article.categoryId);
    if (!category) continue;

    const title = article.title.toLowerCase();
    const excerpt = (article.excerpt ?? "").toLowerCase();
    let score = 0;
    if (title.includes(needle)) score += 3;
    if (excerpt.includes(needle)) score += 2;
    for (const token of tokens) {
      if (title.includes(token)) score += 1;
      if (excerpt.includes(token)) score += 0.5;
    }
    if (score <= 0) continue;
    results.push({ article, category, score });
  }

  results.sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.article.title.localeCompare(b.article.title);
  });
  return results;
}

export function resolveHelpSearchResults(
  response: unknown,
  articles: HelpArticleNav[],
  categories: HelpCategoryRow[],
  projectId: string,
): HelpSearchResult[] {
  const filenames = collectFilenames(response);
  if (filenames.length === 0) return [];

  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const prefix = `${projectId}/articles/`;
  const bestByArticleId = new Map<
    string,
    { article: HelpArticleNav; score: number | null }
  >();

  for (const { filename, score } of filenames) {
    if (!filename.startsWith(prefix)) continue;
    const tail = filename.slice(prefix.length);
    const articleId = tail.endsWith(".md") ? tail.slice(0, -3) : tail;
    const article = articlesById.get(articleId);
    if (!article) continue;
    const existing = bestByArticleId.get(articleId);
    if (!existing) {
      bestByArticleId.set(articleId, { article, score });
    } else if (
      score !== null &&
      (existing.score === null || score > existing.score)
    ) {
      bestByArticleId.set(articleId, { article, score });
    }
  }

  const results: HelpSearchResult[] = [];
  for (const { article, score } of bestByArticleId.values()) {
    const category = categoriesById.get(article.categoryId);
    if (!category) continue;
    results.push({ article, category, score });
  }
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return results;
}

export function toHelpSearchResultCards(
  results: HelpSearchResult[],
  projectSlug: string,
  customUrl: string | null,
): HelpSearchResultCard[] {
  return results.map((result) => ({
    id: result.article.id,
    title: result.article.title,
    excerpt: result.article.excerpt ?? null,
    href: buildHelpUrl({
      projectSlug,
      customUrl,
      category: result.category.slug,
      article: result.article.slug,
    }),
    breadcrumb: result.category.name,
  }));
}

function collectFilenames(
  response: unknown,
): Array<{ filename: string; score: number | null }> {
  if (Array.isArray(response)) {
    return filenamesFromArray(response);
  }
  if (typeof response !== "object" || response === null) return [];

  const record = response as Record<string, unknown>;
  const result =
    typeof record.result === "object" && record.result !== null
      ? (record.result as Record<string, unknown>)
      : null;

  if (result && Array.isArray(result.chunks)) {
    return filenamesFromArray(result.chunks);
  }
  if (Array.isArray(record.chunks)) {
    return filenamesFromArray(record.chunks);
  }
  if (Array.isArray(record.data)) {
    return filenamesFromArray(record.data);
  }
  return [];
}

function filenamesFromArray(
  entries: unknown[],
): Array<{ filename: string; score: number | null }> {
  const filenames: Array<{ filename: string; score: number | null }> = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const item =
      typeof record.item === "object" && record.item !== null
        ? (record.item as Record<string, unknown>)
        : null;
    let filename: string | null = null;
    if (typeof record.filename === "string") {
      filename = record.filename;
    } else if (typeof item?.key === "string") {
      filename = item.key;
    }
    if (!filename) continue;
    const score = typeof record.score === "number" ? record.score : null;
    filenames.push({ filename, score });
  }
  return filenames;
}
