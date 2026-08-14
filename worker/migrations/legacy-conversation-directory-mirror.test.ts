import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../types";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import {
  extractLegacyMutationReferences,
  withLegacyConversationDirectoryMirror,
} from "./legacy-conversation-directory-mirror";

interface ParentCall {
  method: string;
  args: unknown[];
}

function fakeParentNamespace(calls: ParentCall[]): unknown {
  const stub = new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      return (...args: unknown[]) => {
        if (property !== "setName") calls.push({ method: property, args });
        return Promise.resolve(property === "removeLegacyConversation"
          ? true
          : undefined);
      };
    },
  });
  return {
    idFromName: (name: string) => name,
    get: () => stub,
  };
}

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

  test("returns the mutation result when the parent mirror fails", async () => {
    const store = {
      async appendVisitor() {
        return { id: "message-1" };
      },
      async get() {
        throw new Error("D1 unavailable");
      },
    } as unknown as PublicConversationStore;
    const env = {
      MAVEN_PROJECT_AGENT: fakeParentNamespace([]),
    } as unknown as AppEnv;

    await expect(withLegacyConversationDirectoryMirror(store, env)
      .appendVisitor({
        projectId: "project-1",
        conversationId: "conversation-1",
        content: "hello",
      })).resolves.toEqual({ id: "message-1" });
  });

  test("does not contact the parent for read methods", async () => {
    const calls: ParentCall[] = [];
    const store = {
      async get() {
        return { id: "conversation-1" };
      },
    } as unknown as PublicConversationStore;
    const env = {
      MAVEN_PROJECT_AGENT: fakeParentNamespace(calls),
    } as unknown as AppEnv;

    await expect(withLegacyConversationDirectoryMirror(store, env)
      .get("project-1", "conversation-1"))
      .resolves.toEqual({ id: "conversation-1" });
    expect(calls).toEqual([]);
  });
});
