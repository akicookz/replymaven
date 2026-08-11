import type { JSONSchema7 } from "json-schema";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import type {
  ExecuteProjectToolRequest,
  ExecuteProjectToolResult,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
} from "../../../shared/sidechat-agent";
import type { ToolRow } from "../../db";
import {
  httpToolModelContractSchema,
  isReservedMavenToolName,
  toolAudienceSchema,
} from "../../validation";
import { fingerprintHttpToolContract } from "../../chat-runtime/tools/tool-capability";

export const INTERNAL_KNOWLEDGE_CONNECTION_ID = "internal:replymaven";
const INTERNAL_KNOWLEDGE_FINGERPRINT = "internal-search-knowledge-v1";
const MAX_SAFE_ACTIVITY_CHARS = 240;

interface SidechatDynamicToolOptions {
  descriptors: SidechatToolDescriptor[];
  childName: string;
  conversationId: string;
  actorUserId: string;
  execute(request: ExecuteProjectToolRequest): Promise<ExecuteProjectToolResult>;
  emitActivity(part: {
    type: "data-safe-activity";
    data: {
      label: string;
      status: "started" | "success" | "error";
    };
    transient: true;
  }): void;
}

interface SidechatProjectToolDependencies {
  isRegisteredSidechat(
    childName: string,
    conversationId: string,
  ): boolean | Promise<boolean>;
  getConversation(): Promise<{ archivedAt: Date | number | null } | null>;
  canActorAccessProject(actorUserId: string): Promise<boolean>;
  getAuthoritativeHttpTool(toolId: string): Promise<ToolRow | null>;
  getAuthoritativeMcpTool(
    connectionId: string,
    toolName: string,
  ): Promise<SidechatToolDescriptor | null> | SidechatToolDescriptor | null;
  runKnowledgeSearch(input: unknown): Promise<unknown>;
  runExternalAction(
    action: () => Promise<unknown>,
  ): Promise<{ executed: boolean; value?: unknown }>;
  executeHttpTool(tool: ToolRow, input: unknown): Promise<unknown>;
  executeMcpTool(
    connectionId: string,
    toolName: string,
    input: unknown,
  ): Promise<unknown>;
  writeAudit(
    metadata: SidechatToolAuditMetadata,
  ): void | Promise<void>;
}

interface ExecuteSidechatProjectToolOptions {
  projectId: string;
  request: ExecuteProjectToolRequest;
  dependencies: SidechatProjectToolDependencies;
  now?: () => number;
}

export type AgentSqlTag = <
  T = Record<string, string | number | boolean | null>,
>(
  strings: TemplateStringsArray,
  ...values: Array<string | number | boolean | null>
) => T[];

function knowledgeDescriptor(): SidechatToolDescriptor {
  return {
    connectionId: INTERNAL_KNOWLEDGE_CONNECTION_ID,
    toolName: "search_knowledge",
    exposedName: "search_knowledge",
    displayName: "Search knowledge",
    description:
      "Search the project's knowledge base for documented facts needed to help the human agent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 220 },
      },
    },
    catalogFingerprint: INTERNAL_KNOWLEDGE_FINGERPRINT,
    audience: "sidechat",
    access: "read",
    enabled: true,
  };
}

function readHttpContract(
  tool: ToolRow,
): { name: string; description: string; parameters: Array<{
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}> } | null {
  try {
    const result = httpToolModelContractSchema.safeParse({
      name: tool.name,
      description: tool.description,
      parameters: JSON.parse(tool.parameters) as unknown,
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function isSidechatHttpTool(tool: ToolRow): boolean {
  if (!tool.enabled || isReservedMavenToolName(tool.name)) return false;
  try {
    const channels = toolAudienceSchema.safeParse(
      JSON.parse(tool.allowedChannels) as unknown,
    );
    return (
      channels.success &&
      channels.data.includes("sidechat") &&
      (tool.access === "read" || tool.access === "write") &&
      readHttpContract(tool) !== null
    );
  } catch {
    return false;
  }
}

function httpInputSchema(
  parameters: NonNullable<ReturnType<typeof readHttpContract>>["parameters"],
): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = Object.create(null) as Record<
    string,
    JSONSchema7
  >;
  const required: string[] = [];
  for (const parameter of parameters) {
    properties[parameter.name] = {
      type: parameter.type,
      description: parameter.description || undefined,
      ...(parameter.enum?.length ? { enum: parameter.enum } : {}),
    };
    if (parameter.required) required.push(parameter.name);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  };
}

function validateHttpInput(
  parameters: NonNullable<ReturnType<typeof readHttpContract>>["parameters"],
  input: unknown,
): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const values = input as Record<string, unknown>;
  const allowedNames = new Set(parameters.map((parameter) => parameter.name));
  if (Object.keys(values).some((name) => !allowedNames.has(name))) return null;
  for (const parameter of parameters) {
    const value = values[parameter.name];
    if (value === undefined) {
      if (parameter.required) return null;
      continue;
    }
    if (typeof value !== parameter.type) return null;
    if (
      parameter.enum?.length &&
      (typeof value !== "string" || !parameter.enum.includes(value))
    ) {
      return null;
    }
  }
  return values;
}

async function httpDescriptor(
  tool: ToolRow,
): Promise<SidechatToolDescriptor | null> {
  if (!isSidechatHttpTool(tool)) return null;
  const contract = readHttpContract(tool);
  if (!contract) return null;
  return {
    connectionId: `http:${tool.id}`,
    toolName: contract.name,
    exposedName: contract.name,
    displayName: tool.displayName,
    description: contract.description,
    inputSchema: httpInputSchema(contract.parameters),
    catalogFingerprint: await fingerprintHttpToolContract(contract),
    audience: "sidechat",
    access: tool.access,
    enabled: true,
  };
}

function descriptorMatchesRequest(
  descriptor: SidechatToolDescriptor | null,
  tool: ToolRow | null,
  projectId: string,
  request: ExecuteProjectToolRequest,
): descriptor is SidechatToolDescriptor {
  return Boolean(
    descriptor &&
    tool?.projectId === projectId &&
    descriptor.connectionId === request.connectionId &&
    descriptor.toolName === request.toolName &&
    descriptor.catalogFingerprint === request.catalogFingerprint &&
    descriptor.access === request.access,
  );
}

function mcpDescriptorMatchesRequest(
  descriptor: SidechatToolDescriptor | null,
  request: ExecuteProjectToolRequest,
): descriptor is SidechatToolDescriptor {
  return Boolean(
    descriptor?.enabled &&
    descriptor.audience === "sidechat" &&
    descriptor.connectionId === request.connectionId &&
    descriptor.toolName === request.toolName &&
    descriptor.exposedName ===
      `tool_${request.connectionId.replace(/-/gu, "")}_${request.toolName}` &&
    descriptor.catalogFingerprint === request.catalogFingerprint &&
    descriptor.access === request.access,
  );
}

export async function buildSidechatToolDescriptors(
  projectId: string,
  tools: ToolRow[],
): Promise<SidechatToolDescriptor[]> {
  const descriptors: SidechatToolDescriptor[] = [knowledgeDescriptor()];
  for (const tool of tools) {
    if (tool.projectId !== projectId) continue;
    const descriptor = await httpDescriptor(tool);
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
}

function activityPart(
  label: string,
  status: "started" | "success" | "error",
) {
  return {
    type: "data-safe-activity" as const,
    data: { label: label.slice(0, MAX_SAFE_ACTIVITY_CHARS), status },
    transient: true as const,
  };
}

export function buildSidechatDynamicTools(
  options: SidechatDynamicToolOptions,
): ToolSet {
  const tools: ToolSet = {};
  for (const descriptor of options.descriptors) {
    if (
      !descriptor.enabled ||
      descriptor.audience !== "sidechat" ||
      descriptor.exposedName === "request_team_help" ||
      (isReservedMavenToolName(descriptor.exposedName) &&
        descriptor.exposedName !== "search_knowledge")
    ) {
      continue;
    }
    tools[descriptor.exposedName] = dynamicTool({
      title: descriptor.displayName,
      description: descriptor.description,
      inputSchema: jsonSchema(descriptor.inputSchema),
      async execute(input) {
        options.emitActivity(activityPart(descriptor.displayName, "started"));
        try {
          const result = await options.execute({
            childName: options.childName,
            conversationId: options.conversationId,
            actorUserId: options.actorUserId,
            connectionId: descriptor.connectionId,
            toolName: descriptor.toolName,
            catalogFingerprint: descriptor.catalogFingerprint,
            access: descriptor.access,
            input,
          });
          const completed = result.status === "completed";
          options.emitActivity(
            activityPart(
              completed ? result.safeActivity : descriptor.displayName,
              completed ? "success" : "error",
            ),
          );
          return completed
            ? result.output
            : { error: result.errorCode ?? "tool_unavailable" };
        } catch {
          options.emitActivity(activityPart(descriptor.displayName, "error"));
          return { error: "tool_unavailable" };
        }
      },
    });
  }
  return tools;
}

function deniedResult(errorCode: string): ExecuteProjectToolResult {
  return {
    status: "denied",
    safeActivity: "Tool unavailable",
    errorCode,
  };
}

function safeCompletedActivity(displayName: string): string {
  return `${displayName} · Done`.slice(0, MAX_SAFE_ACTIVITY_CHARS);
}

function isSafeTransportFailure(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).error === "string",
  );
}

function auditMetadata(options: {
  projectId: string;
  request: ExecuteProjectToolRequest;
  status: ExecuteProjectToolResult["status"];
  startedAt: number;
  finishedAt: number;
  safeActivity: string;
  errorCode?: string;
}): SidechatToolAuditMetadata {
  return {
    projectId: options.projectId,
    childName: options.request.childName,
    conversationId: options.request.conversationId,
    connectionId: options.request.connectionId,
    toolName: options.request.toolName,
    catalogFingerprint: options.request.catalogFingerprint,
    access: options.request.access,
    actorUserId: options.request.actorUserId,
    approvalMode: "none",
    status: options.status,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    durationMs: Math.max(0, options.finishedAt - options.startedAt),
    safeActivity: options.safeActivity.slice(0, MAX_SAFE_ACTIVITY_CHARS),
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
  };
}

async function writeSafeAudit(
  dependencies: SidechatProjectToolDependencies,
  metadata: SidechatToolAuditMetadata,
): Promise<void> {
  try {
    await dependencies.writeAudit(metadata);
  } catch {
    // The tool outcome is authoritative. Safe audit failure must not cause a retry.
  }
}

export function persistSidechatActionAudit(
  sql: AgentSqlTag,
  metadata: SidechatToolAuditMetadata,
): void {
  // Tagged SQL calls are effectful even though ESLint treats them as expressions.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  sql`
    CREATE TABLE IF NOT EXISTS sidechat_action_audit (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      child_name TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      catalog_fingerprint TEXT NOT NULL,
      access TEXT NOT NULL,
      actor_user_id TEXT,
      approval_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      safe_activity TEXT NOT NULL,
      error_code TEXT
    )
  `;
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  sql`
    INSERT INTO sidechat_action_audit (
      id, project_id, child_name, conversation_id, connection_id,
      tool_name, catalog_fingerprint, access, actor_user_id,
      approval_mode, status, started_at, finished_at, duration_ms,
      safe_activity, error_code
    ) VALUES (
      ${crypto.randomUUID()}, ${metadata.projectId}, ${metadata.childName},
      ${metadata.conversationId}, ${metadata.connectionId},
      ${metadata.toolName}, ${metadata.catalogFingerprint}, ${metadata.access},
      ${metadata.actorUserId}, ${metadata.approvalMode}, ${metadata.status},
      ${metadata.startedAt}, ${metadata.finishedAt}, ${metadata.durationMs},
      ${metadata.safeActivity}, ${metadata.errorCode ?? null}
    )
  `;
}

export async function executeSidechatProjectTool(
  options: ExecuteSidechatProjectToolOptions,
): Promise<ExecuteProjectToolResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const { request, dependencies } = options;
  let result: ExecuteProjectToolResult;

  try {
    if (
      !(await dependencies.isRegisteredSidechat(
        request.childName,
        request.conversationId,
      ))
    ) {
      result = deniedResult("sidechat_not_registered");
    } else {
      const [conversation, actorAllowed] = await Promise.all([
        dependencies.getConversation(),
        dependencies.canActorAccessProject(request.actorUserId),
      ]);
      if (!conversation || conversation.archivedAt !== null) {
        result = deniedResult("conversation_unavailable");
      } else if (!actorAllowed) {
        result = deniedResult("actor_access_revoked");
      } else if (
        request.connectionId === INTERNAL_KNOWLEDGE_CONNECTION_ID &&
        request.toolName === "search_knowledge" &&
        request.catalogFingerprint === INTERNAL_KNOWLEDGE_FINGERPRINT &&
        request.access === "read"
      ) {
        result = {
          status: "completed",
          output: await dependencies.runKnowledgeSearch(request.input),
          safeActivity: "Searched knowledge",
        };
      } else if (request.connectionId.startsWith("mcp-")) {
        const descriptor = await dependencies.getAuthoritativeMcpTool(
          request.connectionId,
          request.toolName,
        );
        if (!mcpDescriptorMatchesRequest(descriptor, request)) {
          result = deniedResult("tool_authority_changed");
        } else if (request.access === "write") {
          result = {
            status: "unavailable",
            safeActivity: "Approval required",
            errorCode: "approval_required",
          };
        } else {
          const leased = await dependencies.runExternalAction(async () => {
            const [actorStillAllowed, currentDescriptor] = await Promise.all([
              dependencies.canActorAccessProject(request.actorUserId),
              dependencies.getAuthoritativeMcpTool(
                request.connectionId,
                request.toolName,
              ),
            ]);
            if (
              !actorStillAllowed ||
              !mcpDescriptorMatchesRequest(currentDescriptor, request)
            ) {
              return { kind: "denied" as const };
            }
            const value = await dependencies.executeMcpTool(
              request.connectionId,
              request.toolName,
              request.input,
            );
            return isSafeTransportFailure(value)
              ? { kind: "failed" as const }
              : {
                  kind: "completed" as const,
                  value,
                  displayName: currentDescriptor.displayName,
                };
          });
          const leasedValue = leased.value as
            | { kind: "denied" }
            | { kind: "failed" }
            | { kind: "completed"; value: unknown; displayName: string }
            | undefined;
          result = !leased.executed
            ? deniedResult("conversation_unavailable")
            : leasedValue?.kind === "failed"
              ? {
                  status: "failed",
                  safeActivity: "Tool failed",
                  errorCode: "tool_failed",
                }
              : leasedValue?.kind !== "completed"
                ? deniedResult("tool_authority_changed")
                : {
                    status: "completed",
                    output: leasedValue.value,
                    safeActivity: safeCompletedActivity(
                      leasedValue.displayName,
                    ),
                  };
        }
      } else if (request.connectionId.startsWith("http:")) {
        const toolId = request.connectionId.slice("http:".length);
        const authoritativeTool = await dependencies.getAuthoritativeHttpTool(toolId);
        const descriptor = authoritativeTool
          ? await httpDescriptor(authoritativeTool)
          : null;
        const contract = authoritativeTool
          ? readHttpContract(authoritativeTool)
          : null;
        const validatedInput = contract
          ? validateHttpInput(contract.parameters, request.input)
          : null;
        if (
          !validatedInput ||
          !descriptorMatchesRequest(
            descriptor,
            authoritativeTool,
            options.projectId,
            request,
          )
        ) {
          result = deniedResult("tool_authority_changed");
        } else if (request.access === "write") {
          result = {
            status: "unavailable",
            safeActivity: "Approval required",
            errorCode: "approval_required",
          };
        } else {
          const leased = await dependencies.runExternalAction(async () => {
            const [actorStillAllowed, currentTool] = await Promise.all([
              dependencies.canActorAccessProject(request.actorUserId),
              dependencies.getAuthoritativeHttpTool(toolId),
            ]);
            const currentDescriptor = currentTool
              ? await httpDescriptor(currentTool)
              : null;
            const currentContract = currentTool
              ? readHttpContract(currentTool)
              : null;
            const currentInput = currentContract
              ? validateHttpInput(currentContract.parameters, request.input)
              : null;
            if (
              !actorStillAllowed ||
              !currentTool ||
              !currentInput ||
              !descriptorMatchesRequest(
                currentDescriptor,
                currentTool,
                options.projectId,
                request,
              )
            ) {
              return { kind: "denied" as const };
            }
            const value = await dependencies.executeHttpTool(
              currentTool,
              currentInput,
            );
            return isSafeTransportFailure(value)
              ? { kind: "failed" as const }
              : {
                  kind: "completed" as const,
                  value,
                  displayName: currentDescriptor.displayName,
                };
          });
          const leasedValue = leased.value as
            | { kind: "denied" }
            | { kind: "failed" }
            | { kind: "completed"; value: unknown; displayName: string }
            | undefined;
          result = !leased.executed
            ? deniedResult("conversation_unavailable")
            : leasedValue?.kind === "failed"
              ? {
                  status: "failed",
                  safeActivity: "Tool failed",
                  errorCode: "tool_failed",
                }
              : leasedValue?.kind !== "completed"
              ? deniedResult("tool_authority_changed")
              : {
                  status: "completed",
                  output: leasedValue.value,
                  safeActivity: safeCompletedActivity(leasedValue.displayName),
                };
        }
      } else {
        result = deniedResult("tool_unavailable");
      }
    }
  } catch {
    result = {
      status: "failed",
      safeActivity: "Tool failed",
      errorCode: "tool_failed",
    };
  }

  const finishedAt = now();
  await writeSafeAudit(
    dependencies,
    auditMetadata({
      projectId: options.projectId,
      request,
      status: result.status,
      startedAt,
      finishedAt,
      safeActivity: result.safeActivity,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    }),
  );
  return result;
}

export type {
  ExecuteSidechatProjectToolOptions,
  SidechatProjectToolDependencies,
};
