import { describe, expect, test } from "bun:test";
import {
  canHandConversationToMaven,
  mavenAssignedSystemContent,
  recordMavenAssignment,
} from "./maven-assignment";
import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";

describe("canHandConversationToMaven", () => {
  test("hands back open threads only", () => {
    expect(canHandConversationToMaven({ status: "active" })).toBe(true);
    expect(canHandConversationToMaven({ status: "waiting_agent" })).toBe(true);
    expect(canHandConversationToMaven({ status: "agent_replied" })).toBe(true);
    expect(canHandConversationToMaven({ status: "closed" })).toBe(false);
  });
});

describe("mavenAssignedSystemContent", () => {
  test("names the human who assigned the bot", () => {
    expect(mavenAssignedSystemContent({
      botName: "Maven",
      actorName: "Roxanne",
      reason: "manual",
    })).toBe("Roxanne assigned Maven");
  });

  test("uses a fallback actor and bot name", () => {
    expect(mavenAssignedSystemContent({
      botName: null,
      actorName: "  ",
      reason: "manual",
    })).toBe("Someone assigned Maven");
  });

  test("describes idle takeover without an actor", () => {
    expect(mavenAssignedSystemContent({
      botName: "Luna",
      reason: "idle",
    })).toBe("Luna self-assigned because the human seemed away");
  });
});

describe("recordMavenAssignment", () => {
  test("assigns Maven and writes the system pill", async () => {
    const calls: string[] = [];
    await recordMavenAssignment({
      chatService: {
        async setAssignee(conversationId, projectId, assigneeId) {
          calls.push(`assign:${conversationId}:${projectId}:${assigneeId}`);
        },
        async addPublicSystemMessage(
          conversationId,
          kind,
          content,
          _idempotencyKey,
          projectId,
        ) {
          calls.push(
            `system:${conversationId}:${kind}:${content}:${projectId}`,
          );
          return null;
        },
      },
      conversationId: "conv-1",
      projectId: "project-1",
      botName: "Maven",
      actorName: "Roxanne",
      reason: "manual",
    });
    expect(calls).toEqual([
      `assign:conv-1:project-1:${MAVEN_ASSIGNEE_ID}`,
      "system:conv-1:assigned:Roxanne assigned Maven:project-1",
    ]);
  });
});
