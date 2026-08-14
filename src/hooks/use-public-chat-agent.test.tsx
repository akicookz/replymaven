import { describe, expect, test } from "bun:test";
import type { PublicChatSessionResponse } from "../../shared/public-chat-agent";
import {
  buildPublicChatAgentConnectionOptions,
  buildPublicChatOptions,
  fetchPublicChatSession,
  publicChatSessionRefreshInterval,
} from "./use-public-chat-agent";

function session(
  overrides: Partial<PublicChatSessionResponse> = {},
): PublicChatSessionResponse {
  return {
    host: "https://api.replymaven.test",
    parentAgent: "MavenProjectAgent",
    parentName: "project-1",
    childAgent: "MavenChatAgent",
    childName: "pub_conversation-1",
    token: "signed-token",
    expiresAt: 2_000,
    ...overrides,
  };
}

describe("public dashboard Agent client contract", () => {
  test("requests and refreshes the exact dashboard child session", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchPublicChatSession(
      "project / one",
      "conversation / one",
      async (input, init) => {
        requests.push({ input: String(input), init });
        return Response.json(session());
      },
    );

    expect(result.childName).toBe("pub_conversation-1");
    expect(requests).toEqual([{
      input:
        "/api/projects/project%20%2F%20one/conversations/conversation%20%2F%20one/agent-session",
      init: { method: "POST" },
    }]);
    expect(publicChatSessionRefreshInterval(session(), 1_900_000)).toBe(50_000);
    expect(publicChatSessionRefreshInterval(session(), 1_995_000)).toBe(5_000);
    expect(publicChatSessionRefreshInterval(session(), 2_100_000)).toBe(5_000);
  });

  test("connects through the parent to the exact public child", () => {
    expect(buildPublicChatAgentConnectionOptions(session())).toEqual({
      host: "https://api.replymaven.test",
      agent: "MavenProjectAgent",
      name: "project-1",
      sub: [{ agent: "MavenChatAgent", name: "pub_conversation-1" }],
      query: { token: "signed-token" },
      queryDeps: ["signed-token"],
    });
  });

  test("uses a read-only local projection of the server-authoritative transcript", () => {
    expect(buildPublicChatOptions()).toEqual({
      resume: true,
      cancelOnClientAbort: false,
      syncMessagesToServer: false,
    });
  });
});
