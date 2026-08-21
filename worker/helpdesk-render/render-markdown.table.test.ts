import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";

const OPTIONS = { projectSlug: "acme", customUrl: null };

describe("help table wrap", () => {
  test("wraps a markdown table for overflow scroll", async () => {
    const out = (
      await renderMarkdown(
        "| Type | Name |\n| --- | --- |\n| A | @ |\n",
        OPTIONS,
      )
    ).html;
    expect(out).toContain('class="help-table"');
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Type</th>");
  });
});
