import { describe, expect, mock, test } from "bun:test";
import type { SidechatRouteActor } from "./sidechat-agent-handlers";
import {
  handleConnectProjectMcp,
  handleDisconnectProjectMcp,
  handleGetProjectMcp,
  handleGrantProjectToolAlwaysAllow,
  handleMcpOAuthCallback,
  handleRefreshProjectMcp,
  handleUpdateProjectMcpPolicy,
  handleRevokeProjectToolAlwaysAllow,
} from "./project-mcp-handlers";

function actor(role: "owner" | "admin" | "member" = "owner"): SidechatRouteActor {
  return {
    userId: "user-1",
    effectiveUserId: "owner-1",
    role,
    accessAllProjects: role !== "member",
    projectIds: role === "member" ? ["project-1"] : null,
  };
}

function projectService(ownerId = "owner-1") {
  return {
    getProjectById: mock(async (projectId: string) => ({
      id: projectId,
      userId: ownerId,
    })),
  };
}

function parent() {
  return {
    connectMcp: mock(async () => ({
      id: "mcp-connection-1",
      name: "Stripe",
      presetKey: "stripe",
      url: "https://mcp.stripe.com/",
      authMode: "bearer",
      state: "ready",
      tools: [],
    })),
    listMcpConnections: mock(async () => []),
    refreshMcpCatalog: mock(async () => ({
      id: "mcp-connection-1",
      name: "Stripe",
      presetKey: "stripe",
      url: "https://mcp.stripe.com/",
      authMode: "bearer",
      state: "ready",
      tools: [],
    })),
    disconnectMcp: mock(async () => true),
    updateMcpToolPolicy: mock(async () => ({
      id: "mcp-connection-1",
      name: "Stripe",
      presetKey: "stripe",
      url: "https://mcp.stripe.com/",
      authMode: "bearer",
      state: "ready",
      tools: [],
    })),
    grantAlwaysForPendingApproval: mock(async () => true),
    revokeAlwaysAllow: mock(async () => true),
    fetch: mock(async () => new Response("connected", { status: 200 })),
  };
}

function bodyRequest(body: unknown): Request {
  return new Request("https://app.test/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project MCP route authorization", () => {
  test("returns 401 without a session and 404 across tenant boundaries", async () => {
    const getParent = mock(async () => parent());
    const unauthorized = await handleGetProjectMcp({
      actor: null,
      projectId: "project-1",
      projectService: projectService(),
      getParent,
    });
    const crossTenant = await handleGetProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService("someone-else"),
      getParent,
    });

    expect(unauthorized.status).toBe(401);
    expect(crossTenant.status).toBe(404);
    expect(getParent).not.toHaveBeenCalled();
  });

  test("allows scoped members to list but not mutate", async () => {
    const target = parent();
    const getParent = mock(async () => target);
    const listed = await handleGetProjectMcp({
      actor: actor("member"),
      projectId: "project-1",
      projectService: projectService(),
      getParent,
    });
    const connected = await handleConnectProjectMcp({
      actor: actor("member"),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({ presetKey: "stripe", authMode: "oauth" }),
      callbackHost: "https://app.test",
      getParent,
    });

    expect(listed.status).toBe(200);
    expect(connected.status).toBe(403);
    expect(target.connectMcp).not.toHaveBeenCalled();
  });
});

describe("project MCP connection handlers", () => {
  test("persists Always allow only for an owner or admin exact pending approval", async () => {
    const target = parent();
    const ownerResponse = await handleGrantProjectToolAlwaysAllow({
      actor: actor("owner"),
      projectId: "project-1",
      conversationId: "conversation-1",
      approvalId: "approval-1",
      request: bodyRequest({ toolCallId: "call-1" }),
      projectService: projectService(),
      getParent: async () => target,
    });
    const memberResponse = await handleGrantProjectToolAlwaysAllow({
      actor: actor("member"),
      projectId: "project-1",
      conversationId: "conversation-1",
      approvalId: "approval-1",
      request: bodyRequest({ toolCallId: "call-1" }),
      projectService: projectService(),
      getParent: async () => target,
    });

    expect(ownerResponse.status).toBe(204);
    expect(target.grantAlwaysForPendingApproval).toHaveBeenCalledWith(
      "conversation-1",
      "user-1",
      "approval-1",
      "call-1",
    );
    expect(memberResponse.status).toBe(403);
    expect(target.grantAlwaysForPendingApproval).toHaveBeenCalledTimes(1);
  });

  test("rejects stale approval grants and revokes only an exact scope", async () => {
    const target = parent();
    target.grantAlwaysForPendingApproval = mock(async () => false);
    const stale = await handleGrantProjectToolAlwaysAllow({
      actor: actor("admin"),
      projectId: "project-1",
      conversationId: "conversation-1",
      approvalId: "approval-stale",
      request: bodyRequest({ toolCallId: "call-stale" }),
      projectService: projectService(),
      getParent: async () => target,
    });
    const revoked = await handleRevokeProjectToolAlwaysAllow({
      actor: actor("owner"),
      projectId: "project-1",
      request: bodyRequest({
        connectionId: "mcp-connection-1",
        toolName: "write_customer",
        catalogFingerprint: "a".repeat(64),
      }),
      projectService: projectService(),
      getParent: async () => target,
    });

    expect(stale.status).toBe(409);
    expect(revoked.status).toBe(204);
    expect(target.revokeAlwaysAllow).toHaveBeenCalledWith(
      "mcp-connection-1",
      "write_customer",
      "a".repeat(64),
    );
  });

  test("resolves an OAuth-only preset without accepting browser credentials", async () => {
    const target = parent();
    const response = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({
        presetKey: "stripe",
        authMode: "oauth",
      }),
      callbackHost: "https://app.test",
      getParent: async () => target,
    });

    expect(response.status).toBe(201);
    expect(target.connectMcp).toHaveBeenCalledWith({
      name: "Stripe",
      presetKey: "stripe",
      url: "https://mcp.stripe.com/",
      authMode: "oauth",
      callbackHost: "https://app.test",
      callbackPath: "/api/sidechat/mcp/oauth/project-1",
    });
    const text = await response.text();
    expect(text).not.toContain("bearerToken");
    expect(text).not.toContain("headers");
  });

  test.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("accepts the trusted local callback origin %s", async (callbackHost) => {
    const target = parent();
    const response = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({ presetKey: "attio", authMode: "oauth" }),
      callbackHost,
      getParent: async () => target,
    });

    expect(response.status).toBe(201);
    expect(target.connectMcp).toHaveBeenCalledWith(
      expect.objectContaining({ callbackHost }),
    );
  });

  test.each([
    "http://mcp.example.com",
    "http://192.168.1.10:5173",
    "https://metadata.google.internal",
  ])("rejects the unsafe callback origin %s", async (callbackHost) => {
    const target = parent();
    const response = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({ presetKey: "attio", authMode: "oauth" }),
      callbackHost,
      getParent: async () => target,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "invalid_callback_host" });
    expect(target.connectMcp).not.toHaveBeenCalled();
  });

  test("rejects unsupported preset auth and unsafe custom URLs", async () => {
    const target = parent();
    const posthogBearer = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({
        presetKey: "posthog",
        authMode: "bearer",
        bearerToken: "must-not-be-used-for-presets",
      }),
      callbackHost: "https://app.test",
      getParent: async () => target,
    });
    const unsafe = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({
        name: "Local",
        url: "https://127.0.0.1/mcp",
        authMode: "none",
      }),
      callbackHost: "https://app.test",
      getParent: async () => target,
    });

    expect(posthogBearer.status).toBe(400);
    expect(unsafe.status).toBe(400);
    expect(target.connectMcp).not.toHaveBeenCalled();
  });

  test("rejects credentials that do not belong to the selected auth mode", async () => {
    const target = parent();
    const response = await handleConnectProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({
        presetKey: "attio",
        authMode: "oauth",
        bearerToken: "should-not-cross-the-agent-boundary",
      }),
      callbackHost: "https://app.test",
      getParent: async () => target,
    });

    expect(response.status).toBe(400);
    expect(target.connectMcp).not.toHaveBeenCalled();
  });

  test("returns the native OAuth authorization URL without provider errors", async () => {
    const target = parent();
    target.connectMcp = mock(async () => ({
      id: "mcp-attio",
      name: "Attio",
      presetKey: "attio",
      url: "https://mcp.attio.com/mcp",
      authMode: "oauth",
      state: "authenticating",
      authUrl: "https://attio.com/oauth/authorize?safe=1",
      tools: [],
    }));
    const response = await handleConnectProjectMcp({
      actor: actor("admin"),
      projectId: "project-1",
      projectService: projectService(),
      request: bodyRequest({ presetKey: "attio", authMode: "oauth" }),
      callbackHost: "https://app.test",
      getParent: async () => target,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        state: "authenticating",
        authUrl: "https://attio.com/oauth/authorize?safe=1",
      },
    });
  });

  test("normalizes untrusted native state instead of returning it", async () => {
    const target = parent();
    target.listMcpConnections = mock(async () => [
      {
        id: "mcp-connection-1",
        name: "Server",
        presetKey: null,
        url: "https://mcp.example.com/",
        authMode: "none",
        state: "provider leaked a secret here",
        tools: [],
      },
    ]);
    const response = await handleGetProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      getParent: async () => target,
    });

    expect(await response.text()).not.toContain("provider leaked");
  });

  test("returns only the safe MCP discovery issue code", async () => {
    const target = parent();
    target.listMcpConnections = mock(async () => [
      {
        id: "mcp-posthog",
        name: "PostHog",
        presetKey: "posthog",
        url: "https://mcp.posthog.com/mcp",
        authMode: "oauth",
        state: "connected",
        issue: "tool_discovery_failed",
        tools: [],
      },
    ]);
    const response = await handleGetProjectMcp({
      actor: actor(),
      projectId: "project-1",
      projectService: projectService(),
      getParent: async () => target,
    });

    await expect(response.json()).resolves.toMatchObject({
      connections: [{ issue: "tool_discovery_failed" }],
    });
  });

  test("exposes management capability without weakening server authorization", async () => {
    const ownerResponse = await handleGetProjectMcp({
      actor: actor("owner"),
      projectId: "project-1",
      projectService: projectService(),
      getParent: async () => parent(),
    });
    const memberResponse = await handleGetProjectMcp({
      actor: actor("member"),
      projectId: "project-1",
      projectService: projectService(),
      getParent: async () => parent(),
    });

    expect(await ownerResponse.json()).toMatchObject({ canManage: true });
    expect(await memberResponse.json()).toMatchObject({ canManage: false });
  });

  test("refreshes, updates policy, and disconnects exact project connections", async () => {
    const target = parent();
    const common = {
      actor: actor("admin"),
      projectId: "project-1",
      projectService: projectService(),
      connectionId: "mcp-connection-1",
      getParent: async () => target,
    };
    const refreshed = await handleRefreshProjectMcp(common);
    const updated = await handleUpdateProjectMcpPolicy({
      ...common,
      request: bodyRequest({
        tools: [
          {
            toolName: "find_customer",
            catalogFingerprint: "a".repeat(64),
            enabled: true,
            access: "read",
          },
        ],
      }),
    });
    const disconnected = await handleDisconnectProjectMcp(common);

    expect(refreshed.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(disconnected.status).toBe(204);
    expect(target.refreshMcpCatalog).toHaveBeenCalledWith("mcp-connection-1");
    expect(target.updateMcpToolPolicy).toHaveBeenCalledWith(
      "mcp-connection-1",
      [
        {
          toolName: "find_customer",
          catalogFingerprint: "a".repeat(64),
          enabled: true,
          access: "read",
        },
      ],
    );
    expect(target.disconnectMcp).toHaveBeenCalledWith("mcp-connection-1");
  });

  test("accepts a PostHog-sized tool policy update", async () => {
    const target = parent();
    const tools = Array.from({ length: 336 }, (_, index) => ({
      toolName: `posthog_tool_${index}`,
      catalogFingerprint: index.toString(16).padStart(64, "0"),
      enabled: index === 0,
      access: "read" as const,
    }));

    const response = await handleUpdateProjectMcpPolicy({
      actor: actor("owner"),
      projectId: "project-1",
      projectService: projectService(),
      connectionId: "mcp-posthog",
      request: bodyRequest({ tools }),
      getParent: async () => target,
    });

    expect(response.status).toBe(200);
    expect(target.updateMcpToolPolicy).toHaveBeenCalledWith(
      "mcp-posthog",
      tools,
    );
  });
});

describe("project MCP OAuth callback", () => {
  test("forwards the original callback only to the named project Agent", async () => {
    const target = parent();
    const request = new Request(
      "https://app.test/api/sidechat/mcp/oauth/project-1?code=code&state=state",
    );
    const response = await handleMcpOAuthCallback({
      projectId: "project-1",
      request,
      getParent: async () => target,
    });

    expect(response.status).toBe(200);
    expect(target.fetch).toHaveBeenCalledWith(request);
  });
});
