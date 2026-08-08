import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { type ToolRow } from "../../db";
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
}

interface CreateHttpToolDefinitionOptions {
  context: MavenTurnContext;
  tool: ToolRow;
  toolService: AuthoritativeHttpToolStore;
  encryptionKey: string;
}

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

export async function executeHttpTool(
  toolDef: SupportToolDefinition,
  params: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (isUrlBlocked(toolDef.endpoint)) {
    return {
      error: "This endpoint URL is not allowed for security reasons.",
    };
  }

  const timeout = toolDef.timeout ?? 10000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (abortSignal) {
    abortSignal.addEventListener("abort", () => controller.abort());
  }

  try {
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

        return {
          success: response.ok,
          httpStatus: response.status,
          data: result,
        };
      }

      return {
        success: response.ok,
        httpStatus: response.status,
        data: jsonResult,
      };
    } catch {
      return {
        success: response.ok,
        httpStatus: response.status,
        data: truncated,
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: `Tool execution timed out after ${timeout}ms` };
    }

    return {
      error: err instanceof Error ? err.message : "Tool execution failed",
    };
  }
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

      return executeHttpTool(
        executableTool,
        input as Record<string, unknown>,
        abortSignal,
      );
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
          executableTool.headers = null;
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
