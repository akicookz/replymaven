import { describe, expect, mock, test } from "bun:test";
import { type Context } from "hono";
import { type HonoAppContext } from "./types";

const runsMcpFixture = process.env.MCP_SERVER_TEST_FIXTURE === "1";

if (runsMcpFixture) {
  mock.module("cloudflare:email", () => ({
    EmailMessage: class EmailMessage {},
  }));
  mock.module("cloudflare:workers", () => ({
    DurableObject: class DurableObject {},
    RpcTarget: class RpcTarget {},
    WorkerEntrypoint: class WorkerEntrypoint {},
    env: {},
    exports: {},
  }));
}

const handleMcpRequest = runsMcpFixture
  ? (await import("./mcp-server")).handleMcpRequest
  : null;

function createExecutionContext(): ExecutionContext {
  return {
    passThroughOnException() {},
    waitUntil() {},
    props: {},
  };
}

function createAuthenticatedMcpContext(request: Request): Context<HonoAppContext> {
  const user = {
    id: "user-test",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const values = new Map<string, unknown>([
    ["db", {}],
    ["user", user],
    ["effectiveUserId", user.id],
    ["activeRole", "owner"],
    ["activeAccessAllProjects", true],
    ["activeProjectIds", null],
  ]);

  return {
    env: {},
    executionCtx: createExecutionContext(),
    req: {
      raw: request,
      header(name: string) {
        return request.headers.get(name) ?? undefined;
      },
    },
    get(key: string) {
      return values.get(key);
    },
  } as unknown as Context<HonoAppContext>;
}

describe("ReplyMaven inbound MCP server", () => {
  const fixtureTest = runsMcpFixture ? test : test.skip;
  const parentTest = runsMcpFixture ? test.skip : test;

  fixtureTest("initializes the legacy v1 server", async () => {
    const request = new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "regression-test", version: "1.0.0" },
        },
      }),
    });

    if (!handleMcpRequest) throw new Error("MCP fixture did not initialize");
    const response = await handleMcpRequest(
      createAuthenticatedMcpContext(request),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"jsonrpc":"2.0"');
    expect(body).toContain('"name":"ReplyMaven"');
  });

  parentTest(
    "still initializes the legacy v1 server after the Agents upgrade",
    async () => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MCP_SERVER_TEST_FIXTURE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      const output = `${stdout}\n${stderr}`;
      expect(exitCode).toBe(0);
      expect(output).toContain("1 pass");
      expect(output).toContain("0 fail");
    },
  );
});
