import { describe, expect, test } from "bun:test";
import type { MavenStreamPart } from "../../../chat-runtime/types";
import {
  collectPublicTurnStream,
  createPublicTurnResponse,
  evaluatePublicTurnGate,
} from "./public-turn";

describe("public Agent turn parity", () => {
  test("preserves subscription, quota, ban, archive, and ownership gates", () => {
    const base = {
      subscriptionActive: true,
      messageAllowed: true,
      banned: false,
      archived: false,
      status: "active" as const,
      closeReason: null,
      aiParticipation: "continuous" as const,
      aiInvoked: false,
    };
    expect(evaluatePublicTurnGate(base)).toBe("run_ai");
    expect(evaluatePublicTurnGate({
      ...base,
      subscriptionActive: false,
    })).toBe("subscription_inactive");
    expect(evaluatePublicTurnGate({
      ...base,
      messageAllowed: false,
    })).toBe("message_limit_reached");
    expect(evaluatePublicTurnGate({ ...base, banned: true })).toBe("banned");
    expect(evaluatePublicTurnGate({ ...base, archived: true })).toBe("archived");
    expect(evaluatePublicTurnGate({
      ...base,
      closeReason: "spam",
    })).toBe("muted");
    expect(evaluatePublicTurnGate({
      ...base,
      status: "agent_replied",
      aiParticipation: "human_only",
    })).toBe("human_mode");
    expect(evaluatePublicTurnGate({
      ...base,
      status: "agent_replied",
      aiParticipation: "human_only",
      aiInvoked: true,
    })).toBe("run_ai");
    expect(evaluatePublicTurnGate({
      ...base,
      status: "closed",
    })).toBe("reopen_and_run_ai");
  });

  test("streams clean text while retaining split post-turn markers", async () => {
    async function* parts(): AsyncGenerator<MavenStreamPart> {
      yield { type: "text-delta", text: "Let me connect you " };
      yield { type: "tool-call", toolCallId: "tool-1", toolName: "search_knowledge" };
      yield { type: "text-delta", text: "now [HANDOFF_" };
      yield { type: "text-delta", text: "REQUESTED]" };
      yield { type: "text-delta", text: " Done. [RES" };
      yield { type: "text-delta", text: "OLVED]" };
    }
    const deltas: string[] = [];
    const result = await collectPublicTurnStream(parts(), (delta) => {
      deltas.push(delta);
    });

    expect(deltas.join("")).toBe("Let me connect you now  Done. ");
    expect(result.fullText).toBe("Let me connect you now  Done. ");
    expect(result.internalTokens).toEqual([
      "[HANDOFF_REQUESTED]",
      "[RESOLVED]",
    ]);
    expect(result.hadToolCalls).toBe(true);
  });

  test("prepends the server-owned first-turn opening", async () => {
    const outcomes: unknown[] = [];
    const response = createPublicTurnResponse({
      originalMessages: [],
      assistantMessageId: "assistant-opening",
      projectId: "project-1",
      conversationId: "conversation-1",
      botName: "Maven",
      ownershipRevision: 3,
      openingText: "Hi Ada,\n\n",
      immediateText: "I can help with this product.",
      onOutcome(outcome) {
        outcomes.push(outcome);
      },
    });

    const body = await response.text();
    expect(body).toContain('"delta":"Hi Ada,\\n\\n"');
    expect(body).toContain('"delta":"I can help with this product."');
    expect(body).toContain('"messageId":"assistant-opening"');
    expect(outcomes).toEqual([{
      messageId: "assistant-opening",
      ownershipRevision: 3,
      internalTokens: [],
      httpExecutionIds: [],
    }]);
  });

  test("uses a goodbye fallback for an otherwise empty resolved response", async () => {
    async function* parts(): AsyncGenerator<MavenStreamPart> {
      yield { type: "text-delta", text: "[RESOLVED]" };
    }
    const response = createPublicTurnResponse({
      originalMessages: [],
      assistantMessageId: "assistant-resolved",
      projectId: "project-1",
      conversationId: "conversation-1",
      botName: "Maven",
      ownershipRevision: 3,
      resolvedFallbackText: "Glad I could help!",
      async runTurn() {
        return {
          fullStream: parts(),
          collectedSources: [],
          toolActivity: [],
          httpExecutionIds: [],
        };
      },
      onOutcome() {},
    });

    expect(await response.text()).toContain(
      '"delta":"Glad I could help!"',
    );
  });

  test("does not create an empty assistant text part in agent mode", async () => {
    async function* parts(): AsyncGenerator<MavenStreamPart> {
      yield { type: "text-delta", text: "[RESOLVED]" };
    }
    const response = createPublicTurnResponse({
      originalMessages: [],
      assistantMessageId: "assistant-empty",
      projectId: "project-1",
      conversationId: "conversation-1",
      botName: "Maven",
      ownershipRevision: 3,
      async runTurn() {
        return {
          fullStream: parts(),
          collectedSources: [],
          toolActivity: [],
          httpExecutionIds: [],
        };
      },
      onOutcome() {},
    });

    const body = await response.text();
    expect(body).not.toContain('"type":"text-start"');
    expect(body).not.toContain('"type":"source-url"');
  });
});
