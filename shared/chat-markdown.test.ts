import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./chat-markdown";

describe("renderMarkdown", () => {
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
