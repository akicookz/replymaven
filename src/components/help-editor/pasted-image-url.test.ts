import { describe, expect, test } from "bun:test";
import { pastedImageUrl } from "./pasted-image-url";

describe("pastedImageUrl", () => {
  test("accepts an https image file URL", () => {
    expect(pastedImageUrl("https://cdn.example.com/shot.png")).toBe(
      "https://cdn.example.com/shot.png",
    );
  });

  test("keeps query strings and normalizes the href", () => {
    expect(pastedImageUrl("https://cdn.example.com/shot.JPG?w=800")).toBe(
      "https://cdn.example.com/shot.JPG?w=800",
    );
  });

  test("accepts jpeg png webp svg", () => {
    expect(pastedImageUrl("http://cdn.example.com/a.jpeg")).toBe(
      "http://cdn.example.com/a.jpeg",
    );
    expect(pastedImageUrl("https://cdn.example.com/a.webp")).toBe(
      "https://cdn.example.com/a.webp",
    );
    expect(pastedImageUrl("https://cdn.example.com/a.svg")).toBe(
      "https://cdn.example.com/a.svg",
    );
  });

  test("unwraps quotes and angle brackets", () => {
    expect(pastedImageUrl('"https://cdn.example.com/a.png"')).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(pastedImageUrl("<https://cdn.example.com/a.png>")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  test("rejects a lone URL that is not an image file", () => {
    expect(pastedImageUrl("https://example.com/blog")).toBeNull();
    expect(pastedImageUrl("https://images.unsplash.com/photo-abc")).toBeNull();
    expect(pastedImageUrl("https://cdn.example.com/a.gif")).toBeNull();
  });

  test("rejects markdown, sentences, and credentials", () => {
    expect(
      pastedImageUrl("![alt](https://cdn.example.com/a.png)"),
    ).toBeNull();
    expect(
      pastedImageUrl("see https://cdn.example.com/a.png please"),
    ).toBeNull();
    expect(
      pastedImageUrl("https://user:secret@cdn.example.com/a.png"),
    ).toBeNull();
  });
});
