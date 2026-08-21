import { describe, expect, test } from "bun:test";
import { applyBotNameCommand } from "./apply-bot-name-command";
import type { BotNameDecision } from "./bot-name-decision";

function decision(
  overrides: Partial<BotNameDecision> = {},
): BotNameDecision {
  return {
    ownership: "human",
    instructions: "keep",
    speak: "silent",
    effect: "none",
    reason: null,
    ...overrides,
  };
}

function createDeps() {
  const calls: string[] = [];
  const metadataWrites: Record<string, unknown>[] = [];
  let spoke = false;
  const deps = {
    calls,
    metadataWrites,
    async transitionChatOwnership(event: string) {
      calls.push(`ownership:${event}`);
      return { status: "active" as const, chatState: "from-transition" };
    },
    async takeHumanOwnership() {
      calls.push("ownership:human");
      return { status: "agent_replied" as const, chatState: "{}" };
    },
    async updateConversation(input: { metadata: string }) {
      calls.push("metadata");
      metadataWrites.push(JSON.parse(input.metadata) as Record<string, unknown>);
    },
    async updateConversationStatus(status: string, closeReason: string) {
      calls.push(`status:${status}:${closeReason}`);
    },
    async closeOpenConversationsAsSpam() {
      calls.push("spam-sweep");
    },
    async banVisitor(reason: string) {
      calls.push(`ban:${reason}`);
    },
    async generateDirectedResponse(instruction: string) {
      calls.push(`speak:${instruction}`);
      spoke = true;
      return "Here is the answer.";
    },
    async addPublicBotMessage(input: {
      content: string
      expected: { status: string; chatState: string | null }
    }) {
      calls.push(`persist-bot:${input.expected.chatState}:${input.content}`);
      return spoke;
    },
  };
  return deps;
}

describe("applyBotNameCommand", () => {
  test("stores raw text and keeps the human for a silent instruction", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "don't mention the refund",
      decision: decision({ instructions: "set" }),
      metadata: { timezone: "UTC" },
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Instructions saved.");
    expect(deps.calls).toEqual(["ownership:human", "metadata"]);
    expect(deps.metadataWrites[0]).toEqual({
      timezone: "UTC",
      agentHandbackInstructions: "don't mention the refund",
      lastHumanCommandAt: 50,
    });
  });

  test("hands to AI and speaks through generateDirectedResponse", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "take over",
      decision: decision({
        ownership: "ai",
        speak: "now",
      }),
      metadata: {},
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Bot responded.");
    expect(deps.calls).toEqual([
      "ownership:ai_handed_back",
      "speak:take over",
      "persist-bot:from-transition:Here is the answer.",
      "metadata",
    ]);
  });

  test("does not persist a visitor row when directed response is empty", async () => {
    const deps = createDeps();
    deps.generateDirectedResponse = async () => {
      deps.calls.push("speak:take over");
      return null;
    };
    const result = await applyBotNameCommand({
      rawAgentText: "take over",
      decision: decision({
        ownership: "ai",
        speak: "now",
      }),
      metadata: {},
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Bot could not respond.");
    expect(deps.calls).toEqual([
      "ownership:ai_handed_back",
      "speak:take over",
      "metadata",
    ]);
  });

  test("replays the stored confirmation when the same command id arrives again", async () => {
    const deps = createDeps();
    const input = {
      rawAgentText: "ban them",
      decision: decision({ effect: "ban", reason: "spam" }),
      metadata: {},
      now: 50,
      commandId: "telegram:9",
      deps,
    };
    const first = await applyBotNameCommand(input);
    expect(first.confirmation).toContain("spam");
    expect(deps.metadataWrites.at(-1)).toMatchObject({
      lastTelegramCommandId: "telegram:9",
      lastTelegramCommandConfirm: first.confirmation,
    });
    deps.calls.length = 0;
    const second = await applyBotNameCommand({
      ...input,
      metadata: deps.metadataWrites.at(-1) ?? {},
    });
    expect(second.confirmation).toBe(first.confirmation);
    expect(deps.calls).toEqual([]);
  });

  test("does not speak on a silent decision", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "stfu",
      decision: decision({ ownership: "ai", speak: "silent" }),
      metadata: {},
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Bot resumed.");
    expect(deps.calls).toEqual(["ownership:ai_handed_back", "metadata"]);
  });

  test("applies close and ignores speak", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "close this",
      decision: decision({
        ownership: "ai",
        speak: "now",
        effect: "close",
      }),
      metadata: {},
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Conversation closed.");
    expect(deps.calls).toEqual(["status:closed:resolved"]);
  });

  test("uses raw text as the ban reason when the model reason is empty", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "ban them",
      decision: decision({ effect: "ban", reason: null, speak: "now" }),
      metadata: {},
      now: 50,
      deps,
    });
    expect(result.confirmation).toContain("ban them");
    expect(deps.calls).toEqual([
      "ban:ban them",
      "status:closed:spam",
      "spam-sweep",
    ]);
  });

  test("stores raw text and does not speak when the decision is invalid", async () => {
    const deps = createDeps();
    const result = await applyBotNameCommand({
      rawAgentText: "keep them as a VIP",
      decision: null,
      metadata: { timezone: "UTC" },
      now: 50,
      deps,
    });
    expect(result.confirmation).toBe("Instructions saved.");
    expect(deps.calls).toEqual(["ownership:human", "metadata"]);
    expect(deps.metadataWrites[0]).toMatchObject({
      agentHandbackInstructions: "keep them as a VIP",
      lastHumanCommandAt: 50,
    });
  });
});
