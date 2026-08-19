/** Default help-center home body. Used when `help_home_markdown` is null. */
export function defaultHelpHomeMarkdown(projectName: string): string {
  const name = projectName.replace(/[\n\r]+/g, " ").trim() || "this product";
  return `# How can we help?

Browse help articles and guides for ${name}.

::help-search
::help-categories
::help-popular
`;
}

export const MAX_POPULAR_ARTICLES = 10;

const ARTICLE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HELP_HOME_BLOCK_LINE_RE =
  /^::help-(search|categories|popular)(?:\[([^\]]*)\])?[ \t]*\r?$/;

export function parsePopularArticleIds(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!ARTICLE_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_POPULAR_ARTICLES) break;
  }
  return ids;
}

export function parseHelpHomeBlockLine(line: string): {
  kind: "search" | "categories" | "popular";
  articleIds: string[];
} | null {
  const match = HELP_HOME_BLOCK_LINE_RE.exec(line);
  if (!match) return null;
  const kind = match[1] as "search" | "categories" | "popular";
  return {
    kind,
    articleIds:
      kind === "popular" ? parsePopularArticleIds(match[2]) : [],
  };
}

export function serializeHelpHomeBlock(
  kind: "search" | "categories" | "popular",
  articleIds: string[] = [],
): string {
  if (kind !== "popular") return `::help-${kind}`;
  const ids = parsePopularArticleIds(articleIds.join(","));
  if (ids.length === 0) return "::help-popular";
  return `::help-popular[${ids.join(",")}]`;
}
