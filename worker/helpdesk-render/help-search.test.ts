import { describe, expect, test } from "bun:test";
import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import { matchHelpArticlesFromQuery } from "./help-search";

const guides = {
  id: "cat-guides",
  name: "Guides",
  slug: "guides",
} as HelpCategoryRow;

const install = {
  id: "art-install",
  projectId: "proj-1",
  categoryId: "cat-guides",
  title: "Install the chat widget",
  slug: "install-the-chat-widget",
  excerpt: "Add the embed script to your site.",
} as HelpArticleNav;

const billing = {
  id: "art-billing",
  projectId: "proj-1",
  categoryId: "cat-guides",
  title: "Billing and invoices",
  slug: "billing",
  excerpt: "Download receipts from the dashboard.",
} as HelpArticleNav;

describe("matchHelpArticlesFromQuery", () => {
  test("returns title and excerpt hits, ranked", () => {
    const results = matchHelpArticlesFromQuery(
      "widget",
      [billing, install],
      [guides],
    );
    expect(results.map((result) => result.article.id)).toEqual(["art-install"]);
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  test("matches excerpt-only articles", () => {
    const results = matchHelpArticlesFromQuery(
      "receipts",
      [billing, install],
      [guides],
    );
    expect(results.map((result) => result.article.id)).toEqual(["art-billing"]);
  });

  test("returns nothing for an empty or unmatched query", () => {
    expect(matchHelpArticlesFromQuery("   ", [install], [guides])).toEqual([]);
    expect(
      matchHelpArticlesFromQuery("zebra", [install], [guides]),
    ).toEqual([]);
  });

  test("matches body text and returns a snippet", () => {
    const buried = {
      ...billing,
      content:
        "Ignore the title. Then a long run-up of prose sits here so the snippet window starts after the opening line. The widget embed script goes in the document head.",
    };
    const results = matchHelpArticlesFromQuery(
      "embed script",
      [buried, install],
      [guides],
    );
    expect(results.map((result) => result.article.id)).toEqual([
      "art-install",
      "art-billing",
    ]);
    const bodyHit = results.find((result) => result.article.id === "art-billing");
    expect(bodyHit?.match).toBe("content");
    expect(bodyHit?.snippet).toContain("widget embed script");
    expect(bodyHit?.snippet).not.toContain("Ignore the title");
  });

  test("ignores missing content the same way public nav search does", () => {
    const results = matchHelpArticlesFromQuery(
      "document head",
      [billing, install],
      [guides],
    );
    expect(results).toEqual([]);
  });
});
