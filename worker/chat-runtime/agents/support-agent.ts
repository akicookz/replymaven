import { ToolLoopAgent, stepCountIs, type ToolSet } from "ai";
import {
  type SupportAgentDependencies,
  type SupportAgentResult,
  type SupportAgentImage,
  type ConversationTurnMessage,
  toSdkConversationMessages,
} from "../types";
import { createLanguageModel } from "../llm/create-language-model";

export interface MavenAgentStreamOptions {
  systemPrompt: string;
  conversationHistory: ConversationTurnMessage[];
  userMessage: string;
  image?: SupportAgentImage | null;
  tools: ToolSet;
  abortSignal?: AbortSignal;
}

export async function streamMavenAgent(
  dependencies: SupportAgentDependencies,
  options: MavenAgentStreamOptions,
): Promise<SupportAgentResult> {
  const model = (dependencies.createModel ?? createLanguageModel)(
    dependencies.modelConfig,
  );

  const messages = toSdkConversationMessages(options.conversationHistory);
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mediaType?: string }
  > = [{ type: "text", text: options.userMessage }];

  if (options.image) {
    userContent.push({
      type: "image",
      image: options.image.base64,
      // AI SDK v6 ImagePart uses `mediaType` (v4's `mimeType` is ignored).
      mediaType: options.image.mimeType,
    });
  }

  const agent = new ToolLoopAgent({
    model,
    instructions: options.systemPrompt,
    tools: options.tools,
    stopWhen: stepCountIs(8),
    toolChoice: Object.keys(options.tools).length ? "auto" : "none",
    temperature: 0.3,
    maxOutputTokens: 2048,
  });

  const result = await agent.stream({
    messages: [...messages, { role: "user", content: userContent }],
    abortSignal: options.abortSignal,
  });

  return {
    fullStream: result.fullStream as SupportAgentResult["fullStream"],
  };
}
