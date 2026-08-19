const BLOCKED_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "file:"]);

/**
 * Turn a prompt value into an http(s) href, or null if it should not be
 * inserted. Bare hosts get https://.
 */
export function normalizeLinkHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "https://" || trimmed === "http://") return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "mailto:") {
    return null;
  }
  if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.hostname) {
    return null;
  }
  return parsed.href;
}

export function linkLabelFromHref(href: string): string {
  try {
    const parsed = new URL(href);
    if (parsed.protocol === "mailto:") {
      return parsed.pathname || href;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    return host || href;
  } catch {
    return href;
  }
}
