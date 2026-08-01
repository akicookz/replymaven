import { describe, expect, test } from "bun:test";
import {
  INTERNAL_TOKENS,
  createStreamingStripState,
  stripInternalTokens,
  stripInternalTokensStreaming,
} from "./internal-tokens";

describe("internal control tokens", () => {
  test("removes every supported control token before visitor delivery", () => {
    const text = `before ${INTERNAL_TOKENS.join(" between ")} after`;

    expect(stripInternalTokens(text)).toBe("before  between  between  between  between  after");
  });

  test("withholds a split control token until it completes", () => {
    const state = createStreamingStripState();

    expect(stripInternalTokensStreaming(state, "done [RES")).toEqual({
      emit: "done ",
      tokens: [],
    });
    expect(stripInternalTokensStreaming(state, "OLVED] now")).toEqual({
      emit: " now",
      tokens: ["[RESOLVED]"],
    });
  });

  test("preserves a false token suffix as visitor text", () => {
    const state = createStreamingStripState();

    expect(stripInternalTokensStreaming(state, "price is $5 [")).toEqual({
      emit: "price is $5 ",
      tokens: [],
    });
    expect(stripInternalTokensStreaming(state, "not a token]")).toEqual({
      emit: "[not a token]",
      tokens: [],
    });
  });
});
