import { describe, expect, it } from "bun:test";
import { splitHelpArticleLead } from "./split-help-article-lead";

describe("splitHelpArticleLead", () => {
  it("cuts after the first paragraph that follows the H1", () => {
    const html =
      '<h1 id="title">Title</h1>\n<p>Lead sentence.</p>\n<p>More body.</p>';
    expect(splitHelpArticleLead(html)).toEqual({
      head: '<h1 id="title">Title</h1>\n<p>Lead sentence.</p>',
      tail: "<p>More body.</p>",
    });
  });

  it("cuts after the H1 when the next block is not a paragraph", () => {
    const html = "<h1>Title</h1>\n<ul><li>A</li></ul>";
    expect(splitHelpArticleLead(html)).toEqual({
      head: "<h1>Title</h1>",
      tail: "<ul><li>A</li></ul>",
    });
  });

  it("keeps inline markup inside the lead paragraph", () => {
    const html =
      '<h1>Title</h1><p>Lead with a <a href="/x">link</a>.</p><h2>Next</h2>';
    expect(splitHelpArticleLead(html)).toEqual({
      head: '<h1>Title</h1><p>Lead with a <a href="/x">link</a>.</p>',
      tail: "<h2>Next</h2>",
    });
  });
});
