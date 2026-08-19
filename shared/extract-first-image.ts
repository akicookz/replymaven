export interface FirstImage {
  url: string;
  alt: string;
}

/**
 * Find the first image referenced in a markdown body. Returns null if none.
 *
 * Handles both forms emitted by the editor:
 *   - `![alt](url)`
 *   - `<img src="url" alt="alt" ...>` (used when the image has a width).
 *
 * URLs that aren't `http(s)`, `/`-rooted, or `data:image/` are rejected as
 * unsafe for use as og:image — they'd 404 or worse when scraped by social
 * crawlers.
 */
export function extractFirstImage(markdown: string): FirstImage | null {
  if (!markdown) return null;

  const candidates: Array<{ idx: number; url: string; alt: string }> = [];

  const mdRe = /!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(markdown)) !== null) {
    candidates.push({ idx: m.index, alt: m[1] ?? "", url: m[2] });
  }

  const htmlRe = /<img\b[^>]*>/gi;
  while ((m = htmlRe.exec(markdown)) !== null) {
    const tag = m[0];
    const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!srcMatch) continue;
    const altMatch = /\balt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    candidates.push({
      idx: m.index,
      url: srcMatch[2] ?? srcMatch[3] ?? "",
      alt: altMatch ? (altMatch[2] ?? altMatch[3] ?? "") : "",
    });
  }

  candidates.sort((a, b) => a.idx - b.idx);
  for (const c of candidates) {
    if (isSafeImageUrl(c.url)) {
      return { url: c.url, alt: c.alt };
    }
  }
  return null;
}

function isSafeImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (/^https?:\/\//i.test(u)) return true;
  if (u.startsWith("/")) return true;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(u)) return true;
  return false;
}
