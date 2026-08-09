import type { MessageRow } from "../db";
import { sidechatMessageRowToPayload } from "../realtime/broadcast";
import {
  sidechatHistoryQuerySchema,
  sidechatMessageSchema,
  sidechatRetrySchema,
} from "../validation";

const SIDECHAT_RUN_LEASE_MS = 60_000;
const RETRY_LOOKBACK_LIMIT = 100;

export interface SidechatConversationRecord {
  id: string;
  projectId: string;
  customerId: string | null;
  visitorName: string | null;
  archivedAt: Date | null;
  status: "active" | "waiting_agent" | "agent_replied" | "closed";
  chatState: string | null;
  lastActivityAt: Date;
  sidechatStatus: "idle" | "working" | "waiting_approval" | "ready" | "failed";
  sidechatRunId: string | null;
  sidechatLeaseExpiresAt: Date | null;
}

export interface SidechatHandlerService {
  getConversationById(
    conversationId: string,
    projectId: string,
  ): Promise<SidechatConversationRecord | null>;
  getRecentSidechatMessages(
    conversationId: string,
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }>;
  getSidechatMessagesBefore(
    conversationId: string,
    before: Date,
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }>;
  claimSidechatRun(input: {
    projectId: string;
    conversationId: string;
    runId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<boolean>;
  settleSidechatRun(input: {
    projectId: string;
    conversationId: string;
    runId: string;
    status: "idle" | "ready" | "failed" | "waiting_approval";
  }): Promise<boolean>;
  addSidechatHumanMessage(input: {
    projectId: string;
    conversationId: string;
    runId: string;
    content: string;
    userId: string;
    senderName: string;
    senderAvatar: string | null;
  }): Promise<MessageRow | null>;
}

export function canAccessSidechatProject(input: {
  authenticatedUserId: string;
  effectiveUserId: string | null;
  role: "owner" | "admin" | "member" | null;
  accessAllProjects: boolean;
  projectIds: string[] | null;
  project: { id: string; userId: string };
}): boolean {
  const effectiveUserId = input.effectiveUserId ?? input.authenticatedUserId;
  if (input.project.userId !== effectiveUserId) return false;
  if (input.role !== "member" || input.accessAllProjects) return true;
  return input.projectIds?.includes(input.project.id) ?? false;
}

export function buildTrustedDefaultSidechatMessage(
  canonicalCustomerName: string | null,
  conversationName: string | null,
): string {
  const trustedName = (canonicalCustomerName ?? conversationName)
    ?.replace(/\s+/gu, " ")
    .trim();
  return trustedName
    ? `Help me respond to ${trustedName}.`
    : "Help me respond to this conversation.";
}

function errorResponse(
  error: string,
  status: 400 | 404 | 409 | 410 | 500,
): Response {
  return Response.json({ error }, { status });
}

function firstValidationError(result: {
  error: { issues: Array<{ message: string }> };
}): string {
  return result.error.issues[0]?.message ?? "Validation failed";
}

export async function handleGetSidechatHistory(options: {
  projectId: string;
  conversationId: string;
  query: Record<string, string | undefined>;
  service: SidechatHandlerService;
}): Promise<Response> {
  const parsed = sidechatHistoryQuerySchema.safeParse(options.query);
  if (!parsed.success) {
    return errorResponse(firstValidationError(parsed), 400);
  }
  const conversation = await options.service.getConversationById(
    options.conversationId,
    options.projectId,
  );
  if (!conversation) return errorResponse("not_found", 404);

  const page = parsed.data.before
    ? await options.service.getSidechatMessagesBefore(
        conversation.id,
        new Date(parsed.data.before),
        parsed.data.limit,
      )
    : await options.service.getRecentSidechatMessages(
        conversation.id,
        parsed.data.limit,
      );

  return Response.json({
    messages: page.messages.map(sidechatMessageRowToPayload),
    hasMore: page.hasMore,
  });
}

export interface SidechatMutationOptions {
  projectId: string;
  conversationId: string;
  actor: { userId: string; name: string; avatarUrl: string | null };
  body: unknown;
  service: SidechatHandlerService;
  now(): Date;
  createRunId(): string;
  getCanonicalCustomerName(
    projectId: string,
    customerId: string,
  ): Promise<string | null>;
  broadcastMessage(message: MessageRow): void;
  broadcastStatus(
    status: "idle" | "working" | "waiting_approval" | "ready" | "failed",
    runId: string | null,
  ): void;
  runTurn(input: { message: MessageRow; runId: string }): Promise<void>;
  scheduleBackground(promise: Promise<void>): void;
}

async function settleFailedRun(
  options: SidechatMutationOptions,
  runId: string,
  broadcast: boolean,
): Promise<void> {
  try {
    const settled = await options.service.settleSidechatRun({
      projectId: options.projectId,
      conversationId: options.conversationId,
      runId,
      status: "failed",
    });
    if (settled && broadcast) {
      try {
        options.broadcastStatus("failed", null);
      } catch {
        // The exact run is already released; realtime is best-effort here.
      }
    }
  } catch {
    // A failed release must not replace the bounded route error.
  }
}

async function getWritableConversation(
  options: SidechatMutationOptions,
): Promise<SidechatConversationRecord | Response> {
  const conversation = await options.service.getConversationById(
    options.conversationId,
    options.projectId,
  );
  if (!conversation) return errorResponse("not_found", 404);
  if (conversation.archivedAt) {
    return errorResponse("conversation_archived", 410);
  }
  return conversation;
}

function isResponse(
  value: SidechatConversationRecord | Response,
): value is Response {
  return value instanceof Response;
}

async function claimRun(
  options: SidechatMutationOptions,
  runId: string,
): Promise<boolean> {
  const claimTime = options.now();
  return options.service.claimSidechatRun({
    projectId: options.projectId,
    conversationId: options.conversationId,
    runId,
    now: claimTime,
    leaseExpiresAt: new Date(claimTime.getTime() + SIDECHAT_RUN_LEASE_MS),
  });
}

function scheduleContainedTurn(
  options: SidechatMutationOptions,
  message: MessageRow,
  runId: string,
): void {
  const background = Promise.resolve()
    .then(() => options.runTurn({ message, runId }))
    .catch(async () => {
      await settleFailedRun(options, runId, true);
    });
  options.scheduleBackground(background);
}

async function acceptClaimedRun(
  options: SidechatMutationOptions,
  message: MessageRow,
  runId: string,
  broadcastMessage: boolean,
): Promise<Response> {
  try {
    if (broadcastMessage) options.broadcastMessage(message);
    options.broadcastStatus("working", runId);
    scheduleContainedTurn(options, message, runId);
  } catch {
    await settleFailedRun(options, runId, true);
    return errorResponse("sidechat_acceptance_failed", 500);
  }
  return Response.json(
    { message: sidechatMessageRowToPayload(message), runId },
    { status: 202 },
  );
}

export async function handleCreateSidechatMessage(
  options: SidechatMutationOptions,
): Promise<Response> {
  const parsed = sidechatMessageSchema.safeParse(options.body);
  if (!parsed.success) {
    return errorResponse(firstValidationError(parsed), 400);
  }
  const conversation = await getWritableConversation(options);
  if (isResponse(conversation)) return conversation;

  const runId = options.createRunId();
  if (!(await claimRun(options, runId))) {
    return errorResponse("sidechat_busy", 409);
  }

  let content = parsed.data.content;
  try {
    if (content === undefined) {
      const canonicalName = conversation.customerId
        ? await options.getCanonicalCustomerName(
            options.projectId,
            conversation.customerId,
          )
        : null;
      content = buildTrustedDefaultSidechatMessage(
        canonicalName,
        conversation.visitorName,
      );
    }
  } catch {
    await settleFailedRun(options, runId, true);
    return errorResponse("sidechat_acceptance_failed", 500);
  }

  let message: MessageRow | null;
  try {
    message = await options.service.addSidechatHumanMessage({
      projectId: options.projectId,
      conversationId: conversation.id,
      runId,
      content,
      userId: options.actor.userId,
      senderName: options.actor.name,
      senderAvatar: options.actor.avatarUrl,
    });
  } catch {
    await settleFailedRun(options, runId, true);
    return errorResponse("sidechat_persist_failed", 500);
  }
  if (!message) {
    await settleFailedRun(options, runId, true);
    return errorResponse("sidechat_run_lost", 409);
  }

  return acceptClaimedRun(options, message, runId, true);
}

export async function handleRetrySidechatTurn(
  options: SidechatMutationOptions,
): Promise<Response> {
  const parsed = sidechatRetrySchema.safeParse(options.body);
  if (!parsed.success) {
    return errorResponse(firstValidationError(parsed), 400);
  }
  const conversation = await getWritableConversation(options);
  if (isResponse(conversation)) return conversation;

  const recent = await options.service.getRecentSidechatMessages(
    conversation.id,
    RETRY_LOOKBACK_LIMIT,
  );
  const lastHuman = recent.messages.findLast(
    (message) => message.role === "agent",
  );
  if (!lastHuman || lastHuman.id !== parsed.data.messageId) {
    return errorResponse("retry_message_mismatch", 409);
  }

  const runId = options.createRunId();
  if (!(await claimRun(options, runId))) {
    return errorResponse("sidechat_busy", 409);
  }
  return acceptClaimedRun(options, lastHuman, runId, false);
}
