export function groupArticlesByCategory<T extends { categoryId: string }>(
  articles: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
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
