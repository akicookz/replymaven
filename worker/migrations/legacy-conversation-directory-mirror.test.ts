import { describe, expect, test } from "bun:test";
import { extractLegacyMutationReferences } from "./legacy-conversation-directory-mirror";

describe("legacy conversation directory mirror", () => {
  test("extracts canonical, compatibility, and bulk mutation targets", () => {
    expect(extractLegacyMutationReferences(
      "appendVisitor",
      [{ projectId: "project-1", conversationId: "conversation-1" }],
      null,
    )).toEqual([{
      projectId: "project-1",
      conversationId: "conversation-1",
    }]);
    expect(extractLegacyMutationReferences(
      "updateConversationStatus",
      ["conversation-2", "project-1", "closed"],
      undefined,
    )).toEqual([{
      projectId: "project-1",
      conversationId: "conversation-2",
    }]);
    expect(extractLegacyMutationReferences(
      "bulkApplyActions",
      ["project-1", ["conversation-1", "conversation-2"], { action: "archive" }],
      { updatedIds: ["conversation-1", "conversation-2"] },
    )).toEqual([
      { projectId: "project-1", conversationId: "conversation-1" },
      { projectId: "project-1", conversationId: "conversation-2" },
    ]);
  });

  test("observes every compatibility endpoint removed after cutover", async () => {
    const indexSource = await Bun.file("worker/index.ts").text();
    const upgradeSource = await Bun.file("worker/realtime/upgrade.ts").text();
    const indexCalls = indexSource.match(
      /await recordLegacyConversationEndpointRequest\(c\.env, project\.id\);/g,
    ) ?? [];
    const upgradeCalls = upgradeSource.match(
      /await recordLegacyConversationEndpointRequest\(c\.env, project\.id\);/g,
    ) ?? [];

    expect(indexCalls).toHaveLength(2);
    expect(upgradeCalls).toHaveLength(3);
  });
});
