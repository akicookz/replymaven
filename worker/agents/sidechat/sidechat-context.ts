import type {
  SidechatConversationBrief,
  SidechatCustomerContext,
  SidechatMessageOrigin,
} from "../../../shared/sidechat-agent";
import type {
  PublicConversationRecord,
  PublicMessageRecord,
} from "../../../shared/maven-conversation";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
} from "../../chat-runtime/types";

interface SidechatCustomerRow {
  id: string;
  projectId: string;
  name: string | null;
  externalId: string | null;
  email: string | null;
}

type SidechatConversationRow = Pick<
  PublicConversationRecord,
  | "id"
  | "projectId"
  | "customerId"
  | "visitorName"
  | "visitorEmail"
  | "status"
  | "archivedAt"
  | "assigneeId"
  | "chatState"
>;

export interface SidechatTurnContextInput {
  origin: SidechatMessageOrigin;
  botName: string;
  author: { id: string; name: string } | null;
  teammates: Array<{ id: string; name: string }>;
  links: { conversation: string; tools: string };
  emailSubject: string | null;
  pendingApproval: { toolCallId: string; description: string } | null;
}

export interface SidechatContextDependencies {
  getConversation(
    conversationId: string,
    projectId: string,
  ): Promise<SidechatConversationRow | null>;
  getCustomer(
    projectId: string,
    customerId: string,
  ): Promise<SidechatCustomerRow | null>;
  getRecentPublicMessages(
    projectId: string,
    conversationId: string,
    limit: number,
  ): Promise<{ messages: PublicMessageRecord[]; hasMore: boolean }>;
}

interface BuildSidechatContextOptions {
  projectId: string;
  conversationId: string;
  turn: SidechatTurnContextInput;
  dependencies: SidechatContextDependencies;
}

const MAX_CUSTOMER_NAME_CHARS = 200;
const MAX_CUSTOMER_EXTERNAL_ID_CHARS = 255;
const MAX_CUSTOMER_EMAIL_CHARS = 320;
const MAX_PUBLIC_MESSAGE_CHARS = 8_000;
const MAX_SOURCE_TITLE_CHARS = 200;
const MAX_SOURCE_URL_CHARS = 2_048;

function trimNullable(value: string | null, maxLength: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeEmail(value: string | null): string | null {
  return trimNullable(value, MAX_CUSTOMER_EMAIL_CHARS)?.toLowerCase() ?? null;
}

function toEpochMilliseconds(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function comparePublicMessages(
  left: PublicMessageRecord,
  right: PublicMessageRecord,
): number {
  const timestampDifference =
    toEpochMilliseconds(left.createdAt) - toEpochMilliseconds(right.createdAt);
  if (timestampDifference !== 0) return timestampDifference;
  return left.id.localeCompare(right.id);
}

export async function buildSidechatContext(
  options: BuildSidechatContextOptions,
): Promise<SidechatCustomerContext> {
  const conversation = await options.dependencies.getConversation(
    options.conversationId,
    options.projectId,
  );
  if (
    !conversation ||
    conversation.id !== options.conversationId ||
    conversation.projectId !== options.projectId
  ) {
    throw new Error("Sidechat conversation not found");
  }

  const [customer, publicPage] = await Promise.all([
    conversation.customerId
      ? options.dependencies.getCustomer(
          options.projectId,
          conversation.customerId,
        )
      : Promise.resolve(null),
    options.dependencies.getRecentPublicMessages(
      options.projectId,
      options.conversationId,
      40,
    ),
  ]);

  const canonicalCustomer =
    customer && customer.projectId === options.projectId
      ? {
          id: customer.id,
          name: trimNullable(customer.name, MAX_CUSTOMER_NAME_CHARS),
          externalId: trimNullable(
            customer.externalId,
            MAX_CUSTOMER_EXTERNAL_ID_CHARS,
          ),
          email: normalizeEmail(customer.email),
        }
      : null;

  const visitorName = trimNullable(
    conversation.visitorName,
    MAX_CUSTOMER_NAME_CHARS,
  );
  const visitorEmail = normalizeEmail(conversation.visitorEmail);
  const visitor = visitorName !== null || visitorEmail !== null
    ? { name: visitorName, email: visitorEmail }
    : null;

  const recentPublicMessages = [...publicPage.messages]
    .sort(comparePublicMessages)
    .slice(-40)
    .map((message) => {
      const sources = message.author === "bot"
        ? message.sources.slice(0, 5).map((source) => ({
          title: source.title.slice(0, MAX_SOURCE_TITLE_CHARS),
          url: source.url === null
            ? null
            : source.url.slice(0, MAX_SOURCE_URL_CHARS),
          type: source.type,
        }))
        : [];
      return {
        id: message.id,
        role: message.author,
        content: message.content.slice(0, MAX_PUBLIC_MESSAGE_CHARS),
        createdAt: toEpochMilliseconds(message.createdAt),
        ...(sources.length > 0 ? { sources } : {}),
      };
    });

  const assignee = conversation.assigneeId
    ? options.turn.teammates.find((member) => member.id === conversation.assigneeId)
      ?? null
    : null;

  return {
    projectId: options.projectId,
    conversationId: options.conversationId,
    thread: "customer",
    openConversations: [],
    inboxCounts: null,
    conversationStatus: conversation.status,
    archivedAt: conversation.archivedAt,
    origin: options.turn.origin,
    botName: options.turn.botName,
    author: options.turn.author,
    assignee,
    humanOwned: parseChatState(JSON.stringify(conversation.chatState), {
      fallbackAiParticipation: fallbackAiParticipationForStatus(
        conversation.status,
      ),
    }).aiParticipation === "human_only",
    teammates: options.turn.teammates,
    links: options.turn.links,
    emailSubject: options.turn.emailSubject,
    pendingApproval: options.turn.pendingApproval,
    customer: canonicalCustomer,
    visitor,
    // The public schema currently has no durable bounded conversation summary.
    // Do not synthesize one or repurpose private handoff metadata here.
    publicSummary: null,
    recentPublicMessages,
  };
}

// A teammate's own thread: no customer, no public transcript.
export function buildTeammateThreadContext(input: {
  projectId: string;
  threadId: string;
  archivedAt: number | null;
  turn: SidechatTurnContextInput;
  openConversations: SidechatConversationBrief[];
  inboxCounts: { needsYou: number; open: number; snoozed: number };
}): SidechatCustomerContext {
  return {
    projectId: input.projectId,
    conversationId: input.threadId,
    thread: "teammate",
    openConversations: input.openConversations,
    inboxCounts: input.inboxCounts,
    conversationStatus: "teammate_thread",
    archivedAt: input.archivedAt,
    origin: input.turn.origin,
    botName: input.turn.botName,
    author: input.turn.author,
    assignee: null,
    humanOwned: false,
    teammates: input.turn.teammates,
    links: input.turn.links,
    emailSubject: input.turn.emailSubject,
    pendingApproval: input.turn.pendingApproval,
    customer: null,
    visitor: null,
    publicSummary: null,
    recentPublicMessages: [],
  };
}

const MAX_BRIEF_TEXT_CHARS = 200;

export function toConversationBrief(
  summary: {
    conversationId: string;
    visitorName: string | null;
    visitorEmail: string | null;
    status: string;
    assigneeId: string | null;
    metadata: Record<string, unknown>;
    lastMessagePreview: string | null;
    lastActivityAt: number;
  },
  teammates: Array<{ id: string; name: string }>,
): SidechatConversationBrief {
  const subject = typeof summary.metadata.subject === "string"
    ? summary.metadata.subject
    : null;
  return {
    conversationId: summary.conversationId,
    customerName: trimNullable(summary.visitorName, MAX_CUSTOMER_NAME_CHARS),
    customerEmail: normalizeEmail(summary.visitorEmail),
    status: summary.status,
    assignee: summary.assigneeId
      ? teammates.find((member) => member.id === summary.assigneeId)?.name ??
        "a teammate"
      : null,
    subject: trimNullable(subject, MAX_BRIEF_TEXT_CHARS),
    lastMessage: trimNullable(summary.lastMessagePreview, MAX_BRIEF_TEXT_CHARS),
    lastActivityAt: summary.lastActivityAt,
  };
}
