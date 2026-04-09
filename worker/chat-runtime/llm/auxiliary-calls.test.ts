import { describe, expect, test } from "bun:test";
import { fallbackClassifySupportTurn } from "./auxiliary-calls";

describe("auxiliary-calls - industry agnostic", () => {
  describe("fallbackClassifySupportTurn", () => {
    test("fallback handles unclear messages by asking for clarification", () => {
      const result = fallbackClassifySupportTurn(
        "my project timeline isn't updating"
      );
      // The fallback is simple and can't determine context without LLM
      expect(result.intent).toBe("clarify");
      expect(result.followUpQuestion).toBeTruthy();
    });

    test("fallback recognizes explicit handoff request", () => {
      const result = fallbackClassifySupportTurn(
        "I need to speak with a human"
      );
      expect(result.intent).toBe("handoff");
      expect(result.retrievalQueries).toEqual([]);
    });

    test("fallback recognizes policy/pricing questions", () => {
      const result = fallbackClassifySupportTurn(
        "what are your refund policies"
      );
      expect(result.intent).toBe("policy");
      expect(result.retrievalQueries).toContain("what are your refund policies");
    });

    test("fallback recognizes how-to questions", () => {
      const result = fallbackClassifySupportTurn(
        "how do I configure settings"
      );
      expect(result.intent).toBe("how_to");
      expect(result.retrievalQueries).toContain("how do I configure settings");
    });

    test("fallback handles account lookup requests", () => {
      const result = fallbackClassifySupportTurn(
        "check my order status"
      );
      expect(result.intent).toBe("lookup");
      expect(result.retrievalQueries).toEqual([]);
    });

    test("fallback asks for clarification on vague messages", () => {
      const result = fallbackClassifySupportTurn(
        "help"
      );
      expect(result.intent).toBe("clarify");
      expect(result.followUpQuestion).toBeTruthy();
    });
  });
});