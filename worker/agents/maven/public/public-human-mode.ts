import type { PublicConversationStatus } from "../../../../shared/maven-conversation";
import { parsePendingContactReply } from "../../../chat-runtime/routing/pending-contact-reply";
import type { ConversationChatState } from "../../../chat-runtime/types";

export interface PendingPublicContactUpdate {
  visitorName?: string;
  visitorEmail?: string;
  awaitingContactFields: Array<"name" | "email">;
  contactDeclined: boolean;
}

export function resolvePendingPublicContactUpdate(input: {
  status: PublicConversationStatus;
  chatState: ConversationChatState;
  message: string;
}): PendingPublicContactUpdate | null {
  if (
    input.status !== "active" ||
    input.chatState.aiParticipation === "human_only" ||
    input.chatState.awaitingContactFields.length === 0
  ) return null;
  const reply = parsePendingContactReply(
    input.message,
    input.chatState.awaitingContactFields,
  );
  if (!reply.visitorName && !reply.visitorEmail && !reply.contactDeclined) {
    return null;
  }
  return {
    ...(reply.visitorName ? { visitorName: reply.visitorName } : {}),
    ...(reply.visitorEmail ? { visitorEmail: reply.visitorEmail } : {}),
    awaitingContactFields: reply.remainingFields,
    contactDeclined: reply.contactDeclined,
  };
}
