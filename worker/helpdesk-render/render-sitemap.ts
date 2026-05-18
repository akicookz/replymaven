import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
} from "../db/schema";
import { buildHelpUrl } from "./build-help-url";

interface RenderSitemapInput {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  articles: HelpArticleRow[];
  helpCustomUrl: string | null;
}

export function renderSitemap(input: RenderSitemapInput): string {
  const urls: Array<{ loc: string; lastmod?: string }> = [];

  urls.push({
    loc: buildHelpUrl({
      projectSlug: input.project.slug,
      customUrl: input.helpCustomUrl,
    }),
  });

  const categoryBySlug = new Map(input.categories.map((c) => [c.id, c]));

  for (const category of input.categories) {
    urls.push({
      loc: buildHelpUrl({
        projectSlug: input.project.slug,
        customUrl: input.helpCustomUrl,
        category: category.slug,
      }),
      lastmod: toIso(category.updatedAt),
    });
  }

  for (const article of input.articles) {
    if (article.status !== "published") continue;
    const category = categoryBySlug.get(article.categoryId);
    if (!category) continue;
    urls.push({
      loc: buildHelpUrl({
        projectSlug: input.project.slug,
        customUrl: input.helpCustomUrl,
        category: category.slug,
        article: article.slug,
      }),
      lastmod: toIso(article.updatedAt),
    });
  }

  const entries = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : "";
      return `  <url><loc>${escapeXml(u.loc)}</loc>${lastmod}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

function toIso(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : undefined;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
