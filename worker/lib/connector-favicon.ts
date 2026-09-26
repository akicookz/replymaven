// ─── Tool icons ───────────────────────────────────────────────────────────────

export const NATIVE_TOOL_ICON = "/integrations/replymaven.svg";

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Custom connectors show their site's favicon; the dashboard's <Favicon>
// loads it and falls back to parent domains, then a letter.
export function connectorFaviconUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOSTNAME.test(host)
      ? `https://www.google.com/s2/favicons?domain=${host}&sz=64`
      : null;
  } catch {
    return null;
  }
}
