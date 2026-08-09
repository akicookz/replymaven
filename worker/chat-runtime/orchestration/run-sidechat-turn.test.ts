import { describe, expect, test } from "bun:test";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import type { MessageRow, ProjectSettingsRow } from "../../db";
import { ToolService } from "../../services/tool-service";
import type { AppEnv } from "../../types";
import type {
  MavenStreamPart,
  MavenTurnResult,
} from "../types";
import {
  runSidechatTurn,
  type SidechatTurnRuntime,
} from "./run-sidechat-turn";

const now = new Date("2026-08-09T12:00:00.000Z");

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    role: "agent",
    content: "Help me answer this customer.",
    channel: "sidechat",
    kind: "text",
    metadata: null,
    imageUrl: null,
    sources: null,
    senderName: "Agent Kim",
    senderAvatar: null,
    userId: "user-1",
    createdAt: now,
    emailedAt: null,
    deliveredAt: null,
    readAt: null,
    ...overrides,
  };
}

function makeSettings(): ProjectSettingsRow {
  return {
    id: "settings-1",
    projectId: "project-1",
    geminiApiKey: null,
    aiSearchInstanceName: null,
    telegramBotToken: null,
    telegramChatId: null,
    telegramMode: "agent",
    companyName: null,
    companyUrl: null,
    industry: null,
    companyContext: "Trusted company context",
    botName: "Maven",
    agentName: "an engineer",
    toneOfVoice: "friendly",
    customTonePrompt: null,
    introMessage: "Hello",
    introMessageAuthorId: null,
    introMessageDelay: 0,
    introMessageDuration: 15,
    showIntroBubble: true,
    autoCannedDraft: true,
    workingHours: null,
    avgResponseTime: null,
    helpCustomUrl: null,
    helpTopNav: null,
    customerIdentitySecret: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface HarnessOptions {
  parts?: MavenStreamPart[];
  artifact?: MavenTurnResult["artifact"];
  throwDuringStream?: boolean;
  insertResult?: MessageRow | null;
  takeoverBeforeInsert?: boolean;
  takeoverAfterInsert?: boolean;
  settlementRace?: "expiry" | "archive";
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const deltas: string[] = [];
  const activities: Array<{ label: string; phase: "start" | "finish" }> = [];
  const statuses: Array<{ status: string; runId: string | null }> = [];
  const persisted: Array<Record<string, unknown>> = [];
  const publicRows = Array.from({ length: 30 }, (_, index) =>
    makeMessage({
      id: `public-${index}`,
      role: index % 2 === 0 ? "visitor" : "bot",
      channel: "public",
      content: `Public ${index}`,
      userId: null,
      createdAt: new Date(now.getTime() - (30 - index) * 1_000),
    }));
  const privateRows = Array.from({ length: 45 }, (_, index) =>
    makeMessage({
      id: index === 44 ? "human-current" : `private-${index}`,
      role: index % 2 === 0 ? "agent" : "bot",
      content: index === 44 ? "Help with the latest case." : `Private ${index}`,
      createdAt: new Date(now.getTime() - (45 - index) * 1_000),
    }));
  let activeRun = true;
  let archivedAt: Date | null = null;
  let leaseExpiresAt = new Date(now.getTime() + 60_000);

  const service = {
    async getOperationalConversationById() {
      calls.push("conversation");
      return {
        id: "conversation-1",
        projectId: "project-1",
        customerId: "customer-1",
        visitorName: "Snapshot Name",
        visitorEmail: "snapshot@example.com",
        status: "waiting_agent" as const,
        chatState: '{"aiParticipation":"human_only"}',
        archivedAt,
        sidechatStatus: activeRun ? "working" as const : "failed" as const,
        sidechatRunId: activeRun ? "run-1" : null,
        sidechatLeaseExpiresAt: activeRun ? leaseExpiresAt : null,
      };
    },
    async getRecentPublicMessages(_id: string, limit: number) {
      calls.push(`public:${limit}`);
      return { messages: publicRows.slice(-limit), hasMore: true };
    },
    async getRecentSidechatMessages(_id: string, limit: number) {
      calls.push(`sidechat:${limit}`);
      return { messages: privateRows.slice(-limit), hasMore: true };
    },
    async addSidechatMavenMessage(input: Record<string, unknown>) {
      calls.push("persist");
      persisted.push(input);
      if (options.takeoverBeforeInsert) activeRun = false;
      if (!activeRun) return null;
      const message = options.insertResult === undefined
        ? makeMessage({
            id: "maven-final",
            role: "bot",
            content: String(input.content),
            kind: (input.kind as MessageRow["kind"] | undefined) ?? "text",
            metadata: (input.metadata as string | null | undefined) ?? null,
            senderName: "Maven",
            userId: null,
          })
        : options.insertResult;
      if (options.takeoverAfterInsert) activeRun = false;
      return message;
    },
    async settleSidechatRun(input: { status: string; now: Date }) {
      calls.push(`settle:${input.status}`);
      if (!activeRun) return false;
      if (options.settlementRace === "expiry") leaseExpiresAt = input.now;
      if (options.settlementRace === "archive") archivedAt = input.now;
      if (
        archivedAt ||
        leaseExpiresAt.getTime() <= input.now.getTime()
      ) {
        return false;
      }
      activeRun = false;
      return true;
    },
  };

  let streamCompleted = false;
  const runtime: SidechatTurnRuntime = {
    createChatService() {
      return service;
    },
    createProjectService() {
      return {
        async getProjectById() {
          return { id: "project-1", name: "ReplyMaven" };
        },
        async getSettings() {
          return makeSettings();
        },
      };
    },
    createCustomerService() {
      return {
        async getCustomerDetail() {
          return {
            id: "customer-1",
            name: "Canonical Name",
            email: "canonical@example.com",
          };
        },
      };
    },
    createGuidelineService() {
      return {
        async getEnabledByProject() {
          return [{ condition: "refund", instruction: "Check eligibility" }];
        },
      };
    },
    createToolService(db) {
      return new ToolService(db);
    },
    createModelRuntimeState() {
      return {
        activeConfig: {
          model: "test-model",
          geminiApiKey: "test",
          openaiApiKey: "test",
        },
        fallbackConfig: null,
        hasUsedFallback: false,
        modelCallCount: 0,
        modelCallsByStage: {},
      };
    },
    async runMavenTurn(input) {
      calls.push("maven");
      expect(input.context).toMatchObject({
        channel: "sidechat",
        projectId: "project-1",
        conversationId: "conversation-1",
        actorUserId: "user-1",
        customerId: "customer-1",
      });
      expect(input.conversationHistory).toHaveLength(39);
      expect(input.conversationHistory.at(-1)?.content).toBe("Private 43");
      expect(input.currentMessage).toBe("Help with the latest case.");
      expect(input.dependencies.publicToolDependencies).toBeUndefined();
      expect(input.dependencies.promptOptions).toMatchObject({
        visitorInfo: {
          name: "Canonical Name",
          email: "canonical@example.com",
        },
        guidelines: [{ condition: "refund", instruction: "Check eligibility" }],
      });
      expect(input.dependencies.conversationSummary).toContain("Public 5");
      expect(input.dependencies.conversationSummary).toContain("Public 29");
      expect(input.dependencies.conversationSummary).not.toContain("Public 4");

      const parts = options.parts ?? [
        { type: "text-delta", text: "A safe response." },
      ];
      async function* stream(): AsyncGenerator<MavenStreamPart> {
        for (const part of parts) {
          yield part;
        }
        if (options.throwDuringStream) throw new Error("stream failed");
        streamCompleted = true;
      }
      const result = {
        fullStream: stream(),
        get artifact() {
          return streamCompleted ? options.artifact ?? null : null;
        },
        collectedSources: [],
        toolActivity: [
          {
            toolId: "private-tool-id",
            displayName: "Look up account",
            source: "http" as const,
            status: "started" as const,
            durationMs: 0,
          },
          {
            toolId: "private-tool-id",
            displayName: "Look up account",
            source: "http" as const,
            status: "success" as const,
            durationMs: 12,
          },
        ],
        httpExecutionIds: ["private-execution-id"],
      };
      return result;
    },
    broadcastMessage(_env, _ctx, _conversationId, row) {
      calls.push(`message:${row.id}`);
    },
    broadcastDelta(_env, _ctx, _conversationId, _runId, delta) {
      deltas.push(delta);
    },
    broadcastActivity(
      _env,
      _ctx,
      _conversationId,
      _runId,
      label,
      phase,
    ) {
      activities.push({ label, phase });
    },
    broadcastStatus(_env, _ctx, _conversationId, status, runId) {
      statuses.push({ status, runId });
    },
    now() {
      return now;
    },
  };

  return {
    runtime,
    calls,
    deltas,
    activities,
    statuses,
    persisted,
  };
}

function createOptions(runtime: SidechatTurnRuntime) {
  const db = {} as DrizzleD1Database<Record<string, unknown>>;
  const env = {
    AI_MODEL: "test-model",
    GEMINI_API_KEY: "test",
    OPENAI_API_KEY: "test",
  } as AppEnv;
  const executionCtx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as ExecutionContext;
  return {
    projectId: "project-1",
    conversationId: "conversation-1",
    humanMessageId: "human-current",
    runId: "run-1",
    actorUserId: "user-1",
    db,
    env,
    executionCtx,
    runtime,
  };
}

describe("runSidechatTurn", () => {
  test("drains the shared stream then persists one completion-only reply draft", async () => {
    const harness = createHarness({
      parts: [
        { type: "text-delta", text: "Working text that is not the draft." },
        { type: "tool-call", toolCallId: "draft-1", toolName: "present_reply_draft" },
      ],
      artifact: { type: "reply_draft", draft: "Visitor-safe final draft." },
    });

    await runSidechatTurn(createOptions(harness.runtime));

    expect(harness.persisted).toEqual([
      expect.objectContaining({
        runId: "run-1",
        content: "Visitor-safe final draft.",
        kind: "reply_draft",
        metadata: '{"draft":"Visitor-safe final draft."}',
        senderName: "Maven",
      }),
    ]);
    expect(harness.calls).toContain("settle:ready");
    expect(harness.calls.filter((call) => call === "persist")).toHaveLength(1);
    expect(harness.deltas).toEqual(["Working text that is not the draft."]);
    expect(harness.activities).toEqual([
      { label: "Look up account", phase: "start" },
      { label: "Look up account", phase: "finish" },
    ]);
    expect(JSON.stringify(harness.activities)).not.toContain("private-tool-id");
    expect(JSON.stringify(harness.activities)).not.toContain("execution");
    expect(harness.statuses).toContainEqual({ status: "ready", runId: null });
  });

  test("persists bounded ordinary text and settles idle without an artifact", async () => {
    const harness = createHarness({
      parts: [
        { type: "text-delta", text: "x".repeat(4_900) },
        { type: "text-delta", text: "y".repeat(300) },
      ],
    });

    await runSidechatTurn(createOptions(harness.runtime));

    expect(String(harness.persisted[0]?.content)).toHaveLength(5_000);
    expect(harness.persisted[0]).toMatchObject({ kind: "text", metadata: null });
    expect(harness.calls).toContain("settle:idle");
    expect(harness.statuses).toContainEqual({ status: "idle", runId: null });
  });

  test.each([
    { label: "abort", parts: [{ type: "text-delta", text: "partial" }, { type: "abort" }] },
    { label: "model error", parts: [{ type: "text-delta", text: "partial" }, { type: "error", error: "private" }] },
    { label: "no output", parts: [] },
  ])("never persists partial output for $label", async ({ parts }) => {
    const harness = createHarness({ parts });

    await runSidechatTurn(createOptions(harness.runtime));

    expect(harness.persisted).toEqual([]);
    expect(harness.calls).toContain("settle:failed");
    expect(harness.statuses).toContainEqual({ status: "failed", runId: null });
  });

  test("contains a stream rejection and does not persist its partial text", async () => {
    const harness = createHarness({
      parts: [{ type: "text-delta", text: "partial" }],
      throwDuringStream: true,
    });

    await expect(
      runSidechatTurn(createOptions(harness.runtime)),
    ).resolves.toBeUndefined();

    expect(harness.persisted).toEqual([]);
    expect(harness.calls).toContain("settle:failed");
  });

  test("blocks final persistence and settlement after a run takeover", async () => {
    const harness = createHarness({ takeoverBeforeInsert: true });

    await runSidechatTurn(createOptions(harness.runtime));

    expect(harness.persisted).toHaveLength(1);
    expect(harness.calls).not.toContain("settle:idle");
    expect(harness.statuses).toEqual([]);
    expect(harness.calls.some((call) => call.startsWith("message:"))).toBe(false);
  });

  test("does not publish or settle after losing the run at final persistence", async () => {
    const harness = createHarness({ takeoverAfterInsert: true });

    await runSidechatTurn(createOptions(harness.runtime));

    expect(harness.calls).not.toContain("settle:idle");
    expect(harness.calls.some((call) => call.startsWith("message:"))).toBe(false);
    expect(harness.statuses).toEqual([]);
  });

  test.each(["expiry", "archive"] as const)(
    "does not publish when %s wins between revalidation and settlement",
    async (settlementRace) => {
      const harness = createHarness({ settlementRace });

      await runSidechatTurn(createOptions(harness.runtime));

      expect(harness.persisted).toHaveLength(1);
      expect(harness.calls).toContain("settle:idle");
      expect(harness.calls.some((call) => call.startsWith("message:")))
        .toBe(false);
      expect(harness.statuses).toEqual([]);
    },
  );
});
