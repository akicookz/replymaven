import { describe, expect, test } from "bun:test";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/client";
import {
  authorizationRequestsNonReadScope,
  restrictOAuthDiscoveryToReadScopes,
} from "./mcp-oauth-provider";

function discoveryState(): OAuthDiscoveryState {
  return {
    authorizationServerUrl: "https://oauth.posthog.com",
    resourceMetadata: {
      resource: "https://mcp.posthog.com/mcp",
      authorization_servers: ["https://oauth.posthog.com"],
      scopes_supported: [
        "openid",
        "profile",
        "email",
        "project:read",
        "project:write",
        "query:read",
        "person:write",
      ],
    },
  };
}

describe("read-only MCP OAuth", () => {
  test("mutates fresh discovery to OIDC and read scopes before authorization", () => {
    const state = discoveryState();

    const scope = restrictOAuthDiscoveryToReadScopes(state);

    expect(scope).toBe("openid profile email project:read query:read");
    expect(state.resourceMetadata?.scopes_supported).toEqual([
      "openid",
      "profile",
      "email",
      "project:read",
      "query:read",
    ]);
  });

  test("rejects authorization redirects that try to add a non-read scope", () => {
    expect(authorizationRequestsNonReadScope(new URL(
      "https://oauth.posthog.com/authorize?scope=openid%20project%3Aread",
    ))).toBe(false);
    expect(authorizationRequestsNonReadScope(new URL(
      "https://oauth.posthog.com/authorize?scope=openid%20project%3Aread%20project%3Awrite",
    ))).toBe(true);
  });
});
