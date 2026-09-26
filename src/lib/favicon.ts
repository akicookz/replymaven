const FAVICON_URL =
  /^https:\/\/www\.google\.com\/s2\/favicons\?domain=([a-z0-9.-]+)&sz=\d+$/u;

// The domain inside a Google favicon URL sent for a custom connector.
export function faviconDomainFromUrl(url: string | null | undefined): string | null {
  return url?.match(FAVICON_URL)?.[1] ?? null;
}
