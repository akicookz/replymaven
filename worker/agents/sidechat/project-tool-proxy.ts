import type { JSONSchema7 } from "json-schema";
import type {
  ExecuteProjectToolRequest,
  ExecuteProjectToolResult,
  SidechatToolAuditMetadata,
  SidechatToolDescriptor,
  SidechatToolPresentation,
  SidechatToolSafety,
} from "../../../shared/sidechat-agent";
import type { ToolRow } from "../../db";
import {
  httpToolModelContractSchema,
  isReservedMavenToolName,
  toolAudienceSchema,
} from "../../validation";
import { fingerprintHttpToolContract } from "../../chat-runtime/tools/tool-capability";
import {
  normalizeProjectToolInputSchema,
  validateProjectToolInput,
} from "./project-tool-schema";

export const INTERNAL_KNOWLEDGE_CONNECTION_ID = "internal:replymaven";
const INTERNAL_KNOWLEDGE_FINGERPRINT = "internal-search-knowledge-v1";
const MAX_SAFE_ACTIVITY_CHARS = 240;

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
  hasAlwaysAllowGrant(
    request: ExecuteProjectToolRequest,
  ): boolean | Promise<boolean>;
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

export function sidechatToolPresentation(
  descriptor: SidechatToolDescriptor,
): SidechatToolPresentation {
  if (descriptor.source) {
    return {
      displayName: descriptor.displayName,
      source: descriptor.source,
    };
  }
  if (descriptor.connectionId.startsWith("mcp-")) {
    return {
      displayName: descriptor.displayName,
      source: { kind: "mcp", name: "MCP", icon: null },
    };
  }
  if (descriptor.connectionId === INTERNAL_KNOWLEDGE_CONNECTION_ID) {
    return {
      displayName: descriptor.displayName,
      source: { kind: "http", name: "Docs", icon: null },
    };
  }
  return {
    displayName: descriptor.displayName,
    source: { kind: "http", name: "Custom tool", icon: null },
  };
}

export function buildSidechatKnowledgeDescriptor(): SidechatToolDescriptor {
  return {
    connectionId: INTERNAL_KNOWLEDGE_CONNECTION_ID,
    toolName: "search_knowledge",
    exposedName: "search_knowledge",
    displayName: "Search",
    source: {
      kind: "http",
      name: "Docs",
      icon: null,
    },
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
    safety: "read",
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

export async function buildSidechatHttpToolDescriptor(
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
    safety: tool.access === "read" ? "read" : "write",
    access: tool.access,
    enabled: true,
    source: {
      kind: "http",
      name: "Custom tool",
      icon: null,
    },
  };
}

export function resolveSidechatToolSafety(
  descriptor: SidechatToolDescriptor,
): SidechatToolSafety {
  return descriptor.safety ?? (descriptor.access === "read" ? "read" : "write");
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
    resolveSidechatToolSafety(descriptor) === request.safety &&
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
    descriptor.catalogFingerprint === request.catalogFingerprint &&
    resolveSidechatToolSafety(descriptor) === request.safety &&
    descriptor.access === request.access,
  );
}

export async function buildSidechatToolDescriptors(
  projectId: string,
  tools: ToolRow[],
): Promise<SidechatToolDescriptor[]> {
  const descriptors: SidechatToolDescriptor[] = [
    buildSidechatKnowledgeDescriptor(),
  ];
  for (const tool of tools) {
    if (tool.projectId !== projectId) continue;
    const descriptor = await buildSidechatHttpToolDescriptor(tool);
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
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
  approvalMode: "none" | "once" | "always";
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
    approvalMode: options.approvalMode,
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

type LeasedToolValue =
  | { kind: "denied" }
  | { kind: "failed" }
  | { kind: "ambiguous" }
  | { kind: "completed"; value: unknown; displayName: string };

function resultFromLease(
  leased: { executed: boolean; value?: unknown },
): ExecuteProjectToolResult {
  const value = leased.value as LeasedToolValue | undefined;
  if (!leased.executed) return deniedResult("conversation_unavailable");
  if (value?.kind === "failed") {
    return {
      status: "failed",
      safeActivity: "Tool failed",
      errorCode: "tool_failed",
    };
  }
  if (value?.kind === "ambiguous") {
    return {
      status: "ambiguous",
      safeActivity: "Write result unknown",
      errorCode: "write_result_unknown",
    };
  }
  if (value?.kind !== "completed") {
    return deniedResult("tool_authority_changed");
  }
  return {
    status: "completed",
    output: value.value,
    safeActivity: safeCompletedActivity(value.displayName),
  };
}

function transportValue(
  value: unknown,
  request: ExecuteProjectToolRequest,
  displayName: string,
): LeasedToolValue {
  if (isSafeTransportFailure(value)) {
    return request.safety !== "read"
      ? { kind: "ambiguous" }
      : { kind: "failed" };
  }
  return { kind: "completed", value, displayName };
}

async function executeAuthorizedMcpTool(
  request: ExecuteProjectToolRequest,
  dependencies: SidechatProjectToolDependencies,
  effectiveApprovalMode: "none" | "once" | "always",
): Promise<ExecuteProjectToolResult> {
  const descriptor = await dependencies.getAuthoritativeMcpTool(
    request.connectionId,
    request.toolName,
  );
  if (!mcpDescriptorMatchesRequest(descriptor, request)) {
    return deniedResult("tool_authority_changed");
  }
  const normalized = normalizeProjectToolInputSchema(descriptor.inputSchema);
  const validated = normalized.ok
    ? validateProjectToolInput(normalized.schema, request.input)
    : { ok: false as const, errorCode: "invalid_tool_input" as const };
  if (!validated.ok) return deniedResult("tool_authority_changed");
  const leased = await dependencies.runExternalAction(async () => {
    const [actorAllowed, currentDescriptor, grantCurrent] = await Promise.all([
      dependencies.canActorAccessProject(request.actorUserId),
      dependencies.getAuthoritativeMcpTool(
        request.connectionId,
        request.toolName,
      ),
      effectiveApprovalMode === "always"
        ? dependencies.hasAlwaysAllowGrant(request)
        : true,
    ]);
    if (
      !actorAllowed ||
      !mcpDescriptorMatchesRequest(currentDescriptor, request) ||
      !grantCurrent
    ) {
      return { kind: "denied" as const };
    }
    const currentNormalized = normalizeProjectToolInputSchema(
      currentDescriptor.inputSchema,
    );
    const currentValidation = currentNormalized.ok
      ? validateProjectToolInput(currentNormalized.schema, request.input)
      : { ok: false as const, errorCode: "invalid_tool_input" as const };
    if (!currentValidation.ok) return { kind: "denied" as const };
    const value = await dependencies.executeMcpTool(
      request.connectionId,
      request.toolName,
      currentValidation.value,
    );
    return transportValue(value, request, currentDescriptor.displayName);
  });
  return resultFromLease(leased);
}

async function executeAuthorizedHttpTool(
  projectId: string,
  request: ExecuteProjectToolRequest,
  dependencies: SidechatProjectToolDependencies,
  effectiveApprovalMode: "none" | "once" | "always",
): Promise<ExecuteProjectToolResult> {
  const toolId = request.connectionId.slice("http:".length);
  const authoritativeTool = await dependencies.getAuthoritativeHttpTool(toolId);
  const descriptor = authoritativeTool
    ? await buildSidechatHttpToolDescriptor(authoritativeTool)
    : null;
  const normalized = descriptor
    ? normalizeProjectToolInputSchema(descriptor.inputSchema)
    : null;
  const validatedInput = normalized?.ok
    ? validateProjectToolInput(normalized.schema, request.input)
    : null;
  if (
    !validatedInput?.ok ||
    !descriptorMatchesRequest(
      descriptor,
      authoritativeTool,
      projectId,
      request,
    )
  ) {
    return deniedResult("tool_authority_changed");
  }
  const leased = await dependencies.runExternalAction(async () => {
    const [actorAllowed, currentTool, grantCurrent] = await Promise.all([
      dependencies.canActorAccessProject(request.actorUserId),
      dependencies.getAuthoritativeHttpTool(toolId),
      effectiveApprovalMode === "always"
        ? dependencies.hasAlwaysAllowGrant(request)
        : true,
    ]);
    const currentDescriptor = currentTool
      ? await buildSidechatHttpToolDescriptor(currentTool)
      : null;
    const currentNormalized = currentDescriptor
      ? normalizeProjectToolInputSchema(currentDescriptor.inputSchema)
      : null;
    const currentInput = currentNormalized?.ok
      ? validateProjectToolInput(currentNormalized.schema, request.input)
      : null;
    if (
      !actorAllowed ||
      !currentTool ||
      !currentInput?.ok ||
      !grantCurrent ||
      !descriptorMatchesRequest(
        currentDescriptor,
        currentTool,
        projectId,
        request,
      )
    ) {
      return { kind: "denied" as const };
    }
    const value = await dependencies.executeHttpTool(
      currentTool,
      currentInput.value,
    );
    return transportValue(value, request, currentDescriptor.displayName);
  });
  return resultFromLease(leased);
}

async function executeAuthorizedProjectTool(
  options: ExecuteSidechatProjectToolOptions,
  effectiveApprovalMode: "none" | "once" | "always",
): Promise<ExecuteProjectToolResult> {
  const { request, dependencies } = options;
  if (
    request.connectionId === INTERNAL_KNOWLEDGE_CONNECTION_ID &&
    request.toolName === "search_knowledge" &&
    request.catalogFingerprint === INTERNAL_KNOWLEDGE_FINGERPRINT &&
    request.safety === "read" &&
    request.access === "read"
  ) {
    return {
      status: "completed",
      output: await dependencies.runKnowledgeSearch(request.input),
      safeActivity: "Searched knowledge",
    };
  }
  if (request.connectionId.startsWith("mcp-")) {
    return executeAuthorizedMcpTool(
      request,
      dependencies,
      effectiveApprovalMode,
    );
  }
  if (request.connectionId.startsWith("http:")) {
    return executeAuthorizedHttpTool(
      options.projectId,
      request,
      dependencies,
      effectiveApprovalMode,
    );
  }
  return deniedResult("tool_unavailable");
}

export async function executeSidechatProjectTool(
  options: ExecuteSidechatProjectToolOptions,
): Promise<ExecuteProjectToolResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const { request, dependencies } = options;
  let effectiveApprovalMode = request.approvalMode;
  let result: ExecuteProjectToolResult;

  try {
    const registered = await dependencies.isRegisteredSidechat(
      request.childName,
      request.conversationId,
    );
    if (!registered) {
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
      } else {
        if (
          request.access === "write" &&
          request.approvalMode === "once" &&
          await dependencies.hasAlwaysAllowGrant(request)
        ) {
          effectiveApprovalMode = "always";
        }
        if (
          (request.access === "read" && effectiveApprovalMode !== "none") ||
          (request.access === "write" && effectiveApprovalMode === "none")
        ) {
          result = deniedResult("approval_required");
        } else if (
          request.access === "write" &&
          effectiveApprovalMode === "always" &&
          !(await dependencies.hasAlwaysAllowGrant(request))
        ) {
          result = deniedResult("approval_grant_changed");
        } else {
          result = await executeAuthorizedProjectTool(
            options,
            effectiveApprovalMode,
          );
        }
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
      approvalMode: effectiveApprovalMode,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    }),
  );
  return result;
}

export type {
  ExecuteSidechatProjectToolOptions,
  SidechatProjectToolDependencies,
};
