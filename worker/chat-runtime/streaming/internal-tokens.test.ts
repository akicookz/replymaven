import { describe, expect, test } from "bun:test";
import {
  INTERNAL_TOKENS,
  createStreamingStripState,
  detectInternalTokens,
  flushStreamingStripState,
  stripInternalTokens,
  stripInternalTokensStreaming,
} from "./internal-tokens";

describe("internal-tokens", () => {
  describe("stripInternalTokens", () => {
    test("returns empty string untouched", () => {
      expect(stripInternalTokens("")).toBe("");
    });

    test("returns text without any tokens untouched", () => {
      expect(stripInternalTokens("Hello, how can I help?")).toBe(
        "Hello, how can I help?",
      );
    });

    test("strips HANDOFF_REQUESTED token", () => {
      const input =
        "Got it — let me connect you with an engineer. [HANDOFF_REQUESTED]";
      expect(stripInternalTokens(input)).toBe(
        "Got it — let me connect you with an engineer. ",
      );
    });

    test("strips RESOLVED token", () => {
      expect(stripInternalTokens("[RESOLVED]")).toBe("");
    });

    test("strips multiple tokens in one pass", () => {
      const input = "[HANDOFF_REQUESTED] thanks [RESOLVED]";
      expect(stripInternalTokens(input)).toBe(" thanks ");
    });

    test("strips repeated occurrences of the same token", () => {
      const input = "a[RESOLVED]b[RESOLVED]c";
      expect(stripInternalTokens(input)).toBe("abc");
    });

    test("strips INQUIRY_CREATED and INQUIRY_UPDATED tokens", () => {
      expect(stripInternalTokens("done [INQUIRY_CREATED]")).toBe("done ");
      expect(stripInternalTokens("done [INQUIRY_UPDATED]")).toBe("done ");
    });

    test("strips CONTACT_REQUESTED token", () => {
      expect(stripInternalTokens("please share [CONTACT_REQUESTED]")).toBe(
        "please share ",
      );
    });
  });

  describe("detectInternalTokens", () => {
    test("reports no tokens for clean text", () => {
      const result = detectInternalTokens("Hi there");
      expect(result.cleaned).toBe("Hi there");
      expect(result.tokens).toEqual([]);
    });

    test("reports single token", () => {
      const result = detectInternalTokens("Bye [RESOLVED]");
      expect(result.cleaned).toBe("Bye ");
      expect(result.tokens).toEqual(["[RESOLVED]"]);
    });

    test("reports multiple distinct tokens", () => {
      const result = detectInternalTokens(
        "[HANDOFF_REQUESTED] and [INQUIRY_CREATED]",
      );
      expect(result.cleaned).toBe(" and ");
      expect(result.tokens).toContain("[HANDOFF_REQUESTED]");
      expect(result.tokens).toContain("[INQUIRY_CREATED]");
    });
  });

  describe("stripInternalTokensStreaming", () => {
    test("emits full delta when no token fragments are present", () => {
      const state = createStreamingStripState();
      const result = stripInternalTokensStreaming(state, "Hello world");
      expect(result.emit).toBe("Hello world");
      expect(result.tokens).toEqual([]);
      expect(state.tail).toBe("");
    });

    test("strips a complete token delivered in one delta", () => {
      const state = createStreamingStripState();
      const result = stripInternalTokensStreaming(
        state,
        "Hi [RESOLVED] there",
      );
      expect(result.emit).toBe("Hi  there");
      expect(result.tokens).toEqual(["[RESOLVED]"]);
    });

    test("withholds partial token suffix until the next delta completes it", () => {
      const state = createStreamingStripState();

      const r1 = stripInternalTokensStreaming(state, "done [RES");
      expect(r1.emit).toBe("done ");
      expect(r1.tokens).toEqual([]);
      expect(state.tail).toBe("[RES");

      const r2 = stripInternalTokensStreaming(state, "OLVED]");
      expect(r2.emit).toBe("");
      expect(r2.tokens).toEqual(["[RESOLVED]"]);
      expect(state.tail).toBe("");
    });

    test("handles token split across three deltas", () => {
      const state = createStreamingStripState();

      const r1 = stripInternalTokensStreaming(state, "hello [HAN");
      expect(r1.emit).toBe("hello ");
      expect(r1.tokens).toEqual([]);

      const r2 = stripInternalTokensStreaming(state, "DOFF_REQUE");
      expect(r2.emit).toBe("");
      expect(r2.tokens).toEqual([]);

      const r3 = stripInternalTokensStreaming(state, "STED] bye");
      expect(r3.emit).toBe(" bye");
      expect(r3.tokens).toEqual(["[HANDOFF_REQUESTED]"]);
    });

    test("does not withhold an unrelated trailing character", () => {
      const state = createStreamingStripState();
      const result = stripInternalTokensStreaming(
        state,
        "normal text with a trailing period.",
      );
      expect(result.emit).toBe("normal text with a trailing period.");
      expect(state.tail).toBe("");
    });

    test("recognizes a bracket-only suffix as a potential token start", () => {
      const state = createStreamingStripState();

      const r1 = stripInternalTokensStreaming(state, "ok [");
      expect(r1.emit).toBe("ok ");
      expect(state.tail).toBe("[");

      const r2 = stripInternalTokensStreaming(state, "RESOLVED]");
      expect(r2.emit).toBe("");
      expect(r2.tokens).toEqual(["[RESOLVED]"]);
    });

    test("false suffix start that does not complete is eventually flushed", () => {
      const state = createStreamingStripState();

      const r1 = stripInternalTokensStreaming(state, "price is $5.00 [");
      expect(r1.emit).toBe("price is $5.00 ");
      expect(state.tail).toBe("[");

      const r2 = stripInternalTokensStreaming(state, "not a token]");
      expect(r2.emit).toBe("[not a token]");
      expect(state.tail).toBe("");
    });

    test("empty delta returns empty emit", () => {
      const state = createStreamingStripState();
      const result = stripInternalTokensStreaming(state, "");
      expect(result.emit).toBe("");
      expect(result.tokens).toEqual([]);
    });

    test("strips multiple tokens across deltas", () => {
      const state = createStreamingStripState();

      const r1 = stripInternalTokensStreaming(
        state,
        "step 1 [INQUIRY_CREATED] step 2 [RES",
      );
      expect(r1.emit).toBe("step 1  step 2 ");
      expect(r1.tokens).toEqual(["[INQUIRY_CREATED]"]);

      const r2 = stripInternalTokensStreaming(state, "OLVED] done");
      expect(r2.emit).toBe(" done");
      expect(r2.tokens).toEqual(["[RESOLVED]"]);
    });
  });

  describe("flushStreamingStripState", () => {
    test("flushes any held-back tail that did not complete a token", () => {
      const state = createStreamingStripState();
      stripInternalTokensStreaming(state, "final text [");
      expect(state.tail).toBe("[");

      const flushed = flushStreamingStripState(state);
      expect(flushed.emit).toBe("[");
      expect(state.tail).toBe("");
    });

    test("flushes a completed token that is still in tail", () => {
      const state = createStreamingStripState();
      state.tail = "[RESOLVED]";
      const flushed = flushStreamingStripState(state);
      expect(flushed.emit).toBe("");
      expect(flushed.tokens).toEqual(["[RESOLVED]"]);
    });

    test("no-op flush on clean state", () => {
      const state = createStreamingStripState();
      const flushed = flushStreamingStripState(state);
      expect(flushed.emit).toBe("");
      expect(flushed.tokens).toEqual([]);
    });
  });

  test("INTERNAL_TOKENS covers the five known runtime tokens", () => {
    expect(INTERNAL_TOKENS).toContain("[HANDOFF_REQUESTED]");
    expect(INTERNAL_TOKENS).toContain("[RESOLVED]");
    expect(INTERNAL_TOKENS).toContain("[INQUIRY_CREATED]");
    expect(INTERNAL_TOKENS).toContain("[INQUIRY_UPDATED]");
    expect(INTERNAL_TOKENS).toContain("[CONTACT_REQUESTED]");
  });
});
