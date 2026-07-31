import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./chat-markdown";

describe("renderMarkdown", () => {
  test("preserves a blank line as a paragraph boundary", () => {
    expect(renderMarkdown("line one\n\nline two")).toBe(
      "<p>line one</p>\n<p>line two</p>\n",
    );
  });

  test("keeps a single newline inside one paragraph", () => {
    expect(renderMarkdown("line one\nline two")).toBe(
      "<p>line one<br>line two</p>\n",
    );
  });

  test("renders inline and fenced code semantically", () => {
    expect(renderMarkdown("Use `@` or `www`.")).toBe(
      "<p>Use <code>@</code> or <code>www</code>.</p>\n",
    );
    expect(renderMarkdown("```txt\n  indented\n```")).toBe(
      '<pre><code class="language-txt">  indented\n</code></pre>\n',
    );
  });

  test("keeps safe Markdown links and bare URLs", () => {
    expect(renderMarkdown("[Docs](https://example.com?a=1&b=2)")).toBe(
      '<p><a href="https://example.com?a=1&amp;b=2" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">Docs</a></p>\n',
    );
    expect(renderMarkdown("https://example.com")).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">https://example.com</a></p>\n',
    );
  });

  test("escapes raw HTML", () => {
    expect(renderMarkdown("<script>alert('x')</script>")).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
    );
  });

  test("does not emit anchors for unsafe protocols", () => {
    expect(renderMarkdown("[bad](javascript:alert(1))")).toBe("<p>bad</p>\n");
    expect(renderMarkdown("[bad](data:text/html,boom)")).toBe("<p>bad</p>\n");
  });

  test("renders inline Markdown images as escaped alt text", () => {
    expect(renderMarkdown("![<logo>](https://example.com/logo.svg)")).toBe(
      "<p>&lt;logo&gt;</p>\n",
    );
  });
});
