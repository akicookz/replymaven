import { describe, expect, test } from "bun:test";
import {
  dispatchPublicHelp,
  helpHtmlHeaders,
  helpPageCacheHeaders,
  helpPageCacheTag,
  helpSearchAnswerHeaders,
  helpSearchHeaders,
  helpUncachedHeaders,
  invalidateHelpPageCache,
  isPublicHelpPath,
  publicHelpHtmlChanged,
  scheduleHelpPageCachePurge,
} from "./help-page-cache";

describe("isPublicHelpPath", () => {
  test("matches help and docs paths only", () => {
    expect(isPublicHelpPath("/help/acme")).toBe(true);
    expect(isPublicHelpPath("/help/acme/guides/install")).toBe(true);
    expect(isPublicHelpPath("/docs")).toBe(true);
    expect(isPublicHelpPath("/docs/search")).toBe(true);
    expect(isPublicHelpPath("/docs/search/answer")).toBe(true);
    expect(isPublicHelpPath("/helpful")).toBe(false);
    expect(isPublicHelpPath("/api/help/acme")).toBe(false);
    expect(isPublicHelpPath("/app/projects/1/help")).toBe(false);
  });
});

describe("help page cache headers", () => {
  test("tags responses by project and keeps search uncached", () => {
    const headers = helpPageCacheHeaders("proj-1");
    expect(headers["Cache-Tag"]).toBe(helpPageCacheTag("proj-1"));
    expect(headers["Cache-Control"]).toContain("max-age=60");
    expect(headers["cloudflare-cdn-cache-control"]).toContain("max-age=3600");
    expect(headers["cloudflare-cdn-cache-control"]).toContain(
      "stale-while-revalidate=86400",
    );
    expect(helpUncachedHeaders()).toEqual({ "Cache-Control": "no-store" });
  });

  test("marks hosted HTML noindex and varies on the proxy header", () => {
    const headers = helpHtmlHeaders("proj-1", { noindex: true });
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headers.Vary).toContain("X-ReplyMaven-Help-Proxy");
    expect(helpHtmlHeaders("proj-1", { noindex: false })["X-Robots-Tag"]).toBeUndefined();
    expect(helpSearchHeaders({ noindex: true })["X-Robots-Tag"]).toBe(
      "noindex, nofollow",
    );
    expect(helpSearchAnswerHeaders({ noindex: true })["Content-Type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
  });
});

describe("publicHelpHtmlChanged", () => {
  test("ignores draft-only writes", () => {
    expect(
      publicHelpHtmlChanged({ beforeStatus: "draft", afterStatus: "draft" }),
    ).toBe(false);
    expect(publicHelpHtmlChanged({ afterStatus: "draft" })).toBe(false);
  });

  test("flags publish, unpublish, and live edits", () => {
    expect(publicHelpHtmlChanged({ afterStatus: "published" })).toBe(true);
    expect(
      publicHelpHtmlChanged({
        beforeStatus: "published",
        afterStatus: "draft",
      }),
    ).toBe(true);
    expect(
      publicHelpHtmlChanged({
        beforeStatus: "published",
        afterStatus: "published",
      }),
    ).toBe(true);
  });
});

describe("invalidateHelpPageCache", () => {
  test("logs skip when the runtime has no cache API", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      await invalidateHelpPageCache({} as ExecutionContext, "proj-1");
    } finally {
      console.warn = originalWarn;
    }
    expect(
      warnings.some((line) => line.includes("help.cache_purge_skipped")),
    ).toBe(true);
  });

  test("purges the project tag", async () => {
    const tags: string[][] = [];
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      await invalidateHelpPageCache(
        {
          cache: {
            async purge(options: { tags: string[] }) {
              tags.push(options.tags);
              return { success: true };
            },
          },
        } as unknown as ExecutionContext,
        "proj-1",
      );
    } finally {
      console.error = originalError;
    }
    expect(tags).toEqual([[helpPageCacheTag("proj-1")]]);
    expect(errors).toEqual([]);
  });

  test("logs failure when purge resolves with success false", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      await invalidateHelpPageCache(
        {
          cache: {
            async purge() {
              return {
                success: false,
                errors: [{ code: 10000, message: "rate limited" }],
              };
            },
          },
        } as unknown as ExecutionContext,
        "proj-1",
      );
    } finally {
      console.error = originalError;
    }
    expect(
      errors.some((line) => line.includes("help.cache_purge_failed")),
    ).toBe(true);
  });
});

describe("scheduleHelpPageCachePurge", () => {
  test("logs skip when HelpPages export is missing", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    const ctx = {
      cache: {
        async purge() {
          throw new Error("default cache must not purge");
        },
      },
      waitUntil() {
        throw new Error("should not schedule");
      },
    } as unknown as ExecutionContext;
    try {
      scheduleHelpPageCachePurge(ctx, "proj-1");
    } finally {
      console.warn = originalWarn;
    }
    expect(
      warnings.some((line) => line.includes("help.cache_purge_skipped")),
    ).toBe(true);
  });

  test("calls HelpPages.invalidate instead of default cache.purge", async () => {
    const invalidated: string[] = [];
    const defaultTags: string[][] = [];
    const pending: Promise<unknown>[] = [];
    const ctx = {
      cache: {
        async purge(options: { tags: string[] }) {
          defaultTags.push(options.tags);
        },
      },
      exports: {
        HelpPages: {
          fetch: async () => new Response("ok"),
          async invalidate(projectId: string) {
            invalidated.push(projectId);
          },
        },
      },
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as unknown as ExecutionContext;
    scheduleHelpPageCachePurge(ctx, "proj-1");
    await Promise.all(pending);
    expect(invalidated).toEqual(["proj-1"]);
    expect(defaultTags).toEqual([]);
  });
});

describe("dispatchPublicHelp", () => {
  test("uses the HelpPages export when present", async () => {
    const ctx = {
      exports: {
        HelpPages: {
          fetch: async () => new Response("cached-entrypoint"),
        },
      },
    } as unknown as ExecutionContext;
    const response = await dispatchPublicHelp(
      new Request("https://replymaven.com/help/acme"),
      {},
      ctx,
      () => new Response("app"),
    );
    expect(await response.text()).toBe("cached-entrypoint");
  });

  test("falls back to the app fetch when exports are missing", async () => {
    const response = await dispatchPublicHelp(
      new Request("https://replymaven.com/help/acme"),
      {},
      {} as ExecutionContext,
      () => new Response("app"),
    );
    expect(await response.text()).toBe("app");
  });
});
