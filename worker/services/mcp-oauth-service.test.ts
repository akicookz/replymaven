import { describe, expect, test } from "bun:test";
import {
  getUnknownMcpScopes,
  isMcpOAuthScope,
  normalizeScopeString,
  parseScopeString,
} from "./mcp-oauth-service";

describe("MCP OAuth scopes", () => {
  test("defaults to every supported MCP scope", () => {
    expect(normalizeScopeString(undefined)).toBe(
      "projects:read conversations:reply resources:write",
    );
  });

  test("deduplicates requested scopes while preserving first-seen order", () => {
    expect(
      normalizeScopeString(
        "resources:write projects:read resources:write projects:read",
      ),
    ).toBe("resources:write projects:read");
  });

  test("falls back to read-only when no supported scopes remain", () => {
    expect(normalizeScopeString("unknown:scope another:scope")).toBe(
      "projects:read",
    );
  });

  test("parses normalized scopes into typed scope values", () => {
    expect(parseScopeString("projects:read resources:write")).toEqual([
      "projects:read",
      "resources:write",
    ]);
  });

  test("identifies known and unknown scope values", () => {
    expect(isMcpOAuthScope("projects:read")).toBe(true);
    expect(isMcpOAuthScope("resources:delete")).toBe(false);
  });

  test("reports unknown requested scopes for OAuth error handling", () => {
    expect(
      getUnknownMcpScopes(
        "projects:read resources:delete conversations:reply admin:all",
      ),
    ).toEqual(["resources:delete", "admin:all"]);
  });
});
