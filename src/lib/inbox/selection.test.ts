import { describe, expect, test } from "bun:test";
import {
  moveRangeSelection,
  selectInclusiveRange,
  toggleSelection,
} from "./selection";

const orderedIds = ["a", "b", "c", "d", "e"];

describe("inbox range selection", () => {
  test("selects the inclusive range in either direction", () => {
    expect([...selectInclusiveRange(orderedIds, "b", "d")]).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect([...selectInclusiveRange(orderedIds, "d", "b")]).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  test("Shift arrows extend and contract around a stable anchor", () => {
    const extended = moveRangeSelection({
      orderedIds,
      anchorId: "c",
      focusId: "c",
      direction: 1,
    });
    const extendedAgain = moveRangeSelection({
      orderedIds,
      anchorId: "c",
      focusId: extended.focusId,
      direction: 1,
    });
    const contracted = moveRangeSelection({
      orderedIds,
      anchorId: "c",
      focusId: extendedAgain.focusId,
      direction: -1,
    });

    expect([...extended.selectedIds]).toEqual(["c", "d"]);
    expect([...extendedAgain.selectedIds]).toEqual(["c", "d", "e"]);
    expect([...contracted.selectedIds]).toEqual(["c", "d"]);
    expect(contracted.focusId).toBe("d");
  });

  test("does not move outside the loaded rows", () => {
    const result = moveRangeSelection({
      orderedIds,
      anchorId: "a",
      focusId: "a",
      direction: -1,
    });

    expect([...result.selectedIds]).toEqual(["a"]);
    expect(result.focusId).toBe("a");
  });

  test("plain selection toggles only the targeted row", () => {
    const selected = toggleSelection(new Set(["a", "b"]), "b");
    const reselected = toggleSelection(selected, "c");

    expect([...selected]).toEqual(["a"]);
    expect([...reselected]).toEqual(["a", "c"]);
  });
});
