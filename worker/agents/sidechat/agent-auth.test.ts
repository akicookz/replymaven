import { describe, expect, test } from "bun:test";
import type {
  SidechatChildClaims,
  SidechatParentClaims,
} from "../../../shared/sidechat-agent";
import {
  authorizeParentAgentRequest,
  authorizeSidechatAgentRouteRequest,
  authorizeSubAgentRequest,
  readVerifiedSidechatClaims,
  signSidechatToken,
  toSidechatChildName,
  verifySidechatToken,
} from "./agent-auth";

const secret = "task-2-test-secret-with-at-least-32-bytes";
const now = 1_786_294_800;

function parentClaims(
  overrides: Partial<SidechatParentClaims> = {},
): SidechatParentClaims {
  return {
    userId: "user-1",
    effectiveUserId: "owner-1",
    projectId: "project-1",
    parentName: "project-1",
    role: "owner",
    iat: now,
    exp: now + 120,
    aud: "replymaven-sidechat",
    v: 1,
    scope: "parent",
    ...overrides,
  };
}

function childClaims(
  overrides: Partial<SidechatChildClaims> = {},
): SidechatChildClaims {
  return {
    ...parentClaims(),
    scope: "child",
    conversationId: "conversation-1",
    childName: "sc_conversation-1",
    canSubmit: true,
    canApproveOnce: true,
    canAlwaysAllow: true,
    ...overrides,
  };
}

describe("native Sidechat session tokens", () => {
  test("signs and verifies canonical parent and child claims", async () => {
    const parentToken = await signSidechatToken(parentClaims(), secret);
    const childToken = await signSidechatToken(childClaims(), secret);

    expect(await verifySidechatToken(parentToken, secret, now + 1)).toEqual(
      parentClaims(),
    );
    expect(await verifySidechatToken(childToken, secret, now + 1)).toEqual(
      childClaims(),
    );
    expect(toSidechatChildName("conversation-1")).toBe("sc_conversation-1");
  });

  test("rejects altered, expired, future-issued, and overlong tokens", async () => {
    const token = await signSidechatToken(childClaims(), secret);
    const altered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const future = await signSidechatToken(
      childClaims({ iat: now + 31, exp: now + 120 }),
      secret,
    );
    const overlong = await signSidechatToken(
      childClaims({ exp: now + 121 }),
      secret,
    );

    expect(await verifySidechatToken(altered, secret, now)).toBeNull();
    expect(await verifySidechatToken(token, secret, now + 121)).toBeNull();
    expect(await verifySidechatToken(future, secret, now)).toBeNull();
    expect(await verifySidechatToken(overlong, secret, now)).toBeNull();
  });

  test("rejects invalid identifiers before deriving a child name", () => {
    expect(() => toSidechatChildName("../conversation-1")).toThrow();
    expect(() => toSidechatChildName("conversation/1")).toThrow();
    expect(() => toSidechatChildName("")).toThrow();
  });

  test("authorizes only an exact parent route", async () => {
    const token = await signSidechatToken(parentClaims(), secret);
    const valid = await authorizeParentAgentRequest(
      new Request(`https://app.test/agents/maven-project-agent/project-1?token=${token}`),
      "project-1",
      secret,
      now,
    );
    const mismatch = await authorizeParentAgentRequest(
      new Request(`https://app.test/agents/maven-project-agent/project-2?token=${token}`),
      "project-2",
      secret,
      now,
    );

    expect(valid).toBeInstanceOf(Request);
    expect(readVerifiedSidechatClaims(valid as Request)).toEqual(parentClaims());
    expect(mismatch).toBeInstanceOf(Response);
    expect((mismatch as Response).status).toBe(404);
  });

  test("authorizes only exact child claims and preserves WebSocket headers", async () => {
    const token = await signSidechatToken(childClaims(), secret);
    const request = new Request(
      `https://app.test/agents/maven-project-agent/project-1/sub/maven-chat-agent/sc_conversation-1?token=${token}`,
      {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          "Sec-WebSocket-Key": "test-websocket-key",
          "Sec-WebSocket-Version": "13",
        },
      },
    );
    const valid = await authorizeSubAgentRequest(
      request,
      "project-1",
      "sc_conversation-1",
      secret,
      now,
    );
    const mismatch = await authorizeSubAgentRequest(
      request,
      "project-1",
      "sc_another-conversation",
      secret,
      now,
    );

    expect(valid).toBeInstanceOf(Request);
    const forwarded = valid as Request;
    expect(forwarded.headers.get("upgrade")).toBe("websocket");
    expect(forwarded.headers.get("connection")).toBe("Upgrade");
    expect(forwarded.headers.get("sec-websocket-key")).toBe(
      "test-websocket-key",
    );
    expect(readVerifiedSidechatClaims(forwarded)).toEqual(childClaims());
    expect(mismatch).toBeInstanceOf(Response);
    expect((mismatch as Response).status).toBe(404);
  });

  test("classifies only the exact parent and nested child route shapes", async () => {
    const parentToken = await signSidechatToken(parentClaims(), secret);
    const childToken = await signSidechatToken(childClaims(), secret);
    const parent = await authorizeSidechatAgentRouteRequest(
      new Request(
        `https://app.test/agents/maven-project-agent/project-1?token=${parentToken}`,
      ),
      secret,
      now,
    );
    const child = await authorizeSidechatAgentRouteRequest(
      new Request(
        `https://app.test/agents/maven-project-agent/project-1/sub/maven-chat-agent/sc_conversation-1?token=${childToken}`,
      ),
      secret,
      now,
    );
    const guessedClass = await authorizeSidechatAgentRouteRequest(
      new Request(
        `https://app.test/agents/another-agent/project-1?token=${parentToken}`,
      ),
      secret,
      now,
    );

    expect(parent).toBeInstanceOf(Request);
    expect(child).toBeInstanceOf(Request);
    expect(new URL((child as Request).url).searchParams.get("token")).toBe(
      childToken,
    );
    const parentForwarded = await authorizeSubAgentRequest(
      child as Request,
      "project-1",
      "sc_conversation-1",
      secret,
      now,
    );
    expect(parentForwarded).toBeInstanceOf(Request);
    expect(
      new URL((parentForwarded as Request).url).searchParams.has("token"),
    ).toBe(false);
    expect(guessedClass).toBeInstanceOf(Response);
    expect((guessedClass as Response).status).toBe(404);
  });
});
