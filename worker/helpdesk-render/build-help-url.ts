const CANONICAL_BASE = "https://replymaven.com";

export interface BuildHelpUrlInput {
  projectSlug: string;
  customUrl: string | null | undefined;
  category?: string;
  article?: string;
}

export function buildHelpUrl(input: BuildHelpUrlInput): string {
  if (input.article && !input.category) {
    throw new Error("Cannot build help URL with article but no category");
  }

  const base = input.customUrl
    ? normalizeHelpCustomUrl(input.customUrl)
    : `${CANONICAL_BASE}/help/${input.projectSlug}`;

  const segments: string[] = [];
  if (input.category) segments.push(input.category);
  if (input.article) segments.push(input.article);

  return segments.length === 0 ? base : `${base}/${segments.join("/")}`;
}

export function buildHelpSitemapUrl(input: {
  projectSlug: string;
  customUrl: string | null | undefined;
}): string {
  const base = input.customUrl
    ? normalizeHelpCustomUrl(input.customUrl)
    : `${CANONICAL_BASE}/help/${input.projectSlug}`;
  return `${base}/sitemap.xml`;
}

export function buildHelpRobotsUrl(input: {
  projectSlug: string;
  customUrl: string | null | undefined;
}): string {
  const base = input.customUrl
    ? normalizeHelpCustomUrl(input.customUrl)
    : `${CANONICAL_BASE}/help/${input.projectSlug}`;
  return `${base}/robots.txt`;
}

export function normalizeHelpCustomUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.replace(/\/+$/, "");
  const result = `${url.protocol}//${url.host}${pathname}`;
  return result;
}

export function rewriteHelpUrlIfNeeded(
  storedUrl: string,
  projectSlug: string,
  customUrl: string | null | undefined,
): string {
  if (!customUrl) return storedUrl;
  const canonicalBase = `${CANONICAL_BASE}/help/${projectSlug}`;
  if (storedUrl !== canonicalBase && !storedUrl.startsWith(`${canonicalBase}/`)) {
    return storedUrl;
  }
  const suffix = storedUrl.slice(canonicalBase.length);
  return `${normalizeHelpCustomUrl(customUrl)}${suffix}`;
}
