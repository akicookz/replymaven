import { tool, type ToolSet } from "ai";
import { isReservedMavenToolName } from "../../validation";
import {
  type MavenToolCapability,
  type MavenToolDefinition,
  type MavenTurnContext,
} from "../types";
import { authorizeCapability } from "./tool-capability";

export interface SafeToolActivity {
  toolId: string;
  displayName: string;
  source: MavenToolCapability["source"];
  status: "started" | "success" | "error";
  durationMs: number;
}

export interface MavenToolRegistryResult {
  tools: ToolSet;
  capabilities: Map<string, MavenToolCapability>;
}

interface MavenToolRegistryOptions {
  context: MavenTurnContext;
  definitions: MavenToolDefinition[];
  onStart?: (event: SafeToolActivity) => void;
  onFinish?: (event: SafeToolActivity) => void;
}

function isPublicMcpTool(
  context: MavenTurnContext,
  capability: MavenToolCapability,
): boolean {
  return context.channel === "public" && capability.source === "mcp";
}

function createActivity(
  capability: MavenToolCapability,
  status: SafeToolActivity["status"],
  durationMs: number,
): SafeToolActivity {
  return {
    toolId: capability.id,
    displayName: capability.displayName,
    source: capability.source,
    status,
    durationMs,
  };
}

function isErrorResult(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      "error" in (result as Record<string, unknown>),
  );
}

function notifyActivity(
  callback: ((event: SafeToolActivity) => void) | undefined,
  activity: SafeToolActivity,
): void {
  try {
    callback?.(activity);
  } catch {
    // Activity collection must never change tool execution semantics.
  }
}

export function buildMavenToolRegistry(
  options: MavenToolRegistryOptions,
): MavenToolRegistryResult {
  const tools: ToolSet = {};
  const capabilities = new Map<string, MavenToolCapability>();

  for (const definition of options.definitions) {
    const capability = definition.capability;
    if (isPublicMcpTool(options.context, capability)) continue;
    if (
      capability.source !== "internal" &&
      isReservedMavenToolName(capability.modelName)
    ) {
      continue;
    }

    const registeredCapability = capabilities.get(capability.modelName);
    if (registeredCapability?.source === "internal") continue;
    if (registeredCapability && capability.source !== "internal") continue;

    const initialAuthorization = authorizeCapability(options.context, capability);
    if (!initialAuthorization.ok) continue;

    capabilities.set(capability.modelName, capability);
    tools[capability.modelName] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input, { abortSignal }) => {
        const startedAt = Date.now();
        notifyActivity(
          options.onStart,
          createActivity(capability, "started", 0),
        );

        try {
          const authoritative = await definition.reauthorize();
          let result: unknown;

          if (!authoritative) {
            result = { error: "tool_unavailable" };
          } else if (isPublicMcpTool(options.context, authoritative)) {
            result = { error: "channel_not_allowed" };
          } else {
            const authorization = authorizeCapability(
              options.context,
              authoritative,
            );
            if (!authorization.ok) {
              result = { error: authorization.code };
            } else if (
              authoritative.schemaFingerprint !== capability.schemaFingerprint
            ) {
              result = { error: "tool_schema_changed" };
            } else {
              result = await definition.execute(input, { abortSignal });
            }
          }

          notifyActivity(
            options.onFinish,
            createActivity(
              capability,
              isErrorResult(result) ? "error" : "success",
              Date.now() - startedAt,
            ),
          );
          return result;
        } catch (error) {
          notifyActivity(
            options.onFinish,
            createActivity(capability, "error", Date.now() - startedAt),
          );
          throw error;
        }
      },
    });
  }

  return { tools, capabilities };
}
