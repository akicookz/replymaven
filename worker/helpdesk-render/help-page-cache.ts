import { logError, logWarn } from "../observability";

export const HELP_PAGE_CACHE_TAG_PREFIX = "help-";

interface CachePurgeResult {
  success: boolean;
  errors?: unknown;
}

interface CachePurgeApi {
  purge: (options: { tags: string[] }) => Promise<CachePurgeResult | unknown>;
}

interface HelpPagesExport {
  fetch: (request: Request) => Response | Promise<Response>;
  invalidate?: (projectId: string) => void | Promise<void>;
}

interface ExecutionContextWithCache extends ExecutionContext {
  cache?: CachePurgeApi;
  exports?: {
    HelpPages?: HelpPagesExport;
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

export const HELP_PROXY_VARY = "X-ReplyMaven-Help-Proxy, X-ReplyMaven-Own-Docs";

export function helpHtmlHeaders(
  projectId: string,
  options: { noindex: boolean },
): Record<string, string> {
  return {
    ...helpPageCacheHeaders(projectId),
    Vary: HELP_PROXY_VARY,
    ...(options.noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  };
}

export function helpSearchHeaders(options: { noindex: boolean }): Record<string, string> {
  return {
    ...helpUncachedHeaders(),
    Vary: HELP_PROXY_VARY,
    ...(options.noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  };
}

export function helpSearchAnswerHeaders(options: { noindex: boolean }): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: HELP_PROXY_VARY,
    ...(options.noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  };
}

export function publicHelpHtmlChanged(input: {
  beforeStatus?: "draft" | "published" | null;
  afterStatus?: "draft" | "published" | null;
}): boolean {
  return (
    input.beforeStatus === "published" || input.afterStatus === "published"
  );
}

export function invalidateHelpPageCache(
  ctx: ExecutionContext,
  projectId: string,
): Promise<void> {
  const cache = (ctx as ExecutionContextWithCache).cache;
  if (!cache || typeof cache.purge !== "function") {
    logWarn("help.cache_purge_skipped", {
      projectId,
      reason: "cache_api_missing",
    });
    return Promise.resolve();
  }
  return cache
    .purge({ tags: [helpPageCacheTag(projectId)] })
    .then((result) => {
      if (isSuccessfulCachePurge(result)) return;
      logError(
        "help.cache_purge_failed",
        new Error("Cache purge rejected"),
        {
          projectId,
          errors: cachePurgeErrors(result),
        },
      );
    })
    .catch((error: unknown) => {
      logError("help.cache_purge_failed", error, { projectId });
    });
}

function isSuccessfulCachePurge(result: unknown): result is CachePurgeResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "success" in result &&
    (result as CachePurgeResult).success === true
  );
}

function cachePurgeErrors(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  if ("errors" in result) return (result as CachePurgeResult).errors;
  return result;
}

export function scheduleHelpPageCachePurge(
  ctx: ExecutionContext,
  projectId: string,
): void {
  const helpPages = (ctx as ExecutionContextWithCache).exports?.HelpPages;
  if (!helpPages || typeof helpPages.invalidate !== "function") {
    logWarn("help.cache_purge_skipped", {
      projectId,
      reason: "helppages_export_missing",
    });
    return;
  }
  ctx.waitUntil(
    Promise.resolve(helpPages.invalidate(projectId)).catch((error: unknown) => {
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
