import { describe, expect, test } from "bun:test";
import { buildMcpAuthenticateHeader } from "./mcp-oauth";

describe("buildMcpAuthenticateHeader", () => {
  test("advertises protected-resource metadata and supported scopes", () => {
    expect(buildMcpAuthenticateHeader("https://replymaven.com")).toBe(
      'Bearer resource_metadata="https://replymaven.com/.well-known/oauth-protected-resource", scope="projects:read conversations:reply resources:write"',
    );
  });
});
