import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";

export interface HelpSearchResult {
  article: HelpArticleNav;
  category: HelpCategoryRow;
  score: number | null;
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
