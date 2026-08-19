import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./render-markdown";

const OPTIONS = { projectSlug: "acme", customUrl: null };

async function html(markdown: string): Promise<string> {
  return (await renderMarkdown(markdown, OPTIONS)).html;
}

describe("help image crop attrs", () => {
  test("keeps percent width, aspect ratio, and focal point", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="App" width="80%" data-aspect="100 / 45" data-object-position="0% 0%" />`,
    );
    expect(out).toContain('class="help-img"');
    expect(out).toContain('src="https://cdn.example.com/shot.png"');
    expect(out).toContain('width="80%"');
    expect(out).toContain("width:80%");
    expect(out).toContain("aspect-ratio:100 / 45");
    expect(out).toContain('data-object-position="0% 0%"');
    expect(out).toContain("object-fit:cover");
    expect(out).toContain("object-position:0% 0%");
    expect(out).not.toContain("height=");
  });

  test("full-width crop uses 100% not pixels", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="" width="100%" data-aspect="2 / 1" data-object-position="50% 0%" />`,
    );
    expect(out).toContain('width="100%"');
    expect(out).toContain("width:100%");
    expect(out).toContain("aspect-ratio:2 / 1");
  });

  test("legacy pixel crop becomes 100% width plus aspect-ratio", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="" width="400" height="180" data-object-position="0% 0%" />`,
    );
    expect(out).toContain('width="100%"');
    expect(out).toContain("width:100%");
    expect(out).toContain("aspect-ratio:400 / 180");
    expect(out).toContain("object-position:0% 0%");
    expect(out).not.toContain('width="400"');
    expect(out).not.toContain('height="180"');
  });

  test("defaults a cropped img without a focal point to center", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="" width="100%" data-aspect="16 / 9" />`,
    );
    expect(out).toContain('data-object-position="50% 50%"');
    expect(out).toContain("object-position:50% 50%");
  });

  test("rebuilds style so only layout and a percent focal point survive", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="" width="100%" data-aspect="5 / 3" style="object-fit:cover;object-position:12% 88%;background:url('javascript:alert(1)');width:expression(alert(1))" />`,
    );
    expect(out).toContain("object-fit:cover");
    expect(out).toContain("object-position:12% 88%");
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("expression");
    expect(out).not.toContain("background");
  });

  test("drops an invalid focal point and uses center", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="" width="100%" data-aspect="4 / 3" data-object-position="left top" />`,
    );
    expect(out).toContain('data-object-position="50% 50%"');
    expect(out).not.toContain("left top");
  });

  test("percent width without a crop does not force cover", async () => {
    const out = await html(
      `<img src="https://cdn.example.com/shot.png" alt="App" width="80%" />`,
    );
    expect(out).toContain('width="80%"');
    expect(out).toContain("width:80%");
    expect(out).not.toContain("object-fit");
    expect(out).not.toContain("data-object-position");
    expect(out).not.toContain("aspect-ratio");
  });
});
