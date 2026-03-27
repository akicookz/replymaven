import { ToolLoopAgent, stepCountIs } from "ai";
import {
  type SupportAgentDependencies,
  type SupportAgentResult,
  type SupportAgentStreamOptions,
  toSdkConversationMessages,
} from "../types";
import { createLanguageModel } from "../llm/create-language-model";
import { buildToolRegistry } from "../tools/build-tool-registry";

export async function streamSupportAgent(
  dependencies: SupportAgentDependencies,
  options: SupportAgentStreamOptions,
): Promise<SupportAgentResult> {
  const model = createLanguageModel(dependencies.modelConfig);
  const toolRegistry = options.tools?.length
    ? buildToolRegistry(options.tools)
    : {};

  const agent = new ToolLoopAgent({
    model,
    instructions: options.systemPrompt,
    tools: toolRegistry,
    stopWhen: options.tools?.length ? stepCountIs(3) : undefined,
    toolChoice: "auto",
    temperature: 0.3,
    maxOutputTokens: 2048,
  });

  const messages = toSdkConversationMessages(options.conversationHistory);
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mimeType?: string }
  > = [{ type: "text", text: options.userMessage }];

  if (options.image) {
    userContent.push({
      type: "image",
      image: options.image.base64,
      mimeType: options.image.mimeType,
    });
  }

  const result = await agent.stream({
    messages: [...messages, { role: "user", content: userContent }],
    abortSignal: options.abortSignal,
    experimental_onToolCallStart: options.onToolCallStart
      ? (event) => {
          const toolCall = event.toolCall;
          options.onToolCallStart!({
            toolName: String(toolCall.toolName),
            input: toolCall.input as Record<string, unknown>,
          });
        }
      : undefined,
    experimental_onToolCallFinish: options.onToolCallFinish
      ? (event) => {
          const toolCall = event.toolCall;
          options.onToolCallFinish!({
            toolName: String(toolCall.toolName),
            input: toolCall.input as Record<string, unknown>,
            output: "output" in event ? event.output : null,
            error: "error" in event ? event.error : null,
            durationMs: event.durationMs,
            success: event.success,
          });
        }
      : undefined,
  });

  return {
    fullStream: result.fullStream as SupportAgentResult["fullStream"],
  };
}
