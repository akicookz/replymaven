import { describe, expect, test } from "bun:test";
import type { PublicChatChildClaims } from "../../../../shared/public-chat-agent";
import { signSidechatToken } from "../../sidechat/agent-auth";
import {
  authorizePublicSubAgentRequest,
  readVerifiedPublicChatClaims,
  signPublicChatToken,
  verifyPublicChatToken,
} from "./public-agent-auth";

const secret = "public-agent-auth-test-secret-32-bytes";
const now = 1_786_294_800;

function visitorClaims(
  overrides: Partial<PublicChatChildClaims> = {},
): PublicChatChildClaims {
  return {
    v: 1,
    aud: "replymaven-public-chat",
    scope: "child",
    actor: "visitor",
    projectId: "project-1",
    parentName: "project-1",
    conversationId: "conversation-1",
    childName: "pub_conversation-1",
    visitorId: "visitor-1",
    canSubmitVisitor: true,
    canRead: true,
    iat: now,
    exp: now + 120,
    ...overrides,
  };
}

describe("public Agent session tokens", () => {
  test("signs and verifies exact visitor and dashboard claims", async () => {
    const visitor = visitorClaims();
    const dashboard = visitorClaims({
      actor: "dashboard",
      visitorId: null,
      canSubmitVisitor: false,
    });

    expect(await verifyPublicChatToken(
      await signPublicChatToken(visitor, secret),
      secret,
      now + 1,
    )).toEqual(visitor);
    expect(await verifyPublicChatToken(
      await signPublicChatToken(dashboard, secret),
      secret,
      now + 1,
    )).toEqual(dashboard);
  });

  test("rejects expired, cross-project, wrong-child, and wrong-visitor claims", async () => {
    const token = await signPublicChatToken(visitorClaims(), secret);
    expect(await verifyPublicChatToken(token, secret, now + 121)).toBeNull();
    for (const claims of [
      visitorClaims({ parentName: "project-2" }),
      visitorClaims({ childName: "pub_conversation-2" }),
      visitorClaims({ visitorId: null }),
      visitorClaims({ canSubmitVisitor: false }),
      visitorClaims({ actor: "dashboard", visitorId: "visitor-1" }),
      visitorClaims({ actor: "dashboard", canSubmitVisitor: true }),
    ]) {
      await expect(signPublicChatToken(claims, secret)).rejects.toThrow(
        "Invalid public chat claims",
      );
    }
  });

  test("rejects the Sidechat audience and body-only claims", async () => {
    const sidechat = await signSidechatToken({
      userId: "user-1",
      effectiveUserId: "owner-1",
      projectId: "project-1",
      parentName: "project-1",
      role: "owner",
      iat: now,
      exp: now + 120,
      aud: "replymaven-sidechat",
      v: 1,
      scope: "child",
      conversationId: "conversation-1",
      childName: "sc_conversation-1",
      canSubmit: true,
      canApproveOnce: true,
      canAlwaysAllow: true,
    }, secret);
    expect(await verifyPublicChatToken(sidechat, secret, now)).toBeNull();
    expect(readVerifiedPublicChatClaims(new Request("https://app.test", {
      method: "POST",
      body: JSON.stringify({ publicChatActor: visitorClaims() }),
    }))).toBeNull();
  });

  test("authorizes only the exact project, child, and expected visitor", async () => {
    const claims = visitorClaims();
    const token = await signPublicChatToken(claims, secret);
    const request = new Request(
      `https://app.test/agents/maven-project-agent/project-1/sub/maven-chat-agent/pub_conversation-1?token=${token}`,
      { headers: { Upgrade: "websocket" } },
    );
    const valid = await authorizePublicSubAgentRequest(
      request,
      "project-1",
      "pub_conversation-1",
      secret,
      { expectedVisitorId: "visitor-1", now },
    );
    expect(valid).toBeInstanceOf(Request);
    expect(readVerifiedPublicChatClaims(valid as Request)).toEqual(claims);
    expect(new URL((valid as Request).url).searchParams.has("token")).toBe(false);

    for (const [parentName, childName, expectedVisitorId] of [
      ["project-2", "pub_conversation-1", "visitor-1"],
      ["project-1", "pub_conversation-2", "visitor-1"],
      ["project-1", "pub_conversation-1", "visitor-2"],
    ] as const) {
      const rejected = await authorizePublicSubAgentRequest(
        request,
        parentName,
        childName,
        secret,
        { expectedVisitorId, now },
      );
      expect(rejected).toBeInstanceOf(Response);
      expect((rejected as Response).status).toBe(404);
    }
  });
});
