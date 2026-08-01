import { describe, expect, test } from "bun:test";
import {
  getUnknownMcpScopes,
  MCP_OAUTH_SCOPES,
  normalizeScopeString,
} from "./mcp-oauth-service";

describe("MCP OAuth scopes", () => {
  test("defaults an omitted scope to every supported MCP scope", () => {
    expect(normalizeScopeString(undefined)).toBe(MCP_OAUTH_SCOPES.join(" "));
  });

  test("falls back to read-only when no supported scopes remain", () => {
    expect(normalizeScopeString("unknown:scope another:scope")).toBe(
      "projects:read",
    );
  });

  test("reports unknown requested scopes for OAuth error handling", () => {
    expect(
      getUnknownMcpScopes("projects:read resources:delete admin:all"),
    ).toEqual(["resources:delete", "admin:all"]);
  });
});
