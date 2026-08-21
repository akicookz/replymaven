import { describe, expect, test } from "bun:test";
import type { PublicMessageRecord } from "../../../../shared/maven-conversation";
import type { MavenStreamPart } from "../../../chat-runtime/types";
import {
  collectPublicTurnStream,
  createPublicTurnResponse,
  evaluatePublicTurnGate,
  shouldResumeAiAfterHumanIdle,
} from "./public-turn";

function publicRecord(
  id: string,
  author: PublicMessageRecord["author"],
  createdAt: number,
  content = id,
): PublicMessageRecord {
  return {
    id,
    conversationId: "conversation-1",
    author,
    content,
    imageUrls: [],
    sources: [],
    senderName: author === "agent" ? "Grace" : null,
    senderAvatar: null,
    userId: author === "agent" ? "agent-1" : null,
    systemKind: null,
    createdAt,
    deliveredAt: null,
    readAt: null,
    emailedAt: null,
  };
}

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

  test("keeps activity phases visible after the first-turn opening", async () => {
    // The opening greeting streams before the model runs. It must not
    // suppress the thinking/retrieval phases, or the first turn shows a
    // frozen greeting with no status for the whole model run.
    async function* parts(): AsyncGenerator<MavenStreamPart> {
      yield {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "search_knowledge",
      };
      yield { type: "text-delta", text: "Answer." };
    }
    const response = createPublicTurnResponse({
      originalMessages: [],
      assistantMessageId: "assistant-phases",
      projectId: "project-1",
      conversationId: "conversation-1",
      botName: "Maven",
      ownershipRevision: 1,
      openingText: "Hi Ada,\n\n",
      runTurn: async () => ({
        fullStream: parts(),
        collectedSources: [],
        toolActivity: [],
        httpExecutionIds: [],
      }),
      onOutcome() {},
    });

    const body = await response.text();
    expect(body).toContain('"phase":"thinking"');
    expect(body).toContain('"phase":"retrieval"');
    expect(body).toContain('"delta":"Hi Ada,\\n\\n"');
    expect(body).toContain('"delta":"Answer."');

    // The greeting is held until reply text exists: phases first, then the
    // text part opens with the greeting as its first delta — never a lone
    // "Hi Name," bubble sitting through the model run.
    const thinkingIndex = body.indexOf('"phase":"thinking"');
    const retrievalIndex = body.indexOf('"phase":"retrieval"');
    const textStartIndex = body.indexOf('"type":"text-start"');
    const openingIndex = body.indexOf('"delta":"Hi Ada,\\n\\n"');
    expect(retrievalIndex).toBeGreaterThan(thinkingIndex);
    expect(textStartIndex).toBeGreaterThan(retrievalIndex);
    expect(openingIndex).toBeGreaterThan(textStartIndex);
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

describe("idle human handoff takeover", () => {
  const hour = 60 * 60 * 1_000;

  test("resumes AI on the second ordinary visitor message after four idle hours", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
    })).toBe(true);
  });

  test("keeps human ownership on the first visitor message after four idle hours", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-1",
      botName: "Maven",
    })).toBe(false);
  });

  test("does not count visitor messages sent before four idle hours", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", (5 * hour) - 2),
      publicRecord("visitor-2", "visitor", (5 * hour) - 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
    })).toBe(false);
  });

  test("counts an applied @BotName command as human activity without an agent row", () => {
    const messages = [
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
      lastHumanCommandAt: hour,
    })).toBe(true);
  });

  test("a later @BotName command resets the idle clock", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
      lastHumanCommandAt: (5 * hour) + 1,
    })).toBe(false);
  });

  test("requires a prior human-agent message", () => {
    const messages = [
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
    })).toBe(false);
  });

  test("uses a later human reply as the new timeout and message-count origin", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("agent-2", "agent", (5 * hour) + 1),
      publicRecord("visitor-2", "visitor", (5 * hour) + 2),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
    })).toBe(false);
  });

  test("does not count an explicit one-turn AI invocation", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord(
        "visitor-1",
        "visitor",
        5 * hour,
        "@Maven answer this",
      ),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
    })).toBe(false);
  });

  test("does not count inbound email as a widget visitor message", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      {
        ...publicRecord("visitor-email", "visitor", 5 * hour),
        origin: "email" as const,
      },
      publicRecord("visitor-widget", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-widget",
      botName: "Maven",
    })).toBe(false);
  });

  test("does not resume AI while the conversation is snoozed", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
      snoozedUntil: 6 * hour,
    })).toBe(false);
  });

  test("allows takeover after a snooze expires", () => {
    const messages = [
      publicRecord("agent-1", "agent", hour),
      publicRecord("visitor-1", "visitor", 5 * hour),
      publicRecord("visitor-2", "visitor", (5 * hour) + 1),
    ];

    expect(shouldResumeAiAfterHumanIdle({
      messages,
      submittedMessageId: "visitor-2",
      botName: "Maven",
      snoozedUntil: (5 * hour) - 1,
    })).toBe(true);
  });
});
