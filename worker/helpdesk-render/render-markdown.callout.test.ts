import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";

const OPTIONS = { projectSlug: "acme", customUrl: null };

async function html(markdown: string): Promise<string> {
  return (await renderMarkdown(markdown, OPTIONS)).html;
}

describe("callout inline markdown", () => {
  // The marker and the body share one paragraph, which is where the bug lived:
  // the body was replaced with a single raw text token and rendered verbatim.
  test("parses inline code on the line after the marker", async () => {
    const out = await html("> [!INFO]\n> Call `/api/render` for documents.\n");
    expect(out).toContain("<code>/api/render</code>");
    expect(out).not.toContain("`/api/render`");
  });

  test("parses bold and links in the callout body", async () => {
    const out = await html(
      "> [!TIP]\n> Set **LOVABLE_KEY** and read [the docs](https://example.com).\n",
    );
    expect(out).toContain("<strong>LOVABLE_KEY</strong>");
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain("**LOVABLE_KEY**");
  });

  test("still marks the variant and wraps in a callout div", async () => {
    const out = await html("> [!WARNING]\n> Careful with `rm -rf`.\n");
    expect(out).toContain('class="callout callout-warning"');
    expect(out).toContain('data-callout="warning"');
  });

  test("a body in its own paragraph keeps working", async () => {
    const out = await html("> [!DANGER]\n>\n> Never commit `secrets.env`.\n");
    expect(out).toContain('class="callout callout-danger"');
    expect(out).toContain("<code>secrets.env</code>");
  });

  test("a plain blockquote is untouched", async () => {
    const out = await html("> Just a quote with `code`.\n");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<code>code</code>");
    expect(out).not.toContain("callout");
  });
});
