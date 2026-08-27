import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";

const OPTIONS = { projectSlug: "acme", customUrl: null };

async function html(markdown: string): Promise<string> {
  return (await renderMarkdown(markdown, OPTIONS)).html;
}

describe("code block copy chrome", () => {
  test("wraps a fenced block with a copy button", async () => {
    const out = await html("```js\nconsole.log(1)\n```\n");
    expect(out).toContain('class="help-code"');
    expect(out).toContain('aria-label="Copy code"');
    expect(out).toContain("<pre>");
    expect(out).toContain("language-js");
  });

  test("does not wrap inline code", async () => {
    const out = await html("Use `npm install` to add it.\n");
    expect(out).toContain("<code>npm install</code>");
    expect(out).not.toContain("help-code-copy");
  });

  test("wraps api example fences", async () => {
    const out = await html(
      "```api-examples\n" +
        JSON.stringify({
          examples: [{ label: "Request", language: "json", code: '{"ok":true}' }],
        }) +
        "\n```\n",
    );
    expect(out).toContain("help-api-example");
    expect(out).toContain("help-code-copy");
    expect(out).toContain("language-json");
  });
});
