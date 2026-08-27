import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";

export interface HelpSearchArticle {
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content?: string | null;
}

export type HelpSearchMatchField = "title" | "excerpt" | "content";

export interface HelpSearchResult<T extends HelpSearchArticle = HelpArticleNav> {
  article: T;
  category: HelpCategoryRow;
  score: number | null;
  snippet: string | null;
  match: HelpSearchMatchField | null;
}

const SNIPPET_RADIUS = 80;

export function matchHelpArticlesFromQuery<T extends HelpSearchArticle>(
  query: string,
  articles: T[],
  categories: HelpCategoryRow[],
): HelpSearchResult<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const results: HelpSearchResult<T>[] = [];

  for (const article of articles) {
    const category = categoriesById.get(article.categoryId);
    if (!category) continue;

    const title = article.title.toLowerCase();
    const excerpt = (article.excerpt ?? "").toLowerCase();
    const content = (article.content ?? "").toLowerCase();
    let score = 0;
    if (title.includes(needle)) score += 3;
    if (excerpt.includes(needle)) score += 2;
    if (content.includes(needle)) score += 1.5;
    for (const token of tokens) {
      if (title.includes(token)) score += 1;
      if (excerpt.includes(token)) score += 0.5;
      if (content.includes(token)) score += 0.25;
    }
    if (score <= 0) continue;

    const match = resolveMatchField(title, excerpt, content, needle, tokens);
    results.push({
      article,
      category,
      score,
      match,
      snippet: buildSnippet(article, match, needle),
    });
  }

  results.sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.article.title.localeCompare(b.article.title);
  });
  return results;
}

function resolveMatchField(
  title: string,
  excerpt: string,
  content: string,
  needle: string,
  tokens: string[],
): HelpSearchMatchField | null {
  if (title.includes(needle) || tokens.some((token) => title.includes(token))) {
    return "title";
  }
  if (
    excerpt.includes(needle) ||
    tokens.some((token) => excerpt.includes(token))
  ) {
    return "excerpt";
  }
  if (
    content.includes(needle) ||
    tokens.some((token) => content.includes(token))
  ) {
    return "content";
  }
  return null;
}

function buildSnippet(
  article: HelpSearchArticle,
  match: HelpSearchMatchField | null,
  needle: string,
): string | null {
  if (match === "content") {
    return snippetAround(article.content ?? "", needle);
  }
  if (match === "excerpt") return article.excerpt;
  if (match === "title") return article.title;
  return null;
}

export function snippetAround(text: string, needle: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let index = lower.indexOf(needle);
  let length = needle.length;
  if (index < 0) {
    const tokens = needle.split(/\s+/).filter((token) => token.length >= 2);
    for (const token of tokens) {
      index = lower.indexOf(token);
      if (index >= 0) {
        length = token.length;
        break;
      }
    }
  }
  if (index < 0) return null;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}
