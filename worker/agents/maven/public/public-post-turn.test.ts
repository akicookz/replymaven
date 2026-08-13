import { describe, expect, test } from "bun:test";
import { decidePublicPostTurn } from "./public-post-turn";

describe("public Agent post-turn ownership", () => {
  const base = {
    responseStatus: "completed" as const,
    outcomeStatus: "completed" as const,
    assistantPersisted: true,
    archived: false,
    currentStatus: "active" as const,
    currentParticipation: "continuous" as const,
    currentOwnershipRevision: 4,
    capturedOwnershipRevision: 4,
    aiInvoked: false,
    resolved: false,
  };

  test("commits ordinary, resolved, and accepted handoff turns", () => {
    expect(decidePublicPostTurn(base)).toBe("commit");
    expect(decidePublicPostTurn({ ...base, resolved: true })).toBe(
      "commit_resolved",
    );
    expect(decidePublicPostTurn({
      ...base,
      currentStatus: "waiting_agent",
      currentParticipation: "assist_until_agent",
      currentOwnershipRevision: 5,
    })).toBe("commit");
  });

  test("quarantines aborts, archives, closes, and human takeover races", () => {
    expect(decidePublicPostTurn({
      ...base,
      responseStatus: "aborted",
      outcomeStatus: "pending",
    })).toBe("discard");
    expect(decidePublicPostTurn({ ...base, archived: true })).toBe("discard");
    expect(decidePublicPostTurn({
      ...base,
      currentStatus: "closed",
    })).toBe("discard");
    expect(decidePublicPostTurn({
      ...base,
      currentStatus: "agent_replied",
      currentParticipation: "human_only",
      currentOwnershipRevision: 5,
    })).toBe("discard");
  });

  test("allows an explicit bot invocation only while ownership stays exact", () => {
    expect(decidePublicPostTurn({
      ...base,
      currentStatus: "agent_replied",
      currentParticipation: "human_only",
      aiInvoked: true,
    })).toBe("commit");
    expect(decidePublicPostTurn({
      ...base,
      currentStatus: "agent_replied",
      currentParticipation: "human_only",
      currentOwnershipRevision: 5,
      aiInvoked: true,
    })).toBe("discard");
  });

  test("does not apply effects when the SDK did not persist an assistant", () => {
    expect(decidePublicPostTurn({
      ...base,
      assistantPersisted: false,
    })).toBe("ignore");
  });
});
