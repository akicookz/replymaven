import { describe, expect, test } from "bun:test";
import { isSaveHotkey } from "./use-save-hotkey";

function key(
  overrides: Partial<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">>,
): KeyboardEvent {
  return {
    key: "s",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("isSaveHotkey", () => {
  test("matches Cmd+S and Ctrl+S", () => {
    expect(isSaveHotkey(key({ metaKey: true }))).toBe(true);
    expect(isSaveHotkey(key({ ctrlKey: true }))).toBe(true);
  });

  test("rejects Shift, Alt, and other keys", () => {
    expect(isSaveHotkey(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveHotkey(key({ metaKey: true, altKey: true }))).toBe(false);
    expect(isSaveHotkey(key({ metaKey: true, key: "p" }))).toBe(false);
    expect(isSaveHotkey(key({}))).toBe(false);
  });
});
