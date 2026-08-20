import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";

const CUSTOM = {
  projectSlug: "lovablehtml",
  customUrl: "https://encited.com/docs",
};

async function html(
  markdown: string,
  options: { projectSlug: string; customUrl: string | null } = CUSTOM,
): Promise<string> {
  return (await renderMarkdown(markdown, options)).html;
}

describe("help markdown links on a custom domain", () => {
  test("remaps a hosted help URL to the custom path", async () => {
    const out = await html(
      "[Setup](https://replymaven.com/help/lovablehtml/pre-rendering/setup)",
    );
    expect(out).toContain('href="https://encited.com/docs/pre-rendering/setup"');
    expect(out).not.toContain("target=");
  });

  test("keeps a hash fragment on this page", async () => {
    const out = await html("[Jump](#hosted-platform-guides)");
    expect(out).toContain('href="#hosted-platform-guides"');
    expect(out).not.toContain("https://encited.com/docs#");
  });

  test("rewrites /help/{slug}/... onto the custom base", async () => {
    const out = await html(
      "[Setup](/help/lovablehtml/pre-rendering/setup)",
    );
    expect(out).toContain('href="https://encited.com/docs/pre-rendering/setup"');
  });

  test("sends an upload href to ReplyMaven, not the custom base", async () => {
    const out = await html("[File](/api/uploads/user-1/shot.png)");
    expect(out).toContain(
      'href="https://replymaven.com/api/uploads/user-1/shot.png"',
    );
    expect(out).not.toContain("encited.com/docs/api/uploads");
  });

  test("leaves a foreign help URL alone when the slug does not match", async () => {
    const out = await html(
      "[Other](https://replymaven.com/help/acme/getting-started/install)",
    );
    expect(out).toContain(
      'href="https://replymaven.com/help/acme/getting-started/install"',
    );
  });
});

describe("help markdown images on a custom domain", () => {
  test("prefixes a relative upload src", async () => {
    const out = await html("![Mark](/api/uploads/user-1/mark.png)");
    expect(out).toContain(
      'src="https://replymaven.com/api/uploads/user-1/mark.png"',
    );
  });

  test("keeps an already-absolute upload src", async () => {
    const out = await html(
      "![Shot](https://replymaven.com/api/uploads/help-images/p1/a.jpg)",
    );
    expect(out).toContain(
      'src="https://replymaven.com/api/uploads/help-images/p1/a.jpg"',
    );
  });
});
