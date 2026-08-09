import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { type ToolRow } from "../../db";
import { type ChatService } from "../../services/chat-service";
import {
  decryptHeaders,
  isEncrypted,
} from "../../services/encryption-service";
import {
  type MavenToolCapability,
  type MavenToolDefinition,
  type MavenTurnContext,
  type SupportToolDefinition,
} from "../types";
import {
  authorizeCapability,
  fingerprintJsonSchema,
  parseAllowedChannels,
} from "./tool-capability";

interface HttpToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}

interface AuthoritativeHttpToolStore {
  getAuthoritativeTool(
    projectId: string,
    toolId: string,
  ): Promise<ToolRow | null>;
  logExecution(data: {
    toolId: string;
    conversationId?: string | null;
    input: Record<string, unknown>;
    output: unknown;
    status: "success" | "error" | "timeout";
    httpStatus?: number | null;
    duration: number;
    errorMessage?: string | null;
  }): Promise<{ id: string }>;
}

interface PublicHttpExecutionOptions {
  chatService: Pick<ChatService, "runExternalActionIfOwnershipMatches">;
  acquireRateLimitPermit(): boolean;
}

interface CreateHttpToolDefinitionOptions {
  context: MavenTurnContext;
  tool: ToolRow;
  toolService: AuthoritativeHttpToolStore;
  encryptionKey: string;
  publicExecution?: PublicHttpExecutionOptions;
  collectExecutionId?(id: string): void;
}

interface HttpExecutionOutcome {
  result: Record<string, unknown>;
  attemptedFetch: boolean;
  duration: number;
  httpStatus: number | null;
  status: "success" | "error" | "timeout";
  errorMessage: string | null;
}

type HttpAbortCause = "caller" | "timeout";

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isUrlBlocked(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return true;
  }
}

function getNestedValue(
  obj: unknown,
  path: string,
): unknown {
  if (!path) return obj;
  return path.split(".").reduce((current, key) => {
    if (
      current &&
      typeof current === "object" &&
      key in (current as Record<string, unknown>)
    ) {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, obj);
}

function parseHttpToolParameters(parameters: string): HttpToolParameter[] {
  return JSON.parse(parameters) as HttpToolParameter[];
}

function buildHttpInputSchema(parameters: string): z.ZodObject {
  const shape: Record<string, z.ZodType> = Object.create(null) as Record<
    string,
    z.ZodType
  >;

  for (const param of parseHttpToolParameters(parameters)) {
    let paramSchema: z.ZodType;
    switch (param.type) {
      case "number":
        paramSchema = z.number().describe(param.description);
        break;
      case "boolean":
        paramSchema = z.boolean().describe(param.description);
        break;
      default:
        paramSchema = param.enum?.length
          ? z.enum(param.enum as [string, ...string[]]).describe(param.description)
          : z.string().describe(param.description);
        break;
    }

    if (!param.required) {
      paramSchema = paramSchema.optional();
    }

    shape[param.name] = paramSchema;
  }

  return z.object(shape);
}

function toHttpExecutionDefinition(toolRow: ToolRow): SupportToolDefinition {
  return {
    name: toolRow.name,
    displayName: toolRow.displayName,
    description: toolRow.description,
    endpoint: toolRow.endpoint,
    method: toolRow.method,
    headers: toolRow.headers,
    parameters: toolRow.parameters,
    responseMapping: toolRow.responseMapping,
    enabled: toolRow.enabled,
    timeout: toolRow.timeout,
  };
}

async function toHttpCapability(
  toolRow: ToolRow,
): Promise<MavenToolCapability> {
  return {
    id: toolRow.id,
    projectId: toolRow.projectId,
    connectionId: null,
    modelName: toolRow.name,
    displayName: toolRow.displayName,
    source: "http",
    allowedChannels: parseAllowedChannels(toolRow.allowedChannels),
    access: toolRow.access,
    enabled: toolRow.enabled,
    schemaFingerprint: await fingerprintJsonSchema(
      parseHttpToolParameters(toolRow.parameters),
    ),
  };
}

async function executeHttpToolWithOutcome(
  toolDef: SupportToolDefinition,
  params: Record<string, unknown>,
  abortSignal?: AbortSignal,
  acquireRateLimitPermit?: () => boolean,
): Promise<HttpExecutionOutcome> {
  const startedAt = Date.now();
  if (isUrlBlocked(toolDef.endpoint)) {
    return {
      result: {
        error: "This endpoint URL is not allowed for security reasons.",
      },
      attemptedFetch: false,
      duration: Date.now() - startedAt,
      httpStatus: null,
      status: "error",
      errorMessage: "This endpoint URL is not allowed for security reasons.",
    };
  }

  const timeout = toolDef.timeout ?? 10000;
  const controller = new AbortController();
  let abortCause: HttpAbortCause | null = null;

  function abortExecution(cause: HttpAbortCause, reason?: unknown): void {
    if (controller.signal.aborted) return;
    abortCause = cause;
    controller.abort(reason);
  }

  const timeoutId = setTimeout(
    () => abortExecution("timeout", new DOMException("Timed out", "AbortError")),
    timeout,
  );
  let fetchStarted = false;

  function abortFromParent(): void {
    abortExecution("caller", abortSignal?.reason);
  }
  abortSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (abortSignal?.aborted) abortFromParent();

  try {
    if (abortCause === "caller") {
      return {
        result: { error: "Tool execution cancelled by caller" },
        attemptedFetch: false,
        duration: Date.now() - startedAt,
        httpStatus: null,
        status: "error",
        errorMessage: "Tool execution cancelled by caller",
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (toolDef.headers) {
      const customHeaders = JSON.parse(toolDef.headers) as Record<string, string>;
      Object.assign(headers, customHeaders);
    }

    let url = toolDef.endpoint;
    let body: string | undefined;

    if (toolDef.method === "GET") {
      const urlObj = new URL(url);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.set(key, String(value));
        }
      }
      url = urlObj.toString();
    } else {
      body = JSON.stringify(params);
    }

    if (acquireRateLimitPermit && !acquireRateLimitPermit()) {
      return {
        result: { error: "tool_rate_limited" },
        attemptedFetch: false,
        duration: Date.now() - startedAt,
        httpStatus: null,
        status: "error",
        errorMessage: null,
      };
    }
    fetchStarted = true;
    const response = await fetch(url, {
      method: toolDef.method ?? "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    const truncated =
      responseText.length > 10240
        ? `${responseText.slice(0, 10240)}\n...(response truncated)`
        : responseText;

    try {
      const jsonResult = JSON.parse(truncated) as Record<string, unknown>;

      if (toolDef.responseMapping) {
        const mapping = JSON.parse(toolDef.responseMapping) as {
          resultPath?: string;
        };

        let result = jsonResult;
        if (mapping.resultPath) {
          result =
            (getNestedValue(jsonResult, mapping.resultPath) as Record<string, unknown>) ??
            jsonResult;
        }

        const executionResult = {
          success: response.ok,
          httpStatus: response.status,
          data: result,
        };
        return {
          result: executionResult,
          attemptedFetch: true,
          duration: Date.now() - startedAt,
          httpStatus: response.status,
          status: response.ok ? "success" : "error",
          errorMessage: response.ok ? null : `HTTP ${response.status}`,
        };
      }

      const executionResult = {
        success: response.ok,
        httpStatus: response.status,
        data: jsonResult,
      };
      return {
        result: executionResult,
        attemptedFetch: true,
        duration: Date.now() - startedAt,
        httpStatus: response.status,
        status: response.ok ? "success" : "error",
        errorMessage: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch {
      const executionResult = {
        success: response.ok,
        httpStatus: response.status,
        data: truncated,
      };
      return {
        result: executionResult,
        attemptedFetch: true,
        duration: Date.now() - startedAt,
        httpStatus: response.status,
        status: response.ok ? "success" : "error",
        errorMessage: response.ok ? null : `HTTP ${response.status}`,
      };
    }
  } catch (err) {
    if (abortCause === "caller") {
      const errorMessage = "Tool execution cancelled by caller";
      return {
        result: { error: errorMessage },
        attemptedFetch: fetchStarted,
        duration: Date.now() - startedAt,
        httpStatus: null,
        status: "error",
        errorMessage,
      };
    }

    if (abortCause === "timeout") {
      const errorMessage = `Tool execution timed out after ${timeout}ms`;
      return {
        result: { error: errorMessage },
        attemptedFetch: true,
        duration: Date.now() - startedAt,
        httpStatus: null,
        status: "timeout",
        errorMessage,
      };
    }

    const errorMessage =
      err instanceof Error ? err.message : "Tool execution failed";
    return {
      result: { error: errorMessage },
      attemptedFetch: fetchStarted,
      duration: Date.now() - startedAt,
      httpStatus: null,
      status: "error",
      errorMessage,
    };
  } finally {
    clearTimeout(timeoutId);
    abortSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function executeHttpTool(
  toolDef: SupportToolDefinition,
  params: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return (await executeHttpToolWithOutcome(toolDef, params, abortSignal)).result;
}

export async function createHttpToolDefinition(
  options: CreateHttpToolDefinitionOptions,
): Promise<MavenToolDefinition> {
  const capability = await toHttpCapability(options.tool);
  const authorizedExecutions: SupportToolDefinition[] = [];

  return {
    capability,
    description: options.tool.description,
    inputSchema: buildHttpInputSchema(options.tool.parameters),
    async execute(input, { abortSignal }) {
      const executableTool = authorizedExecutions.shift();
      if (!executableTool) return { error: "tool_unavailable" };
      const executableDefinition = executableTool;
      const params = input as Record<string, unknown>;

      async function executeAndAudit(): Promise<Record<string, unknown>> {
        const outcome = await executeHttpToolWithOutcome(
          executableDefinition,
          params,
          abortSignal,
          options.context.channel === "public"
            ? options.publicExecution?.acquireRateLimitPermit
            : undefined,
        );
        if (!outcome.attemptedFetch) return outcome.result;

        try {
          const execution = await options.toolService.logExecution({
            toolId: capability.id,
            conversationId: options.context.conversationId,
            input: params,
            output: outcome.result,
            status: outcome.status,
            httpStatus: outcome.httpStatus,
            duration: outcome.duration,
            errorMessage: outcome.errorMessage?.slice(0, 2000) ?? null,
          });
          try {
            options.collectExecutionId?.(execution.id);
          } catch {
            // Private audit linkage collection must not alter tool semantics.
          }
        } catch {
          // The external side effect already completed. Audit failures must not
          // change the result or make the agent retry the request.
        }
        return outcome.result;
      }

      if (options.context.channel !== "public") {
        return executeAndAudit();
      }
      if (!options.publicExecution) {
        return { error: "conversation_ownership_changed" };
      }
      const leased =
        await options.publicExecution.chatService.runExternalActionIfOwnershipMatches(
          options.context.conversationId,
          options.context.projectId,
          options.context.ownership,
          executeAndAudit,
        );
      return leased.executed
        ? leased.value ?? { error: "tool_unavailable" }
        : { error: "conversation_ownership_changed" };
    },
    async reauthorize() {
      const authoritativeTool = await options.toolService.getAuthoritativeTool(
        options.context.projectId,
        capability.id,
      );
      if (!authoritativeTool) return null;

      const authoritativeCapability = await toHttpCapability(authoritativeTool);
      const authorization = authorizeCapability(
        options.context,
        authoritativeCapability,
      );
      if (
        !authorization.ok ||
        authoritativeCapability.schemaFingerprint !== capability.schemaFingerprint
      ) {
        return authoritativeCapability;
      }

      const executableTool = { ...authoritativeTool };
      if (executableTool.headers && isEncrypted(executableTool.headers)) {
        try {
          const decrypted = await decryptHeaders(
            executableTool.headers,
            options.encryptionKey,
          );
          executableTool.headers = JSON.stringify(decrypted);
        } catch {
          return null;
        }
      }
      authorizedExecutions.push(toHttpExecutionDefinition(executableTool));

      return authoritativeCapability;
    },
  };
}

export function buildToolRegistry(
  toolDefs: SupportToolDefinition[],
): ToolSet {
  const tools: ToolSet = {};

  for (const toolDef of toolDefs) {
    if (!toolDef.enabled) continue;

    tools[toolDef.name] = tool({
      description: toolDef.description,
      inputSchema: buildHttpInputSchema(toolDef.parameters),
      execute: async (input, { abortSignal }) =>
        executeHttpTool(
          toolDef,
          input as Record<string, unknown>,
          abortSignal,
        ),
    });
  }

  return tools;
}
