import { describe, expect, test } from "bun:test";
import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import {
  helpArticlesFolderFilter,
  matchHelpArticlesFromQuery,
  resolveHelpSearchResults,
  toHelpSearchResultCards,
} from "./help-search";

const PROJECT_ID = "proj-1";

const guides = {
  id: "cat-guides",
  name: "Guides",
  slug: "guides",
} as HelpCategoryRow;

const install = {
  id: "art-install",
  projectId: PROJECT_ID,
  categoryId: "cat-guides",
  title: "Install the chat widget",
  slug: "install-the-chat-widget",
  excerpt: "Add the embed script to your site.",
} as HelpArticleNav;

const billing = {
  id: "art-billing",
  projectId: PROJECT_ID,
  categoryId: "cat-guides",
  title: "Billing and invoices",
  slug: "billing",
  excerpt: "Download receipts from the dashboard.",
} as HelpArticleNav;

describe("helpArticlesFolderFilter", () => {
  test("uses an articles prefix range", () => {
    expect(helpArticlesFolderFilter(PROJECT_ID)).toEqual({
      $gte: "proj-1/articles/",
      $lt: "proj-1/articles0",
    });
  });
});

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
});

describe("resolveHelpSearchResults", () => {
  test("maps chunk keys and data filenames to published articles", () => {
    const fromChunks = resolveHelpSearchResults(
      {
        chunks: [
          {
            score: 0.9,
            item: { key: `${PROJECT_ID}/articles/art-install.md` },
          },
          {
            score: 0.2,
            item: { key: `${PROJECT_ID}/faqs/other.md` },
          },
        ],
      },
      [install, billing],
      [guides],
      PROJECT_ID,
    );
    expect(fromChunks.map((result) => result.article.id)).toEqual([
      "art-install",
    ]);

    const fromData = resolveHelpSearchResults(
      {
        data: [
          {
            filename: `${PROJECT_ID}/articles/art-billing.md`,
            score: 0.4,
          },
        ],
      },
      [install, billing],
      [guides],
      PROJECT_ID,
    );
    expect(fromData.map((result) => result.article.id)).toEqual(["art-billing"]);
  });

  test("accepts a bare chunks array from the stream event", () => {
    const results = resolveHelpSearchResults(
      [
        {
          score: 0.7,
          item: { key: `${PROJECT_ID}/articles/art-install.md` },
        },
      ],
      [install],
      [guides],
      PROJECT_ID,
    );
    expect(results).toHaveLength(1);
  });

  test("drops unpublished or unknown article ids", () => {
    const results = resolveHelpSearchResults(
      {
        result: {
          chunks: [
            {
              item: { key: `${PROJECT_ID}/articles/missing.md` },
              score: 0.9,
            },
          ],
        },
      },
      [install],
      [guides],
      PROJECT_ID,
    );
    expect(results).toEqual([]);
  });
});

describe("toHelpSearchResultCards", () => {
  test("builds public help hrefs", () => {
    const [card] = toHelpSearchResultCards(
      [{ article: install, category: guides, score: 1 }],
      "acme",
      null,
    );
    expect(card).toEqual({
      id: "art-install",
      title: "Install the chat widget",
      excerpt: "Add the embed script to your site.",
      href: "https://replymaven.com/help/acme/guides/install-the-chat-widget",
      breadcrumb: "Guides",
    });
  });
});
