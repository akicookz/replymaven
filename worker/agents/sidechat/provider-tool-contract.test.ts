import { describe, expect, test } from "bun:test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ToolSet } from "ai";
import { createReplyDraftTool } from "./reply-draft-tool";
import {
  buildSidechatGatewayTools,
  describeSidechatGatewayTool,
  searchSidechatGatewayCatalog,
} from "./project-tool-gateway";
import type { SidechatToolDescriptor } from "../../../shared/sidechat-agent";

function pathologicalDescriptor(): SidechatToolDescriptor {
  return {
    connectionId: "mcp-posthog",
    toolName: "raw_posthog_query",
    exposedName: "tool_mcpposthog_raw_posthog_query",
    displayName: "Raw PostHog query",
    description: "Contains schemas that provider adapters disagree about.",
    inputSchema: {
      type: "object",
      properties: {
        filterGroup: {
          anyOf: [
            {
              type: "object",
              properties: {
                operator: { type: "integer", enum: [1, 2] },
              },
            },
            {
              type: "object",
              properties: {
                impossible: { type: "string", enum: [] },
              },
            },
          ],
        },
      },
    },
    catalogFingerprint: "a".repeat(64),
    audience: "sidechat",
    safety: "read",
    access: "read",
    enabled: true,
    source: { kind: "mcp", name: "PostHog", icon: null },
  };
}

function fixedTools(): ToolSet {
  const descriptor = pathologicalDescriptor();
  return {
    present_reply_draft: createReplyDraftTool(),
    ...buildSidechatGatewayTools({
      search: async (input) =>
        searchSidechatGatewayCatalog([descriptor], input),
      describe: async (input) =>
        describeSidechatGatewayTool(descriptor, input),
      resolve: async () => null,
      execute: async () => ({
        status: "denied",
        safeActivity: "Tool unavailable",
      }),
      stageApproval: async () => false,
      approvedToolCallIds: new Set(),
      executeKnowledge: async () => ({
        status: "completed",
        output: { found: false },
        safeActivity: "Searched knowledge",
      }),
      emitActivity() {},
      rememberToolContext() {},
    }),
  };
}

async function captureProviderRequest(
  provider: "google" | "openai",
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | null = null;
  async function captureFetch(
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (typeof init?.body === "string") {
      captured = JSON.parse(init.body) as Record<string, unknown>;
    }
    throw new Error("request captured");
  }
  const model = provider === "google"
    ? createGoogleGenerativeAI({
        apiKey: "test",
        fetch: captureFetch,
      })("gemini-3.7-flash")
    : createOpenAI({
        apiKey: "test",
        fetch: captureFetch,
      })("gpt-5.6-terra");
  await generateText({
    model,
    prompt: "Inspect the available tools.",
    tools: fixedTools(),
    maxRetries: 0,
  }).catch(() => undefined);
  if (!captured) throw new Error(`Expected ${provider} request`);
  return captured;
}

function providerToolNames(
  provider: "google" | "openai",
  request: Record<string, unknown>,
): string[] {
  if (!Array.isArray(request.tools)) return [];
  if (provider === "openai") {
    return request.tools.flatMap((tool) =>
      tool &&
      typeof tool === "object" &&
      "name" in tool &&
      typeof tool.name === "string"
        ? [tool.name]
        : []
    );
  }
  return request.tools.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("functionDeclarations" in entry) ||
      !Array.isArray(entry.functionDeclarations)
    ) return [];
    return entry.functionDeclarations.flatMap((declaration) =>
      declaration &&
      typeof declaration === "object" &&
      "name" in declaration &&
      typeof declaration.name === "string"
        ? [declaration.name]
        : []
    );
  });
}

function providerToolSchema(
  provider: "google" | "openai",
  request: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  if (!Array.isArray(request.tools)) return null;
  if (provider === "openai") {
    const tool = request.tools.find((candidate) =>
      candidate &&
      typeof candidate === "object" &&
      "name" in candidate &&
      candidate.name === name
    );
    if (!tool || typeof tool !== "object" || !("parameters" in tool)) return null;
    return tool.parameters && typeof tool.parameters === "object"
      ? tool.parameters as Record<string, unknown>
      : null;
  }
  for (const entry of request.tools) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("functionDeclarations" in entry) ||
      !Array.isArray(entry.functionDeclarations)
    ) continue;
    const declaration = entry.functionDeclarations.find((candidate) =>
      candidate &&
      typeof candidate === "object" &&
      "name" in candidate &&
      candidate.name === name
    );
    if (
      declaration &&
      typeof declaration === "object" &&
      "parameters" in declaration &&
      declaration.parameters &&
      typeof declaration.parameters === "object"
    ) {
      return declaration.parameters as Record<string, unknown>;
    }
  }
  return null;
}

describe("Sidechat provider tool contract", () => {
  test.each(["google", "openai"] as const)(
    "%s receives only fixed declarations",
    async (provider) => {
      const request = await captureProviderRequest(provider);
      const serialized = JSON.stringify(request);
      expect(providerToolNames(provider, request).sort()).toEqual([
        "call_project_tool",
        "describe_project_tool",
        "present_reply_draft",
        "search_knowledge",
        "search_project_tools",
      ]);

      expect(serialized).toContain("search_knowledge");
      expect(serialized).toContain("search_project_tools");
      expect(serialized).toContain("describe_project_tool");
      expect(serialized).toContain("call_project_tool");
      expect(serialized).toContain("present_reply_draft");
      expect(serialized).not.toContain("raw_posthog_query");
      expect(serialized).not.toContain("filterGroup");
      expect(serialized).not.toContain('"enum":[]');
      expect(serialized).not.toContain('"enum":[1,2]');
      const callSchema = providerToolSchema(
        provider,
        request,
        "call_project_tool",
      );
      expect(callSchema).toMatchObject({
        type: "object",
        required: ["toolRef", "argumentsJson"],
        properties: {
          toolRef: { type: "string" },
          argumentsJson: {
            type: "string",
            minLength: 2,
          },
        },
      });
      if (provider === "openai") {
        expect(callSchema).toMatchObject({
          properties: {
            argumentsJson: { maxLength: 20_000 },
          },
        });
      } else {
        expect(callSchema).not.toHaveProperty(
          "properties.argumentsJson.maxLength",
        );
      }
      expect(serialized).not.toContain('"arguments":{"type":"object"}');
    },
  );
});
