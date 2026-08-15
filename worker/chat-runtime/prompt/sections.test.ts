import { describe, expect, test } from "bun:test";
import {
  isReturningVisitorGap,
  RETURNING_VISITOR_GAP_MS,
} from "../types";
import { buildSupportTurnOpening, buildSupportTurnSection } from "./sections";

const visitor = { name: "Aki", email: "aki@example.com" };

describe("support turn greeting", () => {
  test("greets on the first visitor turn", () => {
    const opening = buildSupportTurnOpening(
      { kind: "standard", isFirstVisitorTurn: true, isReturningVisitor: false },
      visitor,
    );
    expect(opening).toBe("Hi Aki,\n\n");
  });

  test("does not greet mid-conversation", () => {
    const opening = buildSupportTurnOpening(
      { kind: "standard", isFirstVisitorTurn: false, isReturningVisitor: false },
      visitor,
    );
    expect(opening).toBe("");
  });

  test("greets again when the visitor returns after a long gap", () => {
    const context = {
      kind: "standard",
      isFirstVisitorTurn: false,
      isReturningVisitor: true,
    } as const;
    expect(buildSupportTurnOpening(context, visitor)).toBe("Hi Aki,\n\n");
    expect(buildSupportTurnSection(context)).toContain(
      "The runtime has already added the visitor greeting.",
    );
  });

  test("returning gap trips at the threshold and not before", () => {
    const now = 1_700_000_000_000;
    expect(isReturningVisitorGap(now - RETURNING_VISITOR_GAP_MS, now)).toBe(
      true,
    );
    expect(isReturningVisitorGap(now - RETURNING_VISITOR_GAP_MS + 1, now)).toBe(
      false,
    );
    expect(isReturningVisitorGap(null, now)).toBe(false);
  });
});
