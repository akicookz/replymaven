import type {
  ConversationDirectoryBackfillResult,
  ConversationRuntimeParityResult,
} from "../migrations/conversation-runtime-backfill";

export interface ConversationRuntimeAdminActor {
  userId: string;
  effectiveUserId: string;
  role: "owner" | "admin" | "member";
}

interface ConversationRuntimeProjectService {
  getProjectById(
    projectId: string,
  ): Promise<{ id: string; userId: string } | null>;
}

export interface ConversationRuntimeAdminService {
  backfillProject(
    projectId: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<ConversationDirectoryBackfillResult>;
  verifyProject(
    projectId: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<ConversationRuntimeParityResult>;
}

interface ConversationRuntimeAdminOptions {
  actor: ConversationRuntimeAdminActor | null;
  projectId: string;
  projectService: ConversationRuntimeProjectService;
  runtimeService: ConversationRuntimeAdminService;
}

interface ConversationRuntimeMutationOptions
  extends ConversationRuntimeAdminOptions {
  request: Request;
}

async function authorize(
  options: ConversationRuntimeAdminOptions,
): Promise<Response | null> {
  if (!options.actor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (options.actor.role === "member") {
    return Response.json(
      { error: "Only owners and admins can manage conversation runtime" },
      { status: 403 },
    );
  }
  const project = await options.projectService.getProjectById(
    options.projectId,
  );
  if (!project || project.userId !== options.actor.effectiveUserId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readBatchOptions(
  body: Record<string, unknown>,
): { cursor?: string | null; limit?: number } | Response {
  const requestedLimit = body.limit;
  if (
    requestedLimit !== undefined &&
    (!Number.isInteger(requestedLimit) ||
      (requestedLimit as number) < 1 ||
      (requestedLimit as number) > 100)
  ) {
    return Response.json({ error: "limit must be between 1 and 100" }, {
      status: 400,
    });
  }
  const cursor = body.cursor;
  if (cursor !== undefined && cursor !== null && typeof cursor !== "string") {
    return Response.json({ error: "cursor must be a string" }, { status: 400 });
  }
  return {
    cursor: cursor as string | null | undefined,
    limit: requestedLimit as number | undefined,
  };
}

export async function handleConversationRuntimeBackfill(
  options: ConversationRuntimeMutationOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  const batch = readBatchOptions(await readJsonRecord(options.request));
  if (batch instanceof Response) return batch;
  return Response.json(
    await options.runtimeService.backfillProject(options.projectId, batch),
  );
}

export async function handleConversationRuntimeVerify(
  options: ConversationRuntimeMutationOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  const batch = readBatchOptions(await readJsonRecord(options.request));
  if (batch instanceof Response) return batch;
  return Response.json(
    await options.runtimeService.verifyProject(options.projectId, batch),
  );
}

