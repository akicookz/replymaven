import { describe, expect, mock, test } from "bun:test";
import type {
  SidechatActorClaims,
  SidechatSessionResponse,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import { verifySidechatToken } from "../agents/sidechat/agent-auth";
import {
  handleCreateSidechatSession,
  handleGetSidechatSummaries,
  type SidechatRouteActor,
} from "./sidechat-agent-handlers";

const secret = "task-2-test-secret-with-at-least-32-bytes";
const now = 1_786_294_800;

function actor(
  overrides: Partial<SidechatRouteActor> = {},
): SidechatRouteActor {
  return {
    userId: "user-1",
    effectiveUserId: "owner-1",
    role: "owner",
    accessAllProjects: true,
    projectIds: null,
    ...overrides,
  };
}

function createOptions(overrides: Record<string, unknown> = {}) {
  const defaultParent = {
    registerSidechat: mock(async () => ({
      childName: "sc_conversation-1",
      created: true,
    })),
    getSidechatRegistration: mock(async () => null),
  };
  const parent =
    "parent" in overrides
      ? (overrides.parent as typeof defaultParent)
      : defaultParent;
  const remainingOverrides = { ...overrides };
  delete remainingOverrides.parent;
  return {
    actor: actor(),
    projectId: "project-1",
    conversationId: "conversation-1",
    secret,
    now,
    projectService: {
      getProjectById: mock(async () => ({
        id: "project-1",
        userId: "owner-1",
      })),
    },
    chatService: {
      getConversationById: mock(async () => ({
        id: "conversation-1",
        projectId: "project-1",
        archivedAt: null,
      })),
    },
    getParent: mock(async () => parent),
    parent,
    ...remainingOverrides,
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("create native Sidechat session", () => {
  test.each(["owner", "admin", "member"] as const)(
    "allows an authorized %s and signs exact role permissions",
    async (role) => {
      const options = createOptions({
        actor: actor({
          role,
          accessAllProjects: role !== "member",
          projectIds: role === "member" ? ["project-1"] : null,
        }),
      });
      const response = await handleCreateSidechatSession(options);
      const body = await responseJson<SidechatSessionResponse>(response);
      const claims = (await verifySidechatToken(
        body.token,
        secret,
        now,
      )) as SidechatActorClaims;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        parentAgent: "MavenProjectAgent",
        parentName: "project-1",
        childAgent: "MavenChatAgent",
        childName: "sc_conversation-1",
        created: true,
        expiresAt: now + 120,
      });
      expect(claims).toMatchObject({
        scope: "child",
        role,
        projectId: "project-1",
        conversationId: "conversation-1",
        canSubmit: true,
        canApproveOnce: true,
        canAlwaysAllow: role !== "member",
      });
    },
  );

  test("returns 401 for a signed-out visitor", async () => {
    const options = createOptions({ actor: null });
    const response = await handleCreateSidechatSession(options);
    expect(response.status).toBe(401);
    expect(options.getParent).not.toHaveBeenCalled();
    expect(options.parent.registerSidechat).not.toHaveBeenCalled();
  });

  test("hides an unrelated scoped member project", async () => {
    const options = createOptions({
      actor: actor({
        role: "member",
        accessAllProjects: false,
        projectIds: ["project-2"],
      }),
    });
    const response = await handleCreateSidechatSession(options);
    expect(response.status).toBe(404);
    expect(options.projectService.getProjectById).not.toHaveBeenCalled();
    expect(options.getParent).not.toHaveBeenCalled();
    expect(options.parent.registerSidechat).not.toHaveBeenCalled();
  });

  test("hides wrong-owner projects and cross-project conversations", async () => {
    const wrongOwner = createOptions({
      projectService: {
        getProjectById: mock(async () => ({
          id: "project-1",
          userId: "another-owner",
        })),
      },
    });
    const wrongProject = createOptions({
      chatService: { getConversationById: mock(async () => null) },
    });

    expect((await handleCreateSidechatSession(wrongOwner)).status).toBe(404);
    expect((await handleCreateSidechatSession(wrongProject)).status).toBe(404);
    expect(wrongOwner.parent.registerSidechat).not.toHaveBeenCalled();
    expect(wrongProject.parent.registerSidechat).not.toHaveBeenCalled();
    expect(wrongOwner.getParent).not.toHaveBeenCalled();
    expect(wrongProject.getParent).not.toHaveBeenCalled();
  });

  test("rejects archived creation but opens an existing child read-only", async () => {
    const archivedConversation = {
      getConversationById: mock(async () => ({
        id: "conversation-1",
        projectId: "project-1",
        archivedAt: new Date("2026-08-11T00:00:00.000Z"),
      })),
    };
    const absent = createOptions({ chatService: archivedConversation });
    const existing = createOptions({
      chatService: archivedConversation,
      parent: {
        registerSidechat: mock(async () => {
          throw new Error("must not create");
        }),
        getSidechatRegistration: mock(async () => ({
          childName: "sc_conversation-1",
        })),
      },
    });

    const absentResponse = await handleCreateSidechatSession(absent);
    const existingResponse = await handleCreateSidechatSession(existing);
    const body = await responseJson<SidechatSessionResponse>(existingResponse);
    const claims = await verifySidechatToken(body.token, secret, now);

    expect(absentResponse.status).toBe(409);
    expect(existingResponse.status).toBe(200);
    expect(body.created).toBe(false);
    expect(claims).toMatchObject({
      scope: "child",
      canSubmit: false,
      canApproveOnce: false,
      canAlwaysAllow: false,
    });
  });
});

describe("native Sidechat summaries", () => {
  test("returns safe summaries and a read-only parent token", async () => {
    const response = await handleGetSidechatSummaries({
      actor: actor({ role: "admin" }),
      projectId: "project-1",
      secret,
      now,
      projectService: {
        getProjectById: mock(async () => ({
          id: "project-1",
          userId: "owner-1",
        })),
      },
      getParent: mock(async () => ({
        getSidechatSummaries: mock(async () => [
          {
            conversationId: "conversation-1",
            childName: "sc_conversation-1",
            status: "working" as const,
            updatedAt: 123,
          },
        ]),
      })),
    });
    const body = await responseJson<SidechatSummarySessionResponse>(response);
    const claims = await verifySidechatToken(body.token, secret, now);

    expect(response.status).toBe(200);
    expect(body.summaries).toEqual([
      {
        conversationId: "conversation-1",
        childName: "sc_conversation-1",
        status: "working",
        updatedAt: 123,
      },
    ]);
    expect(claims).toMatchObject({
      scope: "parent",
      role: "admin",
      projectId: "project-1",
      parentName: "project-1",
    });
    expect("conversationId" in (claims as object)).toBe(false);
  });
});
