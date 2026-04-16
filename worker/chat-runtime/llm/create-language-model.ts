import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel } from "ai";
import { type ChatRuntimeAiConfig } from "../types";
import { logError, logInfo, logWarn } from "../../observability";

const OPENAI_FALLBACK_MODEL = "gpt-5-chat-latest";
const GEMINI_FALLBACK_MODEL = "gemini-3-flash-preview";

export type AiProvider = "openai" | "google";

export interface ModelRuntimeState {
  activeConfig: ChatRuntimeAiConfig;
  fallbackConfig: ChatRuntimeAiConfig | null;
  hasUsedFallback: boolean;
}

interface RunWithModelFallbackOptions<T> {
  runtime: ModelRuntimeState;
  stage: string;
  operation: (config: ChatRuntimeAiConfig) => Promise<T>;
  logContext?: Record<string, unknown>;
  canRetry?: (error: unknown) => boolean;
  getRetryContext?: () => Record<string, unknown>;
}

function isOpenAiModel(model: string): boolean {
  return model.startsWith("gpt");
}

function getProvider(model: string): AiProvider {
  return isOpenAiModel(model) ? "openai" : "google";
}

function hasApiKey(provider: AiProvider, config: ChatRuntimeAiConfig): boolean {
  const apiKey =
    provider === "openai" ? config.openaiApiKey : config.geminiApiKey;
  return apiKey.trim().length > 0;
}

function buildLogContext(
  options: RunWithModelFallbackOptions<unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stage: options.stage,
    activeModel: options.runtime.activeConfig.model,
    activeProvider: getProvider(options.runtime.activeConfig.model),
    fallbackModel: options.runtime.fallbackConfig?.model ?? null,
    fallbackProvider: options.runtime.fallbackConfig
      ? getProvider(options.runtime.fallbackConfig.model)
      : null,
    fallbackUsed: options.runtime.hasUsedFallback,
    ...options.logContext,
    ...(options.getRetryContext?.() ?? {}),
    ...extra,
  };
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const record = error as unknown as Record<string, unknown>;
    const cause = record.cause;
    const data = record.data;
    const responseBody =
      typeof record.responseBody === "string"
        ? record.responseBody.slice(0, 1000)
        : undefined;
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 800),
      errorStatus:
        typeof record.status === "number"
          ? record.status
          : typeof record.statusCode === "number"
            ? record.statusCode
            : undefined,
      errorUrl: typeof record.url === "string" ? record.url : undefined,
      errorResponseBody: responseBody,
      errorData:
        data && typeof data === "object"
          ? JSON.stringify(data).slice(0, 800)
          : undefined,
      errorCause:
        cause instanceof Error
          ? { name: cause.name, message: cause.message.slice(0, 400) }
          : undefined,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      errorName: typeof record.name === "string" ? record.name : "unknown",
      errorMessage:
        typeof record.message === "string"
          ? record.message.slice(0, 800)
          : JSON.stringify(record).slice(0, 800),
      errorStatus:
        typeof record.status === "number"
          ? record.status
          : typeof record.statusCode === "number"
            ? record.statusCode
            : undefined,
    };
  }

  return { errorName: "unknown", errorMessage: String(error).slice(0, 800) };
}

function isStatusCodeCandidate(value: unknown): boolean {
  return typeof value === "number" && value >= 400;
}

function getRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return key in record ? record[key] : undefined;
}

export function isProviderLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    if (
      error.name === "AI_NoObjectGeneratedError" ||
      error.name === "AI_NoOutputGeneratedError"
    ) {
      return true;
    }

    const normalized = `${error.name} ${error.message}`.toLowerCase();
    if (
      /(api|provider|rate limit|quota|timeout|timed out|overloaded|service unavailable|gateway|upstream|network|fetch failed|connection|socket|stream|unauthorized|forbidden|authentication|invalid api key|503|502|504|500)/.test(
        normalized,
      )
    ) {
      return true;
    }
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const candidateValues = [
      getRecordValue(record, "status"),
      getRecordValue(record, "statusCode"),
      getRecordValue(record, "responseStatus"),
    ];
    if (candidateValues.some(isStatusCodeCandidate)) {
      return true;
    }
  }

  return false;
}

export function createLanguageModel(
  config: ChatRuntimeAiConfig,
): LanguageModel {
  if (isOpenAiModel(config.model)) {
    const provider = createOpenAI({ apiKey: config.openaiApiKey });
    return provider(config.model);
  }

  const provider = createGoogleGenerativeAI({
    apiKey: config.geminiApiKey,
  });
  return provider(config.model);
}

export function resolveFallbackModelConfig(
  config: ChatRuntimeAiConfig,
): ChatRuntimeAiConfig | null {
  if (isOpenAiModel(config.model)) {
    if (!hasApiKey("google", config)) return null;
    return {
      ...config,
      model: GEMINI_FALLBACK_MODEL,
    };
  }

  if (!hasApiKey("openai", config)) return null;
  return {
    ...config,
    model: OPENAI_FALLBACK_MODEL,
  };
}

export function createModelRuntimeState(
  primaryConfig: ChatRuntimeAiConfig,
): ModelRuntimeState {
  return {
    activeConfig: primaryConfig,
    fallbackConfig: resolveFallbackModelConfig(primaryConfig),
    hasUsedFallback: false,
  };
}

export async function runWithModelFallback<T>(
  options: RunWithModelFallbackOptions<T>,
): Promise<T> {
  try {
    return await options.operation(options.runtime.activeConfig);
  } catch (error) {
    const errorSummary = summarizeError(error);

    logWarn(
      "ai_primary.failed",
      buildLogContext(options, errorSummary),
    );

    if (!isProviderLikeError(error)) {
      logWarn(
        "ai_fallback.suppressed",
        buildLogContext(options, {
          reason: "non_provider_error",
          ...errorSummary,
        }),
      );
      throw error;
    }

    if (options.runtime.hasUsedFallback) {
      logWarn(
        "ai_fallback.suppressed",
        buildLogContext(options, {
          reason: "fallback_already_used",
          ...errorSummary,
        }),
      );
      throw error;
    }

    if (!options.runtime.fallbackConfig) {
      logWarn(
        "ai_fallback.suppressed",
        buildLogContext(options, {
          reason: "fallback_unavailable",
          ...errorSummary,
        }),
      );
      throw error;
    }

    if (
      options.canRetry &&
      !options.canRetry(error)
    ) {
      logWarn(
        "ai_fallback.suppressed",
        buildLogContext(options, {
          reason: "retry_guard_blocked",
          ...errorSummary,
        }),
      );
      throw error;
    }

    const fallbackConfig = options.runtime.fallbackConfig;
    logWarn(
      "ai_fallback.attempted",
      buildLogContext(options, {
        primaryModel: options.runtime.activeConfig.model,
        fallbackModel: fallbackConfig.model,
        ...errorSummary,
      }),
    );

    try {
      const result = await options.operation(fallbackConfig);
      options.runtime.activeConfig = fallbackConfig;
      options.runtime.hasUsedFallback = true;
      options.runtime.fallbackConfig = null;
      logInfo(
        "ai_fallback.succeeded",
        buildLogContext(options, {
          activeModel: options.runtime.activeConfig.model,
          fallbackModel: fallbackConfig.model,
        }),
      );
      return result;
    } catch (fallbackError) {
      logError(
        "ai_fallback.exhausted",
        fallbackError,
        buildLogContext(options, {
          primaryModel: options.runtime.activeConfig.model,
          fallbackModel: fallbackConfig.model,
          ...summarizeError(fallbackError),
        }),
      );
      throw fallbackError;
    }
  }
}
