import type {
  PublicChatChildClaims,
  PublicChatSessionResponse,
} from "../../shared/public-chat-agent";
import type { PublicConversationRecord } from "../../shared/maven-conversation";
import { toPublicChildName } from "../../shared/maven-conversation";
import {
  isPublicChatAgentId,
  signPublicChatToken,
} from "../agents/maven/public/public-agent-auth";

const SESSION_LIFETIME_SECONDS = 120;

export interface PublicAgentRouteActor {
  userId: string;
  effectiveUserId: string;
  role: "owner" | "admin" | "member";
  accessAllProjects: boolean;
  projectIds: string[] | null;
}

interface PublicAgentProjectService {
  getProjectBySlugPublic(
    slug: string,
  ): Promise<{ id: string; userId: string } | null>;
  getProjectById(
    projectId: string,
  ): Promise<{ id: string; userId: string } | null>;
}

interface PublicAgentConversationStore {
  get(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null>;
}

interface PublicAgentBanService {
  isVisitorBanned(
    projectId: string,
    visitorId: string,
    visitorEmail?: string | null,
  ): Promise<unknown | null>;
}

interface PublicAgentSessionDependencies {
  request: Request;
  conversationId: string;
  secret: string;
  projectService: PublicAgentProjectService;
  conversationStore: PublicAgentConversationStore;
  ensurePublicConversation(
    conversation: PublicConversationRecord,
  ): Promise<{ childName: `pub_${string}` }>;
  isPublicAgentRuntimeAvailable(projectId: string): Promise<boolean>;
  now?: number;
}

interface CreateWidgetPublicAgentSessionOptions
  extends PublicAgentSessionDependencies {
  projectSlug: string;
  visitorId: string;
  banService: PublicAgentBanService;
}

interface CreateDashboardPublicAgentSessionOptions
  extends PublicAgentSessionDependencies {
  actor: PublicAgentRouteActor | null;
  projectId: string;
}

function errorResponse(
  error: string,
  status: 400 | 401 | 403 | 404 | 409,
): Response {
  return Response.json({ error }, { status });
}

async function createSessionResponse(
  options: PublicAgentSessionDependencies,
  conversation: PublicConversationRecord,
  actor: PublicChatChildClaims["actor"],
  visitorId: string | null,
): Promise<Response> {
  const registration = await options.ensurePublicConversation(conversation);
  const expectedChildName = toPublicChildName(conversation.id);
  if (registration.childName !== expectedChildName) {
    throw new Error("Public Agent registration returned the wrong child");
  }
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  const claims: PublicChatChildClaims = {
    v: 1,
    aud: "replymaven-public-chat",
    scope: "child",
    actor,
    projectId: conversation.projectId,
    parentName: conversation.projectId,
    conversationId: conversation.id,
    childName: expectedChildName,
    visitorId,
    canSubmitVisitor: actor === "visitor",
    canRead: true,
    iat: now,
    exp: now + SESSION_LIFETIME_SECONDS,
  };
  const response: PublicChatSessionResponse = {
    host: new URL(options.request.url).origin,
    parentAgent: "MavenProjectAgent",
    parentName: conversation.projectId,
    childAgent: "MavenChatAgent",
    childName: expectedChildName,
    token: await signPublicChatToken(claims, options.secret),
    expiresAt: claims.exp,
  };
  return Response.json(response);
}

export async function handleCreateWidgetPublicAgentSession(
  options: CreateWidgetPublicAgentSessionOptions,
): Promise<Response> {
  if (!isPublicChatAgentId(options.visitorId)) {
    return errorResponse("invalid_visitor_id", 400);
  }
  const project = await options.projectService.getProjectBySlugPublic(
    options.projectSlug,
  );
  if (!project) return errorResponse("not_found", 404);
  if (!await options.isPublicAgentRuntimeAvailable(project.id)) {
    return errorResponse("agent_runtime_not_cut_over", 409);
  }
  const conversation = await options.conversationStore.get(
    project.id,
    options.conversationId,
  );
  if (
    !conversation ||
    conversation.projectId !== project.id ||
    conversation.visitorId !== options.visitorId
  ) return errorResponse("not_found", 404);
  if (conversation.archivedAt !== null) {
    return errorResponse("archived_conversation", 409);
  }
  const ban = await options.banService.isVisitorBanned(
    project.id,
    conversation.visitorId,
    conversation.visitorEmail,
  );
  if (ban) return errorResponse("visitor_banned", 403);
  return createSessionResponse(
    options,
    conversation,
    "visitor",
    conversation.visitorId,
  );
}

export async function handleCreateDashboardPublicAgentSession(
  options: CreateDashboardPublicAgentSessionOptions,
): Promise<Response> {
  const actor = options.actor;
  if (!actor) return errorResponse("unauthorized", 401);
  if (
    actor.role === "member" &&
    !actor.accessAllProjects &&
    !actor.projectIds?.includes(options.projectId)
  ) return errorResponse("not_found", 404);
  const project = await options.projectService.getProjectById(options.projectId);
  if (!project || project.userId !== actor.effectiveUserId) {
    return errorResponse("not_found", 404);
  }
  if (!await options.isPublicAgentRuntimeAvailable(project.id)) {
    return errorResponse("agent_runtime_not_cut_over", 409);
  }
  const conversation = await options.conversationStore.get(
    options.projectId,
    options.conversationId,
  );
  if (!conversation || conversation.projectId !== options.projectId) {
    return errorResponse("not_found", 404);
  }
  return createSessionResponse(options, conversation, "dashboard", null);
}
