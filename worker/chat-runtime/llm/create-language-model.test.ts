import { describe, expect, test } from "bun:test";
import { isProviderLikeError } from "./create-language-model";

describe("isProviderLikeError", () => {
  test("returns true for AI_NoObjectGeneratedError so fallback is attempted", () => {
    const error = new Error("model did not produce a valid structured output");
    error.name = "AI_NoObjectGeneratedError";
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for AI_NoOutputGeneratedError so fallback is attempted", () => {
    const error = new Error("No output generated.");
    error.name = "AI_NoOutputGeneratedError";
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for rate limit errors", () => {
    const error = new Error("Rate limit exceeded");
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for timeout errors", () => {
    const error = new Error("Request timed out");
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for 503 service unavailable", () => {
    const error = new Error("503 Service Unavailable");
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for fetch failed errors", () => {
    const error = new Error("fetch failed");
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for invalid API key errors", () => {
    const error = new Error("Invalid API key provided");
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns true for objects with status >= 400", () => {
    const error = { status: 500, message: "Internal Server Error" };
    expect(isProviderLikeError(error)).toBe(true);
  });

  test("returns false for generic errors", () => {
    const error = new Error("Something went wrong");
    expect(isProviderLikeError(error)).toBe(false);
  });

  test("returns false for Zod validation errors", () => {
    const error = new Error("Expected string, received number");
    error.name = "ZodError";
    expect(isProviderLikeError(error)).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isProviderLikeError(null)).toBe(false);
    expect(isProviderLikeError(undefined)).toBe(false);
  });

  test("AI_NoObjectGeneratedError with provider-like message also returns true", () => {
    const error = new Error("API timeout while generating object");
    error.name = "AI_NoObjectGeneratedError";
    expect(isProviderLikeError(error)).toBe(true);
  });
});
