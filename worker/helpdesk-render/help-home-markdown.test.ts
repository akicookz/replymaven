import { describe, expect, test } from "bun:test";
import { defaultHelpHomeMarkdown } from "../../shared/help-home-markdown";
import { expandHelpHomeBlocks } from "./expand-help-home-blocks";
import { renderMarkdown } from "./render-markdown";

const OPTIONS = { projectSlug: "acme", customUrl: null };

async function html(markdown: string): Promise<string> {
  return (await renderMarkdown(markdown, OPTIONS)).html;
}

describe("help home markdown", () => {
  test("emits markers for search, categories, and popular", async () => {
    const out = await html(
      "::help-search\n::help-categories\n::help-popular\n",
    );
    expect(out).toContain('data-help-block="search"');
    expect(out).toContain('data-help-block="categories"');
    expect(out).toContain('data-help-block="popular"');
  });

  test("renders two columns", async () => {
    const out = await html(`:::columns
::column
left
::column
right
:::
`);
    expect(out).toContain('class="help-columns"');
    expect(out).toContain('class="help-column"');
    expect(out).toContain("left");
    expect(out).toContain("right");
  });

  test("keeps nested home blocks inside columns", async () => {
    const out = await html(defaultHelpHomeMarkdown("Acme"));
    expect(out).toContain("How can we help?");
    expect(out).toContain("Acme");
    expect(out).toContain('data-help-block="search"');
    expect(out).toContain('data-help-block="categories"');
    expect(out).toContain('data-help-block="popular"');
    expect(out).toContain('class="help-columns"');
  });

  test("expand injects the search form after sanitize", async () => {
    const rendered = await html("::help-search\n");
    const expanded = expandHelpHomeBlocks(rendered, {
      projectSlug: "acme",
      customUrl: null,
      searchAction: "/help/acme/search",
      categories: [],
      popularArticles: [],
    });
    expect(expanded).toContain('action="/help/acme/search"');
    expect(expanded).toContain('name="q"');
    expect(expanded).not.toContain("data-help-block");
  });
});
