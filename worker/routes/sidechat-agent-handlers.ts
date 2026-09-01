import type {
  SidechatChildClaims,
  SidechatParentClaims,
  SidechatSessionResponse,
  SidechatSummary,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import { signSidechatToken } from "../agents/sidechat/agent-auth";
import { sendSidechatDraftAsMavenSchema } from "../validation";

const SESSION_LIFETIME_SECONDS = 900;

export interface SidechatRouteActor {
  userId: string;
  effectiveUserId: string;
  role: "owner" | "admin" | "member";
  accessAllProjects: boolean;
  projectIds: string[] | null;
}

interface SidechatProjectService {
  getProjectById(
    projectId: string,
  ): Promise<{ id: string; userId: string } | null>;
  getSettings(
    projectId: string,
  ): Promise<{
    botName: string | null;
    autoCloseMinutes: number | null;
  } | null>;
}

interface SidechatConversationService {
  get(
    projectId: string,
    conversationId: string,
  ): Promise<{
    id: string;
    projectId: string;
    archivedAt: Date | number | null;
  } | null>;
}

interface SidechatSessionParent {
  registerSidechat(
    conversationId: string,
  ): Promise<{ childName: string; created: boolean }>;
  getSidechatRegistration(
    conversationId: string,
  ): Promise<{ childName: string } | null>;
}

interface SidechatSummaryParent {
  getSidechatSummaries(): Promise<SidechatSummary[]>;
}

interface SidechatDraftParent {
  sendSidechatReplyDraftAsMaven(input: {
    conversationId: string;
    messageId: string;
    senderName: string | null;
    autoCloseMinutes: number | null;
  }): Promise<
    | { status: "sent"; messageId: string }
    | { status: "draft_not_found" }
    | { status: "conversation_unavailable" }
  >;
}

interface AuthorizedProjectOptions {
  actor: SidechatRouteActor | null;
  projectId: string;
  projectService: SidechatProjectService;
}

interface CreateSidechatSessionOptions extends AuthorizedProjectOptions {
  conversationId: string;
  chatService: SidechatConversationService;
  getParent(): Promise<SidechatSessionParent>;
  secret: string;
  now?: number;
}

interface GetSidechatSummariesOptions extends AuthorizedProjectOptions {
  getParent(): Promise<SidechatSummaryParent>;
  secret: string;
  now?: number;
}

interface SendSidechatDraftAsMavenOptions extends AuthorizedProjectOptions {
  conversationId: string;
  request: Request;
  getParent(): Promise<SidechatDraftParent>;
}

function errorResponse(
  error: string,
  status: 400 | 401 | 404 | 409,
): Response {
  return Response.json({ error }, { status });
}

async function authorizeProject(
  options: AuthorizedProjectOptions,
): Promise<Response | null> {
  const { actor } = options;
  if (!actor) return errorResponse("unauthorized", 401);
  if (
    actor.role === "member" &&
    !actor.accessAllProjects &&
    !actor.projectIds?.includes(options.projectId)
  ) {
    return errorResponse("not_found", 404);
  }
  const project = await options.projectService.getProjectById(
    options.projectId,
  );
  if (!project || project.userId !== actor.effectiveUserId) {
    return errorResponse("not_found", 404);
  }
  return null;
}

function childClaims(
  options: CreateSidechatSessionOptions,
  childName: string,
  readOnly: boolean,
  now: number,
): SidechatChildClaims {
  const actor = options.actor;
  if (!actor) throw new Error("Authorized actor required");
  return {
    userId: actor.userId,
    effectiveUserId: actor.effectiveUserId,
    projectId: options.projectId,
    parentName: options.projectId,
    role: actor.role,
    iat: now,
    exp: now + SESSION_LIFETIME_SECONDS,
    aud: "replymaven-sidechat",
    v: 1,
    scope: "child",
    conversationId: options.conversationId,
    childName,
    canSubmit: !readOnly,
    canApproveOnce: !readOnly,
    canAlwaysAllow: !readOnly && actor.role !== "member",
  };
}

function parentClaims(
  options: GetSidechatSummariesOptions,
  now: number,
): SidechatParentClaims {
  const actor = options.actor;
  if (!actor) throw new Error("Authorized actor required");
  return {
    userId: actor.userId,
    effectiveUserId: actor.effectiveUserId,
    projectId: options.projectId,
    parentName: options.projectId,
    role: actor.role,
    iat: now,
    exp: now + SESSION_LIFETIME_SECONDS,
    aud: "replymaven-sidechat",
    v: 1,
    scope: "parent",
  };
}

export async function handleCreateSidechatSession(
  options: CreateSidechatSessionOptions,
): Promise<Response> {
  const denied = await authorizeProject(options);
  if (denied) return denied;

  const conversation = await options.chatService.get(
    options.projectId,
    options.conversationId,
  );
  if (!conversation || conversation.projectId !== options.projectId) {
    return errorResponse("not_found", 404);
  }

  const parent = await options.getParent();
  const existing = await parent.getSidechatRegistration(
    options.conversationId,
  );
  const archived = conversation.archivedAt !== null;
  if (archived && !existing) {
    return errorResponse("archived_conversation", 409);
  }

  const registration = existing
    ? { ...existing, created: false }
    : await parent.registerSidechat(options.conversationId);
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  const claims = childClaims(options, registration.childName, archived, now);
  const response: SidechatSessionResponse = {
    parentAgent: "MavenProjectAgent",
    parentName: options.projectId,
    childAgent: "MavenChatAgent",
    childName: registration.childName,
    token: await signSidechatToken(claims, options.secret),
    expiresAt: claims.exp,
    created: registration.created,
    canApproveOnce: claims.canApproveOnce,
    canAlwaysAllow: claims.canAlwaysAllow,
  };
  return Response.json(response);
}

export async function handleGetSidechatSummaries(
  options: GetSidechatSummariesOptions,
): Promise<Response> {
  const denied = await authorizeProject(options);
  if (denied) return denied;

  const now = options.now ?? Math.floor(Date.now() / 1_000);
  const claims = parentClaims(options, now);
  const parent = await options.getParent();
  const response: SidechatSummarySessionResponse = {
    summaries: await parent.getSidechatSummaries(),
    parentAgent: "MavenProjectAgent",
    parentName: options.projectId,
    token: await signSidechatToken(claims, options.secret),
    expiresAt: claims.exp,
  };
  return Response.json(response);
}

export async function handleSendSidechatDraftAsMaven(
  options: SendSidechatDraftAsMavenOptions,
): Promise<Response> {
  const denied = await authorizeProject(options);
  if (denied) return denied;

  const body = await options.request.json().catch(() => null);
  const parsed = sendSidechatDraftAsMavenSchema.safeParse(body);
  if (!parsed.success) return errorResponse("invalid_request", 400);

  const settings = await options.projectService.getSettings(options.projectId);
  const parent = await options.getParent();
  const result = await parent.sendSidechatReplyDraftAsMaven({
    conversationId: options.conversationId,
    messageId: parsed.data.messageId,
    senderName: settings?.botName ?? null,
    autoCloseMinutes: settings?.autoCloseMinutes ?? null,
  });
  if (result.status === "draft_not_found") {
    return errorResponse("draft_not_found", 404);
  }
  if (result.status === "conversation_unavailable") {
    return errorResponse("conversation_changed", 409);
  }
  return Response.json(
    { ok: true, messageId: result.messageId },
    { status: 201 },
  );
}
