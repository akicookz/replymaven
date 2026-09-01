import { dynamicTool, jsonSchema } from "ai";
import type { KnowledgeChangePreview } from "../../../shared/knowledge-change";
import type { SidechatToolPresentation } from "../../../shared/sidechat-agent";
import type { ExecuteProjectToolResult } from "../../../shared/sidechat-agent";

export const LIST_KNOWLEDGE_TOOL_NAME = "list_knowledge";
export const READ_KNOWLEDGE_TOOL_NAME = "read_knowledge";
export const APPLY_KNOWLEDGE_CHANGE_TOOL_NAME = "apply_knowledge_change";

export const KNOWLEDGE_WRITE_TOOL_NAMES = new Set([
  APPLY_KNOWLEDGE_CHANGE_TOOL_NAME,
]);

export const NATIVE_KNOWLEDGE_TOOL_NAMES = new Set([
  "search_knowledge",
  LIST_KNOWLEDGE_TOOL_NAME,
  READ_KNOWLEDGE_TOOL_NAME,
  APPLY_KNOWLEDGE_CHANGE_TOOL_NAME,
]);

const DOCS_SOURCE = { kind: "http" as const, name: "Docs", icon: null };

function docsPresentation(displayName: string): SidechatToolPresentation {
  return { displayName, source: DOCS_SOURCE };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const listInputSchema = jsonSchema<{ query?: string }>({
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Optional title or URL fragment. Omit to list recent resources.",
    },
  },
});

const readInputSchema = jsonSchema<{
  resourceId?: string;
  title?: string;
  url?: string;
}>({
  type: "object",
  properties: {
    resourceId: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
  },
});

const applyInputSchema = jsonSchema<{
  action: "create_faq" | "update_faq" | "create_webpage" | "reindex";
  title?: string;
  url?: string;
  resourceId?: string;
  description?: string;
  reason?: string;
  pairs?: Array<{ question: string; answer: string }>;
}>({
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["create_faq", "update_faq", "create_webpage", "reindex"],
    },
    title: { type: "string" },
    url: { type: "string" },
    resourceId: { type: "string" },
    description: { type: "string" },
    reason: {
      type: "string",
      description: "Why this change should be applied.",
    },
    pairs: {
      type: "array",
      items: {
        type: "object",
        required: ["question", "answer"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
  },
});

export interface SidechatKnowledgeToolOptions {
  list(input: Record<string, unknown>): Promise<unknown>;
  read(input: Record<string, unknown>): Promise<unknown>;
  prepareChange(
    input: Record<string, unknown>,
  ): Promise<
    | { status: "ready"; preview: KnowledgeChangePreview }
    | { status: "ambiguous"; candidates: unknown; error: string }
    | { status: "failed"; error: string }
  >;
  executeChange(
    input: Record<string, unknown>,
  ): Promise<ExecuteProjectToolResult>;
  approvedToolCallIds: ReadonlySet<string>;
  emitKnowledgeChange(preview: KnowledgeChangePreview, toolCallId: string): void;
  emitActivity(part: {
    type: "data-safe-activity";
    data: {
      label: string;
      status: "started" | "success" | "error";
      tool?: SidechatToolPresentation;
    };
    transient: true;
  }): void;
}

function activity(
  label: string,
  status: "started" | "success" | "error",
  displayName: string,
) {
  return {
    type: "data-safe-activity" as const,
    data: {
      label,
      status,
      tool: docsPresentation(displayName),
    },
    transient: true as const,
  };
}

export interface KnowledgeChangeData {
  type: "data-knowledge-change";
  id: string;
  data: KnowledgeChangePreview & { toolCallId: string };
}

export function knowledgeChangePartId(toolCallId: string): string {
  return `${toolCallId}:knowledge-change`;
}

export function persistKnowledgeChangeParts(
  message: { id: string; parts: Array<Record<string, unknown>> },
  previews: ReadonlyMap<string, KnowledgeChangePreview>,
): boolean {
  let changed = false;
  for (const [toolCallId, preview] of previews) {
    const id = knowledgeChangePartId(toolCallId);
    if (message.parts.some((part) => part.type === "data-knowledge-change" && part.id === id)) {
      continue;
    }
    message.parts.push({
      type: "data-knowledge-change",
      id,
      data: { ...preview, toolCallId },
    });
    changed = true;
  }
  return changed;
}

export function buildSidechatKnowledgeTools(options: SidechatKnowledgeToolOptions) {
  return {
    [LIST_KNOWLEDGE_TOOL_NAME]: dynamicTool({
      title: "List knowledge",
      description:
        "List or search this project's knowledge resources by title or URL. Returns candidates, not full content.",
      inputSchema: listInputSchema,
      async execute(input) {
        if (input !== undefined && !isRecord(input)) {
          return { error: "invalid_tool_input" };
        }
        options.emitActivity(activity("List", "started", "List"));
        try {
          const result = await options.list(isRecord(input) ? input : {});
          options.emitActivity(activity("List", "success", "List"));
          return result;
        } catch {
          options.emitActivity(activity("List", "error", "List"));
          return { error: "tool_unavailable" };
        }
      },
    }),
    [READ_KNOWLEDGE_TOOL_NAME]: dynamicTool({
      title: "Read knowledge",
      description:
        "Read one knowledge resource by resourceId, exact URL, or title. If several match, returns candidates.",
      inputSchema: readInputSchema,
      async execute(input) {
        if (!isRecord(input)) return { error: "invalid_tool_input" };
        options.emitActivity(activity("Read", "started", "Read"));
        try {
          const result = await options.read(input);
          options.emitActivity(activity("Read", "success", "Read"));
          return result;
        } catch {
          options.emitActivity(activity("Read", "error", "Read"));
          return { error: "tool_unavailable" };
        }
      },
    }),
    [APPLY_KNOWLEDGE_CHANGE_TOOL_NAME]: dynamicTool({
      title: "Apply knowledge change",
      description:
        "Propose a knowledge-base change for the human to approve: create or update an FAQ, add a webpage, or reindex. The change is never applied until the human approves the card.",
      inputSchema: applyInputSchema,
      async needsApproval(input, context) {
        if (!isRecord(input)) return false;
        const prepared = await options.prepareChange(input);
        if (prepared.status !== "ready") return false;
        options.emitKnowledgeChange(prepared.preview, context.toolCallId);
        return true;
      },
      async execute(input, context) {
        if (!isRecord(input)) return { error: "invalid_tool_input" };
        if (!options.approvedToolCallIds.has(context.toolCallId)) {
          return { error: "approval_required" };
        }
        options.emitActivity(activity("Apply", "started", "Apply"));
        try {
          const result = await options.executeChange(input);
          options.emitActivity(activity(
            result.status === "completed" ? result.safeActivity : "Apply",
            result.status === "completed" ? "success" : "error",
            "Apply",
          ));
          if (result.status === "completed") {
            return { ok: true, output: result.output ?? null };
          }
          return { error: result.errorCode ?? result.status };
        } catch {
          options.emitActivity(activity("Apply", "error", "Apply"));
          return { error: "tool_unavailable" };
        }
      },
    }),
  };
}
