import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel } from "ai";
import { type ChatRuntimeAiConfig } from "../types";

export function createLanguageModel(
  config: ChatRuntimeAiConfig,
): LanguageModel {
  if (config.model.startsWith("gpt")) {
    const provider = createOpenAI({ apiKey: config.openaiApiKey });
    return provider(config.model);
  }

  const provider = createGoogleGenerativeAI({
    apiKey: config.geminiApiKey,
  });
  return provider(config.model);
}
