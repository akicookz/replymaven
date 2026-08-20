import { logError } from "../observability";

export const HELP_PAGE_CACHE_TAG_PREFIX = "help-";

interface CachePurgeApi {
  purge: (options: { tags: string[] }) => Promise<unknown>;
}

interface ExecutionContextWithCache extends ExecutionContext {
  cache?: CachePurgeApi;
  exports?: {
    HelpPages?: {
      fetch: (request: Request) => Response | Promise<Response>;
    };
  };
}

export function isPublicHelpPath(pathname: string): boolean {
  return (
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    pathname.startsWith("/help/")
  );
}

export function helpPageCacheTag(projectId: string): string {
  return `${HELP_PAGE_CACHE_TAG_PREFIX}${projectId}`;
}

export function helpPageCacheHeaders(
  projectId: string,
): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=60",
    "cloudflare-cdn-cache-control":
      "max-age=3600, stale-while-revalidate=86400",
    "Cache-Tag": helpPageCacheTag(projectId),
  };
}

export function helpSitemapCacheHeaders(
  projectId: string,
): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=60",
    "cloudflare-cdn-cache-control":
      "max-age=3600, stale-while-revalidate=86400",
    "Cache-Tag": helpPageCacheTag(projectId),
  };
}

export function helpNotFoundCacheHeaders(
  projectId?: string,
): Record<string, string> {
  return {
    "Cache-Control": "public, max-age=30",
    "cloudflare-cdn-cache-control": "max-age=60",
    ...(projectId ? { "Cache-Tag": helpPageCacheTag(projectId) } : {}),
  };
}

export function helpUncachedHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

export function publicHelpHtmlChanged(input: {
  beforeStatus?: "draft" | "published" | null;
  afterStatus?: "draft" | "published" | null;
}): boolean {
  return (
    input.beforeStatus === "published" || input.afterStatus === "published"
  );
}

export function scheduleHelpPageCachePurge(
  ctx: ExecutionContext,
  projectId: string,
): void {
  const cache = (ctx as ExecutionContextWithCache).cache;
  if (!cache || typeof cache.purge !== "function") return;
  ctx.waitUntil(
    cache.purge({ tags: [helpPageCacheTag(projectId)] }).catch((error: unknown) => {
      logError("help.cache_purge_failed", error, { projectId });
    }),
  );
}

export function dispatchPublicHelp<E>(
  request: Request,
  env: E,
  ctx: ExecutionContext,
  fetchApp: (
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>,
): Response | Promise<Response> {
  const helpPages = (ctx as ExecutionContextWithCache).exports?.HelpPages;
  if (helpPages) return helpPages.fetch(request);
  return fetchApp(request, env, ctx);
}
