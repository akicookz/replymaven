import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { type SupportToolDefinition } from "../types";

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

export function buildToolRegistry(
  toolDefs: SupportToolDefinition[],
): ToolSet {
  const tools: ToolSet = {};

  for (const toolDef of toolDefs) {
    if (!toolDef.enabled) continue;

    const params = JSON.parse(toolDef.parameters) as Array<{
      name: string;
      type: "string" | "number" | "boolean";
      description: string;
      required: boolean;
      enum?: string[];
    }>;

    const shape: Record<string, z.ZodType> = {};
    for (const param of params) {
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

    tools[toolDef.name] = tool({
      description: toolDef.description,
      inputSchema: z.object(shape),
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
