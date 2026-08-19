import { describe, expect, test } from "bun:test";
import {
  applyHelpArticleSeoDefaults,
  firstHelpArticleTextLine,
  HELP_ARTICLE_EXCERPT_MAX,
} from "./apply-help-article-seo-defaults";

describe("firstHelpArticleTextLine", () => {
  test("skips the H1 and returns the next text line", () => {
    expect(
      firstHelpArticleTextLine("# Install\n\nRun the installer.\n\nMore."),
    ).toBe("Run the installer.");
  });

  test("skips images and rules", () => {
    expect(
      firstHelpArticleTextLine(
        "# Title\n\n![hero](https://cdn.example/hero.png)\n\n---\n\nLead sentence.",
      ),
    ).toBe("Lead sentence.");
  });

  test("returns empty when the body has no prose", () => {
    expect(firstHelpArticleTextLine("# Title\n\n![x](/x.png)\n")).toBe("");
  });
});

describe("applyHelpArticleSeoDefaults", () => {
  const body = [
    "# Install",
    "",
    "Run the installer.",
    "",
    "![setup](https://cdn.example/setup.png)",
    "",
  ].join("\n");

  test("fills empty fields from the body", () => {
    expect(
      applyHelpArticleSeoDefaults({
        content: body,
      }),
    ).toEqual({
      excerpt: "Run the installer.",
      ogImageUrl: "https://cdn.example/setup.png",
    });
  });

  test("keeps provided fields", () => {
    expect(
      applyHelpArticleSeoDefaults({
        excerpt: "Custom description.",
        ogImageUrl: "https://cdn.example/custom.png",
        content: body,
      }),
    ).toEqual({
      excerpt: "Custom description.",
      ogImageUrl: "https://cdn.example/custom.png",
    });
  });

  test("treats whitespace as empty", () => {
    expect(
      applyHelpArticleSeoDefaults({
        excerpt: "  ",
        ogImageUrl: "   ",
        content: body,
      }),
    ).toEqual({
      excerpt: "Run the installer.",
      ogImageUrl: "https://cdn.example/setup.png",
    });
  });

  test("caps a long first line at the excerpt max", () => {
    const long = "A".repeat(HELP_ARTICLE_EXCERPT_MAX + 40);
    const result = applyHelpArticleSeoDefaults({
      content: `# T\n\n${long}\n`,
    });
    expect(result.excerpt).toBe("A".repeat(HELP_ARTICLE_EXCERPT_MAX));
  });

  test("leaves excerpt and image null when the body has neither", () => {
    expect(
      applyHelpArticleSeoDefaults({
        content: "# Empty\n",
      }),
    ).toEqual({
      excerpt: null,
      ogImageUrl: null,
    });
  });
});
