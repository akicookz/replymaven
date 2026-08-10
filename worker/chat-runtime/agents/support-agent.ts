import {
  ToolLoopAgent,
  stepCountIs,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
  type ToolSet,
} from "ai";
import {
  type SupportAgentDependencies,
  type SupportAgentResult,
  type SupportAgentImage,
  type ConversationTurnMessage,
  toPublicSdkConversationMessages,
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

type LanguageModelV3 = Extract<
  LanguageModel,
  { specificationVersion: "v3" }
>;

class ModelAttemptTerminationError extends Error {
  constructor() {
    super("Unable to stop failed model attempt safely");
    this.name = "ModelAttemptTerminationError";
  }
}

function isLanguageModelV3(model: LanguageModel): model is LanguageModelV3 {
  return typeof model === "object" &&
    model !== null &&
    model.specificationVersion === "v3";
}

function createTerminalProviderStream<
  Part extends { type: string; error?: unknown },
>(source: ReadableStream<Part>): ReadableStream<Part> {
  const reader = source.getReader();
  let terminal = false;

  return new ReadableStream<Part>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (terminal) return;
        if (next.done) {
          terminal = true;
          controller.close();
          return;
        }

        if (next.value.type === "error") {
          terminal = true;
          const providerError = next.value.error;
          try {
            await reader.cancel(providerError);
          } catch {
            controller.error(new ModelAttemptTerminationError());
            return;
          }
          controller.error(providerError);
          return;
        }

        controller.enqueue(next.value);
      } catch (error) {
        terminal = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (terminal) return;
      terminal = true;
      await reader.cancel(reason);
    },
  });
}

const terminalProviderErrorMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  async wrapStream({ doStream }) {
    const result = await doStream();
    return {
      ...result,
      stream: createTerminalProviderStream(result.stream),
    };
  },
};

function guardProviderErrorParts(model: LanguageModel): LanguageModel {
  if (!isLanguageModelV3(model)) return model;
  return wrapLanguageModel({
    model,
    middleware: terminalProviderErrorMiddleware,
  });
}

export async function streamMavenAgent(
  dependencies: SupportAgentDependencies,
  options: MavenAgentStreamOptions,
): Promise<SupportAgentResult> {
  const model = guardProviderErrorParts(
    (dependencies.createModel ?? createLanguageModel)(
      dependencies.modelConfig,
    ),
  );

  const messages = toPublicSdkConversationMessages(options.conversationHistory);
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
