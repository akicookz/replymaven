import { describe, expect, test } from "bun:test";
import { buildMavenToolRegistry } from "../build-maven-tool-registry";
import { type MavenTurnContext } from "../../types";
import { createPresentReplyDraftTool } from "./present-reply-draft";

function createContext(channel: MavenTurnContext["channel"]): MavenTurnContext {
  return {
    channel,
    projectId: "project-1",
    conversationId: "conversation-1",
    actorUserId: channel === "sidechat" ? "agent-1" : null,
    customerId: "customer-1",
    ownership: { status: "active", chatState: null },
  };
}

function getInputSchema(
  definition: ReturnType<typeof createPresentReplyDraftTool>,
): { safeParse(input: unknown): { success: boolean } } {
  return definition.inputSchema as {
    safeParse(input: unknown): { success: boolean };
  };
}

describe("createPresentReplyDraftTool", () => {
  test("registers only for sidechat turns", () => {
    const drafts: string[] = [];
    const definition = createPresentReplyDraftTool({
      context: createContext("sidechat"),
      recordDraft(draft) {
        drafts.push(draft);
      },
    });
    const sidechatRegistry = buildMavenToolRegistry({
      context: createContext("sidechat"),
      definitions: [definition],
    });
    const publicRegistry = buildMavenToolRegistry({
      context: createContext("public"),
      definitions: [definition],
    });

    expect(definition.capability.allowedChannels).toEqual(["sidechat"]);
    expect(Object.keys(sidechatRegistry.tools)).toEqual([
      "present_reply_draft",
    ]);
    expect(Object.keys(publicRegistry.tools)).toEqual([]);
    expect(drafts).toEqual([]);
  });

  test("accepts exactly 1 through 5,000 draft characters", () => {
    const definition = createPresentReplyDraftTool({
      context: createContext("sidechat"),
      recordDraft() {},
    });
    const schema = getInputSchema(definition);

    expect(schema.safeParse({ draft: "x" }).success).toBe(true);
    expect(schema.safeParse({ draft: "x".repeat(5_000) }).success).toBe(true);
    expect(schema.safeParse({ draft: "" }).success).toBe(false);
    expect(schema.safeParse({ draft: "x".repeat(5_001) }).success).toBe(false);
    expect(schema.safeParse({ draft: "safe", extra: "leak" }).success).toBe(
      false,
    );
  });

  test("records only successful exact drafts and leaves the latest successful call available", async () => {
    const drafts: string[] = [];
    const definition = createPresentReplyDraftTool({
      context: createContext("sidechat"),
      recordDraft(draft) {
        drafts.push(draft);
      },
    });

    await expect(
      definition.execute(
        { draft: "First visitor-facing draft." },
        {},
      ),
    ).resolves.toEqual({ accepted: true });
    await expect(
      definition.execute({ draft: "x".repeat(5_001) }, {}),
    ).rejects.toThrow();
    await expect(
      definition.execute(
        { draft: "Final visitor-facing draft." },
        {},
      ),
    ).resolves.toEqual({ accepted: true });

    expect(drafts).toEqual([
      "First visitor-facing draft.",
      "Final visitor-facing draft.",
    ]);
    expect(drafts.at(-1)).toBe("Final visitor-facing draft.");
  });
});
