import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { claimWidgetInstance } from "./instance-guard";

test("only the first embed execution can claim the page", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");

  expect(claimWidgetInstance(dom.window.document.documentElement, "first"))
    .toBe(true);
  expect(claimWidgetInstance(dom.window.document.documentElement, "second"))
    .toBe(false);
  expect(
    dom.window.document.documentElement.getAttribute(
      "data-replymaven-widget-claimed",
    ),
  ).toBe("first");
});
