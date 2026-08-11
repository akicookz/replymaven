import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { type ToolRow } from "../../db";
import {
  httpToolModelContractSchema,
  toolParameterSchema,
} from "../../validation";
import { type ChatService } from "../../services/chat-service";
import {
  decryptHeaders,
  isEncrypted,
} from "../../services/encryption-service";
import {
  type MavenToolCapability,
  type MavenToolDefinition,
  type SupportToolDefinition,
} from "../types";
import { type PublicMavenTurnContext } from "../orchestration/run-maven-turn";
import {
  authorizeCapability,
  fingerprintHttpToolContract,
  parseAllowedChannels,
} from "./tool-capability";

type HttpToolParameter = z.infer<typeof toolParameterSchema>;
type HttpToolModelContract = z.infer<typeof httpToolModelContractSchema>;

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
  context: PublicMavenTurnContext;
  tool: ToolRow;
  toolService: AuthoritativeHttpToolStore;
  encryptionKey: string;
  publicExecution: PublicHttpExecutionOptions;
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

export interface PreparedHttpToolRequest {
  tool: SupportToolDefinition;
  params: Record<string, unknown>;
  encryptionKey?: string;
  acquireRateLimitPermit?: () => boolean;
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
  /^\[f[cd][0-9a-f]*:/i,
  /^\[fe[89ab][0-9a-f]*:/i,
];

function isUrlBlocked(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
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

function parseHttpToolParameters(parameters: string): HttpToolParameter[] | null {
  try {
    const parsed: unknown = JSON.parse(parameters);
    const result = z.array(toolParameterSchema).max(10).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseHttpToolModelContract(
  toolRow: ToolRow,
): HttpToolModelContract | null {
  try {
    const parameters: unknown = JSON.parse(toolRow.parameters);
    const result = httpToolModelContractSchema.safeParse({
      name: toolRow.name,
      description: toolRow.description,
      parameters,
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function buildHttpInputSchema(parameters: string): z.ZodObject {
  const shape: Record<string, z.ZodType> = Object.create(null) as Record<
    string,
    z.ZodType
  >;

  for (const param of parseHttpToolParameters(parameters) ?? []) {
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
): Promise<MavenToolCapability | null> {
  const contract = parseHttpToolModelContract(toolRow);
  if (!contract) return null;
  return {
    id: toolRow.id,
    projectId: toolRow.projectId,
    connectionId: null,
    modelName: contract.name,
    displayName: toolRow.displayName,
    source: "http",
    allowedChannels: parseAllowedChannels(toolRow.allowedChannels),
    access: toolRow.access,
    enabled: toolRow.enabled,
    schemaFingerprint: await fingerprintHttpToolContract(contract),
  };
}

function toUnavailableHttpCapability(toolRow: ToolRow): MavenToolCapability {
  return {
    id: toolRow.id,
    projectId: toolRow.projectId,
    connectionId: null,
    modelName: toolRow.name,
    displayName: toolRow.displayName,
    source: "http",
    allowedChannels: [],
    access: toolRow.access,
    enabled: false,
    schemaFingerprint: "invalid-http-contract",
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

    const headers = new Headers({ "Content-Type": "application/json" });

    if (toolDef.headers) {
      const parsedHeaders = z.record(
        z.string().min(1).max(256),
        z.string().max(2048),
      ).safeParse(JSON.parse(toolDef.headers) as unknown);
      if (!parsedHeaders.success) throw new Error("Invalid tool headers");
      for (const [name, value] of Object.entries(parsedHeaders.data)) {
        headers.set(name, value);
      }
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

    const truncated = await readBoundedResponseText(response, 10_240);

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

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let truncated = false;

  try {
    while (receivedBytes <= maximumBytes) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maximumBytes + 1 - receivedBytes;
      const selected = next.value.byteLength > remaining
        ? next.value.slice(0, remaining)
        : next.value;
      chunks.push(selected);
      receivedBytes += selected.byteLength;
      if (next.value.byteLength > remaining || receivedBytes > maximumBytes) {
        truncated = true;
        try {
          await reader.cancel("response_size_limit");
        } catch {
          // The bounded prefix is still valid even if the source rejects cancel.
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(Math.min(receivedBytes, maximumBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= bytes.byteLength) break;
    const selected = chunk.slice(0, bytes.byteLength - offset);
    bytes.set(selected, offset);
    offset += selected.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return truncated ? `${text}\n...(response truncated)` : text;
}

export async function executeHttpToolRequest(
  request: PreparedHttpToolRequest,
  options: { abortSignal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const executableTool = { ...request.tool };
  if (executableTool.headers && isEncrypted(executableTool.headers)) {
    if (!request.encryptionKey) return { error: "tool_unavailable" };
    try {
      executableTool.headers = JSON.stringify(
        await decryptHeaders(executableTool.headers, request.encryptionKey),
      );
    } catch {
      return { error: "tool_unavailable" };
    }
  }
  return (
    await executeHttpToolWithOutcome(
      executableTool,
      request.params,
      options.abortSignal,
      request.acquireRateLimitPermit,
    )
  ).result;
}

export async function executeHttpTool(
  toolDef: SupportToolDefinition,
  params: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return executeHttpToolRequest(
    { tool: toolDef, params },
    { abortSignal },
  );
}

export async function createHttpToolDefinition(
  options: CreateHttpToolDefinitionOptions,
): Promise<MavenToolDefinition> {
  const capability =
    (await toHttpCapability(options.tool)) ??
    toUnavailableHttpCapability(options.tool);
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
          options.publicExecution.acquireRateLimitPermit,
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
      if (!authoritativeCapability) return null;
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
