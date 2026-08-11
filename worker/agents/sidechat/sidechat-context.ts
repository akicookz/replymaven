import type { SidechatCustomerContext } from "../../../shared/sidechat-agent";
import type { ConversationRow, MessageRow } from "../../db";

interface SidechatCustomerRow {
  id: string;
  projectId: string;
  name: string | null;
  externalId: string | null;
  email: string | null;
}

type SidechatConversationRow = Pick<
  ConversationRow,
  | "id"
  | "projectId"
  | "customerId"
  | "visitorName"
  | "visitorEmail"
  | "status"
  | "archivedAt"
>;

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
    conversationId: string,
    limit: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }>;
}

interface BuildSidechatContextOptions {
  projectId: string;
  conversationId: string;
  dependencies: SidechatContextDependencies;
}

const MAX_CUSTOMER_NAME_CHARS = 200;
const MAX_CUSTOMER_EXTERNAL_ID_CHARS = 255;
const MAX_CUSTOMER_EMAIL_CHARS = 320;
const MAX_PUBLIC_MESSAGE_CHARS = 8_000;

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

function comparePublicMessages(left: MessageRow, right: MessageRow): number {
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
    options.dependencies.getRecentPublicMessages(options.conversationId, 40),
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

  const recentPublicMessages = [...publicPage.messages]
    .sort(comparePublicMessages)
    .slice(-40)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content.slice(0, MAX_PUBLIC_MESSAGE_CHARS),
      createdAt: toEpochMilliseconds(message.createdAt),
    }));

  return {
    projectId: options.projectId,
    conversationId: options.conversationId,
    conversationStatus: conversation.status,
    archivedAt: conversation.archivedAt?.getTime() ?? null,
    customer: canonicalCustomer,
    // The public schema currently has no durable bounded conversation summary.
    // Do not synthesize one or repurpose private handoff metadata here.
    publicSummary: null,
    recentPublicMessages,
  };
}
