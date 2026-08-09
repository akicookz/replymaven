import type { NewToolRow, ToolRow } from "../db";
import {
  fingerprintHttpToolContract,
  parseAllowedChannels,
} from "../chat-runtime/tools/tool-capability";
import {
  createToolSchema,
  updateToolSchema,
  type MavenChannel,
  type MavenToolAccess,
} from "../validation";

type ToolRole = "owner" | "admin" | "member";

type ToolCreateInput = Omit<
  NewToolRow,
  "id" | "createdAt" | "updatedAt" | "allowedChannels"
> & {
  allowedChannels?: MavenChannel[];
};

type ToolUpdateInput = Partial<
  Pick<
    ToolRow,
    | "displayName"
    | "description"
    | "endpoint"
    | "method"
    | "headers"
    | "parameters"
    | "responseMapping"
    | "enabled"
    | "timeout"
    | "sortOrder"
    | "access"
    | "schemaFingerprint"
  >
> & {
  allowedChannels?: MavenChannel[];
};

export interface ToolRouteService {
  getToolCount(projectId: string): Promise<number>;
  getToolByName(name: string, projectId: string): Promise<ToolRow | null>;
  getToolById(id: string, projectId: string): Promise<ToolRow | null>;
  createTool(data: ToolCreateInput): Promise<ToolRow>;
  updateTool(
    id: string,
    projectId: string,
    updates: ToolUpdateInput,
  ): Promise<ToolRow | null>;
}

interface ToolHandlerDependencies {
  toolService: ToolRouteService;
  encryptHeaders(headers: Record<string, string>): Promise<string>;
  maskStoredHeaders(
    headers: string | null,
  ): Promise<Record<string, string> | null>;
}

interface CreateToolRequestOptions extends ToolHandlerDependencies {
  projectId: string;
  role: ToolRole;
  body: unknown;
}

interface UpdateToolRequestOptions extends ToolHandlerDependencies {
  projectId: string;
  toolId: string;
  role: ToolRole;
  body: unknown;
}

interface ListToolsRequestOptions {
  tools: ToolRow[];
  maskStoredHeaders(
    headers: string | null,
  ): Promise<Record<string, string> | null>;
}

function errorResponse(error: string, status: 400 | 403 | 404): Response {
  return Response.json({ error }, { status });
}

function firstValidationError(result: {
  error: { issues: Array<{ message: string }> };
}): string {
  return result.error.issues[0]?.message ?? "Validation failed";
}

function hasOwnPolicyField(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return (
    Object.prototype.hasOwnProperty.call(body, "allowedChannels") ||
    Object.prototype.hasOwnProperty.call(body, "access")
  );
}

function hasOwnField(body: unknown, field: string): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, field)
  );
}

function haveSameChannels(
  left: MavenChannel[],
  right: MavenChannel[],
): boolean {
  return (
    left.length === right.length &&
    left.every((channel) => right.includes(channel))
  );
}

function memberCreatePolicyIsDefault(
  allowedChannels: MavenChannel[],
  access: MavenToolAccess,
): boolean {
  return haveSameChannels(allowedChannels, ["public"]) && access === "read";
}

function parseParameters(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseResponseMapping(
  raw: string | null,
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeAccess(access: string): MavenToolAccess {
  return access === "write" ? "write" : "read";
}

export function serializeToolResponse(
  tool: ToolRow,
  maskedHeaders: Record<string, string> | null,
): Record<string, unknown> {
  return {
    ...tool,
    parameters: parseParameters(tool.parameters),
    headers: maskedHeaders,
    responseMapping: parseResponseMapping(tool.responseMapping),
    allowedChannels: parseAllowedChannels(tool.allowedChannels),
    access: normalizeAccess(tool.access),
  };
}

export async function handleListToolsRequest(
  options: ListToolsRequestOptions,
): Promise<Response> {
  const serialized = await Promise.all(
    options.tools.map(async (tool) =>
      serializeToolResponse(
        tool,
        await options.maskStoredHeaders(tool.headers),
      ),
    ),
  );
  return Response.json(serialized);
}

export async function handleCreateToolRequest(
  options: CreateToolRequestOptions,
): Promise<Response> {
  const parsed = createToolSchema.safeParse(options.body);
  if (!parsed.success) {
    return errorResponse(firstValidationError(parsed), 400);
  }
  if (
    options.role === "member" &&
    hasOwnPolicyField(options.body) &&
    !memberCreatePolicyIsDefault(
      parsed.data.allowedChannels,
      parsed.data.access,
    )
  ) {
    return errorResponse(
      "Only owners and admins can change tool availability or access",
      403,
    );
  }
  if ((await options.toolService.getToolCount(options.projectId)) >= 20) {
    return errorResponse("Maximum 20 tools per project", 400);
  }
  if (
    await options.toolService.getToolByName(parsed.data.name, options.projectId)
  ) {
    return errorResponse("A tool with this name already exists", 400);
  }

  const encryptedHeaders =
    parsed.data.headers && Object.keys(parsed.data.headers).length > 0
      ? await options.encryptHeaders(parsed.data.headers)
      : null;
  const schemaFingerprint = await fingerprintHttpToolContract({
    name: parsed.data.name,
    description: parsed.data.description,
    parameters: parsed.data.parameters,
  });
  const created = await options.toolService.createTool({
    projectId: options.projectId,
    name: parsed.data.name,
    displayName: parsed.data.displayName,
    description: parsed.data.description,
    endpoint: parsed.data.endpoint,
    method: parsed.data.method,
    headers: encryptedHeaders,
    parameters: JSON.stringify(parsed.data.parameters),
    responseMapping: parsed.data.responseMapping
      ? JSON.stringify(parsed.data.responseMapping)
      : null,
    enabled: parsed.data.enabled,
    timeout: parsed.data.timeout,
    allowedChannels: parsed.data.allowedChannels,
    access: parsed.data.access,
    schemaFingerprint,
  });

  return Response.json(
    serializeToolResponse(
      created,
      await options.maskStoredHeaders(created.headers),
    ),
    { status: 201 },
  );
}

export async function handleUpdateToolRequest(
  options: UpdateToolRequestOptions,
): Promise<Response> {
  const parsed = updateToolSchema.safeParse(options.body);
  if (!parsed.success) {
    return errorResponse(firstValidationError(parsed), 400);
  }
  const current = await options.toolService.getToolById(
    options.toolId,
    options.projectId,
  );
  if (!current) return errorResponse("Not found", 404);

  if (options.role === "member" && hasOwnPolicyField(options.body)) {
    const changesChannels =
      hasOwnField(options.body, "allowedChannels") &&
      !haveSameChannels(
        parsed.data.allowedChannels ?? [],
        parseAllowedChannels(current.allowedChannels),
      );
    const changesAccess =
      hasOwnField(options.body, "access") &&
      parsed.data.access !== normalizeAccess(current.access);
    if (changesChannels || changesAccess) {
      return errorResponse(
        "Only owners and admins can change tool availability or access",
        403,
      );
    }
  }

  const updates: ToolUpdateInput = {};
  if (parsed.data.displayName !== undefined) {
    updates.displayName = parsed.data.displayName;
  }
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description;
  }
  if (parsed.data.endpoint !== undefined) updates.endpoint = parsed.data.endpoint;
  if (parsed.data.method !== undefined) updates.method = parsed.data.method;
  if (parsed.data.headers !== undefined) {
    updates.headers =
      parsed.data.headers && Object.keys(parsed.data.headers).length > 0
        ? await options.encryptHeaders(parsed.data.headers)
        : null;
  }
  if (parsed.data.parameters !== undefined) {
    updates.parameters = JSON.stringify(parsed.data.parameters);
  }
  if (parsed.data.responseMapping !== undefined) {
    updates.responseMapping = parsed.data.responseMapping
      ? JSON.stringify(parsed.data.responseMapping)
      : null;
  }
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.timeout !== undefined) updates.timeout = parsed.data.timeout;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
  if (
    options.role !== "member" &&
    parsed.data.allowedChannels !== undefined
  ) {
    updates.allowedChannels = parsed.data.allowedChannels;
  }
  if (options.role !== "member" && parsed.data.access !== undefined) {
    updates.access = parsed.data.access;
  }

  if (
    parsed.data.description !== undefined ||
    parsed.data.parameters !== undefined
  ) {
    const authoritativeFingerprint = await fingerprintHttpToolContract({
      name: current.name,
      description: current.description,
      parameters: parseParameters(current.parameters),
    });
    const candidateFingerprint = await fingerprintHttpToolContract({
      name: current.name,
      description: parsed.data.description ?? current.description,
      parameters: parsed.data.parameters ?? parseParameters(current.parameters),
    });
    if (candidateFingerprint !== authoritativeFingerprint) {
      updates.schemaFingerprint = candidateFingerprint;
    }
  }

  const updated = await options.toolService.updateTool(
    options.toolId,
    options.projectId,
    updates,
  );
  if (!updated) return errorResponse("Not found", 404);

  return Response.json(
    serializeToolResponse(
      updated,
      await options.maskStoredHeaders(updated.headers),
    ),
  );
}
