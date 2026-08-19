import { extractFirstImage } from "../../shared/extract-first-image";

export const HELP_ARTICLE_EXCERPT_MAX = 280;

export interface HelpArticleSeoInput {
  excerpt?: string | null;
  ogImageUrl?: string | null;
  content: string;
}

export interface HelpArticleSeoDefaults {
  excerpt: string | null;
  ogImageUrl: string | null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * First non-empty text line in the body, skipping headings, images, and rules.
 * Used as the description when none was provided at save time.
 */
export function firstHelpArticleTextLine(markdown: string): string {
  if (!markdown) return "";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^[=-]{3,}$/.test(line)) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;
    if (/^!\[/.test(line)) continue;
    if (/^<img\b/i.test(line)) continue;
    if (/^```/.test(line)) continue;
    const text = line
      .replace(/^>\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * Fill empty SEO fields from the article body. Call at create/update, not
 * at render: once stored, later image edits do not rewrite the OG image.
 */
export function applyHelpArticleSeoDefaults(
  input: HelpArticleSeoInput,
): HelpArticleSeoDefaults {
  let excerpt = trimmedOrNull(input.excerpt);
  let ogImageUrl = trimmedOrNull(input.ogImageUrl);

  if (!excerpt) {
    const line = firstHelpArticleTextLine(input.content);
    excerpt = line ? line.slice(0, HELP_ARTICLE_EXCERPT_MAX) : null;
  }
  if (!ogImageUrl) {
    ogImageUrl = extractFirstImage(input.content)?.url ?? null;
  }

  return { excerpt, ogImageUrl };
}
