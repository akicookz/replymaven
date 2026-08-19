import { describe, expect, test } from "bun:test";
import { buildSlashItems, filterSlashItems } from "./slash-command-items";

describe("help editor slash items", () => {
  const items = buildSlashItems({ openImagePicker: () => {} });

  test("includes Body before headings", () => {
    const ids = items.map((item) => item.id);
    expect(ids.indexOf("body")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("body")).toBeLessThan(ids.indexOf("h1"));
  });

  test("finds Body by paragraph and text keywords", () => {
    expect(filterSlashItems(items, "body")[0]?.id).toBe("body");
    expect(filterSlashItems(items, "paragraph")[0]?.id).toBe("body");
  });

  test("includes Link", () => {
    expect(items.some((item) => item.id === "link")).toBe(true);
    expect(filterSlashItems(items, "url")[0]?.id).toBe("link");
  });
});
