import { expect, test } from "bun:test";
import { createModelRuntimeState, runWithModelFallback } from "./create-language-model";

test("retries a provider failure once with the configured fallback and records both attempts", async () => {
  const runtime = createModelRuntimeState({
    model: "gpt-5.6-terra",
    openaiApiKey: "openai-test",
    geminiApiKey: "gemini-test",
  });
  let attempts = 0;

  const result = await runWithModelFallback({
    runtime,
    stage: "compose",
    operation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("503 Service Unavailable");
      return "fallback response";
    },
  });

  expect(result).toBe("fallback response");
  expect(runtime.modelCallCount).toBe(2);
  expect(runtime.modelCallsByStage).toEqual({ compose: 2 });
});
