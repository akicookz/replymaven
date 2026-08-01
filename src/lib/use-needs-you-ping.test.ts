import { expect, test } from "bun:test";
import { selectItemsToPing } from "./use-needs-you-ping";

test("pings a newly eligible conversation once without pinging the initial backlog", () => {
  const seen = new Set<string>();
  const backlog = [{ id: "backlog", updatedAt: 1 }];

  expect(selectItemsToPing(null, backlog, seen)).toEqual([]);

  const newlyEligible = { id: "new", updatedAt: 2 };
  const firstPing = selectItemsToPing("1719900000000", [newlyEligible], seen);
  expect(firstPing).toEqual([newlyEligible]);

  seen.add(newlyEligible.id);
  expect(
    selectItemsToPing(
      "1719900001000",
      [{ ...newlyEligible, updatedAt: 3 }],
      seen,
    ),
  ).toEqual([]);
});
