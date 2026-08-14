import type { MavenConversationSummary } from "../../shared/sidechat-agent";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../shared/maven-conversation";
import { publicConversationImportChecksum } from "../../shared/public-transcript-checksum";
import type { AppEnv } from "../types";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import { legacyEntryToSummary } from "./conversation-runtime-backfill";

interface LegacyMirrorParentStub {
  reconcileDirectory(
    summaries: MavenConversationSummary[],
  ): Promise<{ applied: number; skipped: number }>;
  reconcileLegacyConversation(input: {
    summary: MavenConversationSummary;
    conversation: PublicConversationRecord;
    messages: PublicMessageRecord[];
    checksum: string;
  }): Promise<void>;
  removeLegacyConversation(conversationId: string): Promise<boolean>;
}

interface ConversationReference {
  projectId: string;
  conversationId: string;
}

const MUTATING_METHODS = new Set([
  "create",
  "bulkApplyActions",
  "appendVisitor",
  "appendHuman",
  "appendBot",
  "appendSystem",
  "deleteHumanMessage",
  "applyAction",
  "transitionOwnership",
  "takeHumanOwnership",
  "resolveByAi",
  "setStatus",
  "reopen",
  "checkAndCloseStale",
  "checkAndCloseStaleForProject",
  "prepareContactSupportOwnership",
  "closeOpenAsSpam",
  "claimTeamRequest",
  "claimTeamRequestNotification",
  "addTeamRequestSummary",
  "completeTeamRequestSummary",
  "updateLegacyEscalationMetadata",
  "persistTeamRequestTelegramThreadId",
  "updateTelegramThreadId",
  "acquireExternalAction",
  "releaseExternalAction",
  "markDelivery",
  "markEmailed",
  "updatePresence",
  "updateEmail",
  "updateContact",
  "updatePendingTeamRequestContact",
  "saveChatState",
  "updateCustomer",
  "applyCustomerMutation",
  "claimExpiredArchives",
  "deleteRetentionClaim",
  "createConversation",
  "addPublicVisitorMessageWithFirstTurn",
  "addPublicAgentMessageAndTakeOwnership",
  "addPublicBotMessageIfOwnershipMatches",
  "addPublicSystemMessage",
  "addPublicMessage",
  "markPublicMessageAsEmailed",
  "markPublicDeliveredUpTo",
  "markPublicReadUpTo",
  "deletePublicAgentMessage",
  "updateConversationStatus",
  "reopenConversation",
  "transitionChatOwnership",
  "updateConversation",
  "updateConversationEmail",
  "updateVisitorLastSeen",
  "resolveConversationByAi",
  "closeOpenConversationsAsSpam",
  "bulkUpdateConversations",
  "setSnooze",
  "setPriority",
  "setAssignee",
]);

function collectReferenceParts(
  value: unknown,
  projects: Set<string>,
  conversations: Set<string>,
  pairs: Map<string, ConversationReference>,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) =>
      collectReferenceParts(entry, projects, conversations, pairs)
    );
    return;
  }
  const record = value as Record<string, unknown>;
  const projectId = typeof record.projectId === "string"
    ? record.projectId
    : null;
  const conversationId = typeof record.conversationId === "string"
    ? record.conversationId
    : typeof record.id === "string" &&
        (typeof record.visitorId === "string" || projectId !== null)
      ? record.id
      : null;
  if (projectId) projects.add(projectId);
  if (conversationId) conversations.add(conversationId);
  if (projectId && conversationId) {
    pairs.set(`${projectId}:${conversationId}`, { projectId, conversationId });
  }
  Object.values(record).forEach((entry) =>
    collectReferenceParts(entry, projects, conversations, pairs)
  );
}

function addStringArgumentReferences(
  method: string,
  args: unknown[],
  projects: Set<string>,
  conversations: Set<string>,
  pairs: Map<string, ConversationReference>,
): void {
  const projectFirst = new Set([
    "deleteHumanMessage",
    "takeHumanOwnership",
    "resolveByAi",
    "setStatus",
    "reopen",
    "checkAndCloseStale",
    "checkAndCloseStaleForProject",
    "prepareContactSupportOwnership",
    "claimTeamRequestNotification",
    "addTeamRequestSummary",
    "updateLegacyEscalationMetadata",
    "updateTelegramThreadId",
    "persistTeamRequestTelegramThreadId",
    "updateEmail",
    "updatePendingTeamRequestContact",
    "saveChatState",
    "deleteRetentionClaim",
  ]);
  const conversationFirst = new Set([
    "updateConversationStatus",
    "reopenConversation",
    "transitionChatOwnership",
    "updateConversation",
    "updateConversationEmail",
    "updateVisitorLastSeen",
    "resolveConversationByAi",
    "setSnooze",
    "setPriority",
    "setAssignee",
  ]);
  let projectId: string | null = null;
  let conversationId: string | null = null;
  if (projectFirst.has(method)) {
    projectId = typeof args[0] === "string" ? args[0] : null;
    conversationId = typeof args[1] === "string" ? args[1] : null;
  } else if (conversationFirst.has(method)) {
    conversationId = typeof args[0] === "string" ? args[0] : null;
    projectId = typeof args[1] === "string" ? args[1] : null;
  } else if (
    method === "addPublicVisitorMessageWithFirstTurn" ||
    method === "addPublicAgentMessageAndTakeOwnership" ||
    method === "addPublicBotMessageIfOwnershipMatches" ||
    method === "addPublicMessage"
  ) {
    projectId = typeof args[1] === "string" ? args[1] : null;
  } else if (
    method === "markPublicMessageAsEmailed" ||
    method === "markPublicDeliveredUpTo" ||
    method === "markPublicReadUpTo" ||
    method === "deletePublicAgentMessage"
  ) {
    conversationId = typeof args[0] === "string" ? args[0] : null;
    projectId = typeof args[2] === "string" ? args[2] : null;
  } else if (method === "addPublicSystemMessage") {
    conversationId = typeof args[0] === "string" ? args[0] : null;
    projectId = typeof args[4] === "string" ? args[4] : null;
  } else if (
    method === "bulkApplyActions" || method === "bulkUpdateConversations"
  ) {
    projectId = typeof args[0] === "string" ? args[0] :
      typeof args[1] === "string" ? args[1] : null;
    const ids = Array.isArray(args[1]) ? args[1] :
      Array.isArray(args[0]) ? args[0] : [];
    ids.filter((id): id is string => typeof id === "string")
      .forEach((id) => conversations.add(id));
  } else if (
    method === "closeOpenAsSpam" ||
    method === "closeOpenConversationsAsSpam"
  ) {
    projectId = typeof args[0] === "string" ? args[0] : null;
  }
  if (projectId) projects.add(projectId);
  if (conversationId) conversations.add(conversationId);
  if (projectId && conversationId) {
    pairs.set(`${projectId}:${conversationId}`, { projectId, conversationId });
  }
}

export function extractLegacyMutationReferences(
  method: string,
  args: unknown[],
  result: unknown,
): ConversationReference[] {
  const projects = new Set<string>();
  const conversations = new Set<string>();
  const pairs = new Map<string, ConversationReference>();
  args.forEach((arg) =>
    collectReferenceParts(arg, projects, conversations, pairs)
  );
  collectReferenceParts(result, projects, conversations, pairs);
  addStringArgumentReferences(method, args, projects, conversations, pairs);
  if (
    (method === "closeOpenAsSpam" ||
      method === "closeOpenConversationsAsSpam") &&
    typeof args[0] === "string" &&
    Array.isArray(result)
  ) {
    projects.add(args[0]);
    result.filter((id): id is string => typeof id === "string")
      .forEach((id) => conversations.add(id));
  }
  if (projects.size === 1) {
    const projectId = [...projects][0]!;
    conversations.forEach((conversationId) =>
      pairs.set(`${projectId}:${conversationId}`, { projectId, conversationId })
    );
  }
  return [...pairs.values()];
}

async function getParent(
  env: AppEnv,
  projectId: string,
): Promise<LegacyMirrorParentStub> {
  const { getAgentByName } = await import("agents");
  return await getAgentByName(
    env.MAVEN_PROJECT_AGENT,
    projectId,
  ) as unknown as LegacyMirrorParentStub;
}

async function mirrorReference(
  store: PublicConversationStore,
  env: AppEnv,
  reference: ConversationReference,
): Promise<void> {
  const parent = await getParent(env, reference.projectId);
  const conversation = await store.get(
    reference.projectId,
    reference.conversationId,
  );
  if (!conversation) {
    await parent.removeLegacyConversation(reference.conversationId);
    return;
  }
  const transcript = await store.getMessages(
    reference.projectId,
    reference.conversationId,
  );
  await parent.reconcileLegacyConversation({
    summary: await legacyEntryToSummary({
      conversation,
      messages: transcript,
    }),
    conversation,
    messages: transcript,
    checksum: await publicConversationImportChecksum(conversation, transcript),
  });
}

export function withLegacyConversationDirectoryMirror(
  store: PublicConversationStore,
  env: AppEnv,
): PublicConversationStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }
      return async (...args: unknown[]): Promise<unknown> => {
        const result = await Reflect.apply(
          value as (...input: unknown[]) => unknown,
          target,
          args,
        );
        if (MUTATING_METHODS.has(property)) {
          const references = extractLegacyMutationReferences(
            property,
            args,
            result,
          );
          await Promise.all(references.map(async (reference) => {
            try {
              await mirrorReference(store, env, reference);
            } catch {
              // A rerun of the directory backfill repairs a missed refresh.
            }
          }));
        }
        return result;
      };
    },
  });
}
