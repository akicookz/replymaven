import { describe, expect, test } from "bun:test";
import {
  dispatchPublicHelp,
  helpPageCacheHeaders,
  helpPageCacheTag,
  helpUncachedHeaders,
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

describe("scheduleHelpPageCachePurge", () => {
  test("no-ops when the runtime has no cache API", () => {
    const ctx = {
      waitUntil() {
        throw new Error("should not schedule");
      },
    } as unknown as ExecutionContext;
    scheduleHelpPageCachePurge(ctx, "proj-1");
  });

  test("purges the project tag", async () => {
    const tags: string[][] = [];
    const pending: Promise<unknown>[] = [];
    const ctx = {
      cache: {
        async purge(options: { tags: string[] }) {
          tags.push(options.tags);
        },
      },
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as unknown as ExecutionContext;
    scheduleHelpPageCachePurge(ctx, "proj-1");
    await Promise.all(pending);
    expect(tags).toEqual([[helpPageCacheTag("proj-1")]]);
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
