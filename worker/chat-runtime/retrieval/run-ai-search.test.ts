import { describe, expect, test, beforeEach } from "bun:test";
import {
  hybridUnavailableProjects,
  isHybridRetrievalUnavailableError,
  resolveRetrievalType,
} from "./run-ai-search";

beforeEach(() => {
  hybridUnavailableProjects.clear();
});

describe("isHybridRetrievalUnavailableError", () => {
  test("returns true for hybrid unavailable error with both keywords", () => {
    const error = new Error(
      "retrieval_type 'hybrid' is not available because keyword indexing is disabled for this project",
    );
    expect(isHybridRetrievalUnavailableError(error)).toBe(true);
  });

  test("returns false when only one keyword is present", () => {
    const error = new Error("retrieval_type 'hybrid' is not available");
    expect(isHybridRetrievalUnavailableError(error)).toBe(false);
  });

  test("returns false for unrelated errors", () => {
    const error = new Error("Network timeout");
    expect(isHybridRetrievalUnavailableError(error)).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isHybridRetrievalUnavailableError("string error")).toBe(false);
    expect(isHybridRetrievalUnavailableError(null)).toBe(false);
    expect(isHybridRetrievalUnavailableError(42)).toBe(false);
  });
});

describe("resolveRetrievalType", () => {
  test("returns hybrid by default for unknown projects", async () => {
    expect(await resolveRetrievalType("project-abc")).toBe("hybrid");
  });

  test("returns vector after project is marked as hybrid-unavailable", async () => {
    hybridUnavailableProjects.add("project-abc");
    expect(await resolveRetrievalType("project-abc")).toBe("vector");
  });

  test("does not affect other projects", async () => {
    hybridUnavailableProjects.add("project-abc");
    expect(await resolveRetrievalType("project-xyz")).toBe("hybrid");
  });

  test("returns hybrid again after cache is cleared", async () => {
    hybridUnavailableProjects.add("project-abc");
    expect(await resolveRetrievalType("project-abc")).toBe("vector");

    hybridUnavailableProjects.clear();
    expect(await resolveRetrievalType("project-abc")).toBe("hybrid");
  });

  test("uses KV cache to prime in-memory set on cold isolates", async () => {
    const kvStore = new Map<string, string>();
    kvStore.set("hybrid_unavailable:project-cold", "1");
    const kv = {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async () => {},
    } as unknown as KVNamespace;

    expect(await resolveRetrievalType("project-cold", kv)).toBe("vector");
    expect(hybridUnavailableProjects.has("project-cold")).toBe(true);
  });

  test("falls back to hybrid when KV has no entry", async () => {
    const kv = {
      get: async () => null,
      put: async () => {},
    } as unknown as KVNamespace;

    expect(await resolveRetrievalType("project-fresh", kv)).toBe("hybrid");
    expect(hybridUnavailableProjects.has("project-fresh")).toBe(false);
  });
});
