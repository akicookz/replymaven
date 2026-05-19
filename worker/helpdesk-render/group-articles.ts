import type { HelpArticleRow } from "../db/schema";

export function groupArticlesByCategory(
  articles: HelpArticleRow[],
): Map<string, HelpArticleRow[]> {
  const map = new Map<string, HelpArticleRow[]>();
  for (const article of articles) {
    const list = map.get(article.categoryId);
    if (list) {
      list.push(article);
    } else {
      map.set(article.categoryId, [article]);
    }
  }
  return map;
}
