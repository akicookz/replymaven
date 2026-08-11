import { describe, expect, mock, test } from "bun:test";
import type { MessageRow } from "../../db";
import {
  buildSidechatContext,
  type SidechatContextDependencies,
} from "./sidechat-context";

function publicMessage(
  id: string,
  createdAt: Date,
  role: MessageRow["role"] = "visitor",
): MessageRow {
  return {
    id,
    conversationId: "conversation-1",
    role,
    content: `message ${id}`,
    imageUrl: null,
    sources: null,
    senderName: null,
    senderAvatar: null,
    userId: null,
    createdAt,
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
  };
}

function createDependencies(): SidechatContextDependencies {
  return {
    getConversation: mock(async () => ({
      id: "conversation-1",
      projectId: "project-1",
      customerId: "customer-1",
      visitorName: "Untrusted visitor snapshot",
      visitorEmail: "snapshot@example.test",
      status: "active",
      archivedAt: null,
    })),
    getCustomer: mock(async () => ({
      id: "customer-1",
      projectId: "project-1",
      name: "Ada Lovelace",
      externalId: "  acct_42  ",
      email: "  ADA@EXAMPLE.TEST  ",
    })),
    getRecentPublicMessages: mock(async () => ({
      messages: [
        publicMessage("b", new Date(2_000), "bot"),
        publicMessage("a", new Date(2_000)),
        publicMessage("c", new Date(3_000), "agent"),
      ],
      hasMore: false,
    })),
  };
}

describe("buildSidechatContext", () => {
  test("loads the exact same-project conversation and only its newest 40 public rows", async () => {
    const dependencies = createDependencies();

    const context = await buildSidechatContext({
      projectId: "project-1",
      conversationId: "conversation-1",
      dependencies,
    });

    expect(dependencies.getConversation).toHaveBeenCalledWith(
      "conversation-1",
      "project-1",
    );
    expect(dependencies.getRecentPublicMessages).toHaveBeenCalledWith(
      "conversation-1",
      40,
    );
    expect(context.recentPublicMessages.map((message) => message.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(context.recentPublicMessages).toHaveLength(3);
    expect(context.publicSummary).toBeNull();
  });

  test("caps a defensive oversized result to the newest 40 in stable chronological order", async () => {
    const dependencies = createDependencies();
    dependencies.getRecentPublicMessages = mock(async () => ({
      messages: Array.from({ length: 45 }, (_, index) =>
        publicMessage(
          String(index).padStart(2, "0"),
          new Date(Math.floor(index / 2) * 1_000),
        ),
      ).reverse(),
      hasMore: true,
    }));

    const context = await buildSidechatContext({
      projectId: "project-1",
      conversationId: "conversation-1",
      dependencies,
    });

    expect(context.recentPublicMessages).toHaveLength(40);
    expect(context.recentPublicMessages[0]?.id).toBe("05");
    expect(context.recentPublicMessages.at(-1)?.id).toBe("44");
  });

  test("uses canonical external ID before normalized canonical email and ignores visitor snapshots", async () => {
    const context = await buildSidechatContext({
      projectId: "project-1",
      conversationId: "conversation-1",
      dependencies: createDependencies(),
    });

    expect(context.customer).toEqual({
      id: "customer-1",
      name: "Ada Lovelace",
      externalId: "acct_42",
      email: "ada@example.test",
    });
    expect(context.customer?.externalId).not.toContain("snapshot");
    expect(context.customer?.email).not.toBe("snapshot@example.test");
  });

  test("bounds every model-facing customer and message string", async () => {
    const dependencies = createDependencies();
    dependencies.getCustomer = mock(async () => ({
      id: "customer-1",
      projectId: "project-1",
      name: "n".repeat(1_000),
      externalId: "e".repeat(1_000),
      email: `${"m".repeat(1_000)}@example.test`,
    }));
    dependencies.getRecentPublicMessages = mock(async () => ({
      messages: [
        {
          ...publicMessage("large", new Date(1_000)),
          content: "x".repeat(20_000),
        },
      ],
      hasMore: false,
    }));

    const context = await buildSidechatContext({
      projectId: "project-1",
      conversationId: "conversation-1",
      dependencies,
    });

    expect(context.customer?.name).toHaveLength(200);
    expect(context.customer?.externalId).toHaveLength(255);
    expect(context.customer?.email).toHaveLength(320);
    expect(context.recentPublicMessages[0]?.content).toHaveLength(8_000);
  });

  test("fails closed for another project or a missing conversation", async () => {
    const dependencies = createDependencies();
    dependencies.getConversation = mock(async () => null);

    await expect(
      buildSidechatContext({
        projectId: "project-1",
        conversationId: "conversation-from-another-project",
        dependencies,
      }),
    ).rejects.toThrow("Sidechat conversation not found");
    expect(dependencies.getCustomer).not.toHaveBeenCalled();
    expect(dependencies.getRecentPublicMessages).not.toHaveBeenCalled();
  });

  test("does not expose any private transcript persistence dependency", () => {
    expect(Object.keys(createDependencies()).sort()).toEqual([
      "getConversation",
      "getCustomer",
      "getRecentPublicMessages",
    ]);
  });
});
