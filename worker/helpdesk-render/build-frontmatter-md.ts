import type { HelpArticleRow, HelpCategoryRow } from "../db/schema";

const YAML_SPECIAL = /[:#\n"'`{}[\],&*!|>%@\\]|^\s|\s$|^$/;

function yamlString(value: string): string {
  if (!YAML_SPECIAL.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

/**
 * Build a portable .md file (YAML frontmatter + body markdown) for an article.
 *
 * Stored in R2 and indexed by AutoRAG; also suitable for export/download. The
 * DB stays the source of truth — frontmatter is synthesized here from columns
 * and never parsed back.
 */
export function buildFrontmatterMarkdown(
  article: HelpArticleRow,
  category: HelpCategoryRow,
): string {
  const fields: Array<[string, string]> = [];
  fields.push(["title", yamlString(article.title)]);
  fields.push(["slug", yamlString(article.slug)]);
  if (article.excerpt && article.excerpt.trim()) {
    fields.push(["excerpt", yamlString(article.excerpt.trim())]);
  }
  fields.push(["status", article.status]);
  const published = isoDate(article.publishedAt);
  if (published) fields.push(["publishedAt", published]);
  const updated = isoDate(article.updatedAt);
  if (updated) fields.push(["updatedAt", updated]);
  fields.push(["category", yamlString(category.slug)]);

  const frontmatter = fields.map(([k, v]) => `${k}: ${v}`).join("\n");
  const body = article.content ?? "";
  return `---\n${frontmatter}\n---\n\n${body}`;
}
