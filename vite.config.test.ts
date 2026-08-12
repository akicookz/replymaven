import { describe, expect, test } from "bun:test";

describe("Cloudflare Vite development bindings", () => {
  test("keeps configured remote bindings enabled", async () => {
    const source = await Bun.file(new URL("./vite.config.ts", import.meta.url)).text();

    expect(source).toContain("cloudflare({ remoteBindings: true })");
    expect(source).not.toContain("cloudflare({ remoteBindings: false })");
  });
});
