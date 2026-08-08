import { describe, expect, test } from "bun:test";
import { simulateReadableStream, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { streamMavenAgent } from "./support-agent";

interface ModelCall {
  prompt?: unknown;
  toolChoice?: unknown;
}

const emptyUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

function createTextStep(text: string): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      usage: emptyUsage,
      finishReason: { unified: "stop", raw: "stop" },
    },
  ];
}

function createToolStep(step: number): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: `call-${step}`,
      toolName: "keep_working",
      input: JSON.stringify({ step }),
    },
    {
      type: "finish",
      usage: emptyUsage,
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    },
  ];
}

function createFakeModel(
  createStep: (callNumber: number) => unknown[],
): { model: LanguageModel; calls: ModelCall[] } {
  const calls: ModelCall[] = [];
  const model = {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "tool-loop-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected non-streaming generation");
    },
    async doStream(options: ModelCall) {
      calls.push(options);
      return {
        stream: simulateReadableStream({
          chunks: createStep(calls.length),
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  } as LanguageModel;
  return { model, calls };
}

async function collectText(stream: AsyncIterable<{ type: string; text?: string }>): Promise<string> {
  let text = "";
  for await (const part of stream) {
    if (part.type === "text-delta") text += part.text ?? "";
  }
  return text;
}

describe("streamMavenAgent", () => {
  test("uses ToolLoopAgent with toolChoice none for an empty registry", async () => {
    const fake = createFakeModel(() => createTextStep("A direct answer."));

    const result = await streamMavenAgent(
      {
        modelConfig: {
          model: "test-model",
          geminiApiKey: null,
          openaiApiKey: null,
        },
        createModel: () => fake.model,
      },
      {
        systemPrompt: "Be helpful.",
        conversationHistory: [],
        userMessage: "Hello",
        tools: {},
      },
    );

    expect(await collectText(result.fullStream)).toBe("A direct answer.");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.toolChoice).toBeUndefined();
  });

  test("stops an endlessly tool-calling model after eight agent steps", async () => {
    const fake = createFakeModel((callNumber) => createToolStep(callNumber));
    let executions = 0;
    const keepWorking = tool({
      description: "Continues work.",
      inputSchema: z.object({ step: z.number() }),
      execute: async ({ step }) => {
        executions += 1;
        return { completedStep: step };
      },
    });

    const result = await streamMavenAgent(
      {
        modelConfig: {
          model: "test-model",
          geminiApiKey: null,
          openaiApiKey: null,
        },
        createModel: () => fake.model,
      },
      {
        systemPrompt: "Use the tool.",
        conversationHistory: [],
        userMessage: "Keep going",
        tools: { keep_working: keepWorking },
      },
    );

    for await (const part of result.fullStream) {
      // Consuming the real stream drives the real ToolLoopAgent loop.
      void part;
    }

    expect(fake.calls).toHaveLength(8);
    expect(executions).toBe(8);
    expect(fake.calls.every((call) => {
      return JSON.stringify(call.toolChoice) === JSON.stringify({ type: "auto" });
    })).toBe(true);
  });
});
