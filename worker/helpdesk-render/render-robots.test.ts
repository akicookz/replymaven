import { describe, expect, test } from "bun:test";
import { renderRobots } from "./render-robots";

describe("renderRobots", () => {
  test("omits a sitemap on the hosted /help path", () => {
    expect(
      renderRobots({ projectSlug: "lovablehtml", helpCustomUrl: null }),
    ).toBe(`User-agent: *
Allow: /
`);
  });

  test("points the sitemap at the custom URL", () => {
    expect(
      renderRobots({
        projectSlug: "replymaven",
        helpCustomUrl: "https://replymaven.com/docs",
      }),
    ).toBe(`User-agent: *
Allow: /
Sitemap: https://replymaven.com/docs/sitemap.xml
`);
  });
});
