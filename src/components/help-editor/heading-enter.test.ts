import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { isEmptyParagraphNode } from "./heading-enter";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
  },
});

describe("isEmptyParagraphNode", () => {
  test("treats an empty paragraph as empty", () => {
    expect(isEmptyParagraphNode(schema.node("paragraph"))).toBe(true);
  });

  test("treats hard-break-only and nbsp-only paragraphs as empty", () => {
    expect(
      isEmptyParagraphNode(
        schema.node("paragraph", null, [schema.node("hardBreak")]),
      ),
    ).toBe(true);
    expect(
      isEmptyParagraphNode(
        schema.node("paragraph", null, [schema.text("\u00A0")]),
      ),
    ).toBe(true);
  });

  test("rejects a paragraph with text", () => {
    expect(
      isEmptyParagraphNode(
        schema.node("paragraph", null, [schema.text("Body")]),
      ),
    ).toBe(false);
  });
});
