import { describe, expect, test } from "bun:test";
import {
  defaultHelpHomeMarkdown,
  MAX_POPULAR_ARTICLES,
  parseHelpHomeBlockLine,
  parsePopularArticleIds,
  serializeHelpHomeBlock,
} from "../../shared/help-home-markdown";
import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import { expandHelpHomeBlocks } from "./expand-help-home-blocks";
import { renderMarkdown } from "./render-markdown";
import type { PopularArticleEntry } from "./help-home-widgets";

const OPTIONS = { projectSlug: "acme", customUrl: null };

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

async function html(markdown: string): Promise<string> {
  return (await renderMarkdown(markdown, OPTIONS)).html;
}

function entry(
  id: string,
  title: string,
  slug: string,
): PopularArticleEntry {
  return {
    article: {
      id,
      title,
      slug,
    } as HelpArticleNav,
    category: { slug: "guides" } as HelpCategoryRow,
  };
}

const EMPTY_EXPAND = {
  projectSlug: "acme",
  customUrl: null,
  searchAction: "/help/acme/search",
  categories: [],
  publishedArticles: [] as PopularArticleEntry[],
};

describe("help home markdown", () => {
  test("emits markers for search, categories, and popular", async () => {
    const out = await html(
      "::help-search\n::help-categories\n::help-popular\n",
    );
    expect(out).toContain('data-help-block="search"');
    expect(out).toContain('data-help-block="categories"');
    expect(out).toContain('data-help-block="popular"');
  });

  test("default home stacks search, categories, and popular", async () => {
    const out = await html(defaultHelpHomeMarkdown("Acme"));
    expect(out).toContain("How can we help?");
    expect(out).toContain("Acme");
    expect(out).toContain('data-help-block="search"');
    expect(out).toContain('data-help-block="categories"');
    expect(out).toContain('data-help-block="popular"');
  });

  test("expand injects the search form after sanitize", async () => {
    const rendered = await html("::help-search\n");
    const expanded = expandHelpHomeBlocks(rendered, EMPTY_EXPAND);
    expect(expanded).toContain('action="/help/acme/search"');
    expect(expanded).toContain('name="q"');
    expect(expanded).not.toContain("data-help-block");
  });

  test("keeps selected popular article ids on the marker", async () => {
    const out = await html(`::help-popular[${ID_A},${ID_B}]\n`);
    expect(out).toContain('data-help-block="popular"');
    expect(out).toContain(`data-article-ids="${ID_A},${ID_B}"`);
  });

  test("drops invalid popular ids and caps at 10", async () => {
    const ids = Array.from({ length: MAX_POPULAR_ARTICLES + 2 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    const out = await html(`::help-popular[not-an-id,${ids.join(",")}]\n`);
    const attr = /data-article-ids="([^"]*)"/.exec(out)?.[1] ?? "";
    const kept = attr.split(",");
    expect(kept).toHaveLength(MAX_POPULAR_ARTICLES);
    expect(kept[0]).toBe(ids[0]);
    expect(attr).not.toContain("not-an-id");
    expect(attr).not.toContain(ids[MAX_POPULAR_ARTICLES]);
  });

  test("empty popular expands to nothing", async () => {
    const rendered = await html("::help-popular\n");
    const expanded = expandHelpHomeBlocks(rendered, {
      ...EMPTY_EXPAND,
      publishedArticles: [entry(ID_A, "Hello", "hello")],
    });
    expect(expanded).not.toContain("Popular Articles");
    expect(expanded).not.toContain("Hello");
    expect(expanded).not.toContain("data-help-block");
  });

  test("popular expands selected articles in listed order", async () => {
    const rendered = await html(`::help-popular[${ID_B},${ID_A}]\n`);
    const expanded = expandHelpHomeBlocks(rendered, {
      ...EMPTY_EXPAND,
      publishedArticles: [
        entry(ID_A, "First", "first"),
        entry(ID_B, "Second", "second"),
        entry(ID_C, "Third", "third"),
      ],
    });
    expect(expanded).toContain("Popular Articles");
    expect(expanded).toContain("Second");
    expect(expanded).toContain("First");
    expect(expanded).not.toContain("Third");
    expect(expanded.indexOf("Second")).toBeLessThan(expanded.indexOf("First"));
  });

  test("popular skips ids that are not in the published set", async () => {
    const rendered = await html(`::help-popular[${ID_A},${ID_B}]\n`);
    const expanded = expandHelpHomeBlocks(rendered, {
      ...EMPTY_EXPAND,
      publishedArticles: [entry(ID_A, "Hello", "hello")],
    });
    expect(expanded).toContain("Hello");
    expect(expanded).not.toContain(ID_B);
  });
});

describe("popular article id helpers", () => {
  test("parseHelpHomeBlockLine reads popular ids", () => {
    const parsed = parseHelpHomeBlockLine(`::help-popular[${ID_A}, ${ID_B}]`);
    expect(parsed).toEqual({
      kind: "popular",
      articleIds: [ID_A, ID_B],
    });
  });

  test("serialize omits brackets when empty", () => {
    expect(serializeHelpHomeBlock("popular", [])).toBe("::help-popular");
    expect(serializeHelpHomeBlock("popular", [ID_A])).toBe(
      `::help-popular[${ID_A}]`,
    );
    expect(serializeHelpHomeBlock("search")).toBe("::help-search");
  });

  test("parsePopularArticleIds dedupes and lowercases", () => {
    expect(
      parsePopularArticleIds(`${ID_A.toUpperCase()},${ID_A},not-id`),
    ).toEqual([ID_A]);
  });
});
