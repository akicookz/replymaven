import type {
  ConversationDirectoryBackfillResult,
  ConversationRuntimeMigrationService,
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
    limit?: number,
  ): Promise<ConversationDirectoryBackfillResult>;
  verifyProject(projectId: string): Promise<ConversationRuntimeParityResult>;
  getStatus(
    projectId: string,
  ): ReturnType<ConversationRuntimeMigrationService["getStatus"]>;
  disableCompatibilityProjection(
    projectId: string,
  ): Promise<{ disabled: true }>;
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

export async function handleConversationRuntimeBackfill(
  options: ConversationRuntimeMutationOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  const body = await readJsonRecord(options.request);
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
  const result = await options.runtimeService.backfillProject(
    options.projectId,
    requestedLimit as number | undefined,
  );
  return Response.json(result);
}

export async function handleConversationRuntimeVerify(
  options: ConversationRuntimeAdminOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  return Response.json(
    await options.runtimeService.verifyProject(options.projectId),
  );
}

export async function handleConversationRuntimeStatus(
  options: ConversationRuntimeAdminOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  return Response.json(
    await options.runtimeService.getStatus(options.projectId),
  );
}

export async function handleDisableCompatibilityProjection(
  options: ConversationRuntimeMutationOptions,
): Promise<Response> {
  const denied = await authorize(options);
  if (denied) return denied;
  const body = await readJsonRecord(options.request);
  const requiredConfirmation =
    `disable compatibility projection for ${options.projectId}`;
  if (body.confirmation !== requiredConfirmation) {
    return Response.json({
      error: "Confirmation does not match",
      requiredConfirmation,
    }, { status: 400 });
  }
  try {
    return Response.json(
      await options.runtimeService.disableCompatibilityProjection(
        options.projectId,
      ),
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Disablement failed",
    }, { status: 409 });
  }
}
