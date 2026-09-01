import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";
import type { PublicConversationStore } from "../conversations/public-conversation-store";

export type MavenAssignmentReason = "manual" | "idle";

export function canHandConversationToMaven(conversation: {
  status: string;
}): boolean {
  return conversation.status !== "closed";
}

export function mavenAssignedSystemContent(input: {
  botName: string | null | undefined;
  actorName?: string | null;
  reason: MavenAssignmentReason;
}): string {
  const bot = input.botName?.trim() || "Maven";
  if (input.reason === "idle") {
    return `${bot} self-assigned because the human seemed away`;
  }
  const actor = input.actorName?.trim() || "Someone";
  return `${actor} assigned ${bot}`;
}

export async function recordMavenAssignment(input: {
  chatService: Pick<
    PublicConversationStore,
    "applyAction" | "addPublicSystemMessage"
  >;
  conversationId: string;
  projectId: string;
  botName: string | null | undefined;
  actorName?: string | null;
  reason: MavenAssignmentReason;
}): Promise<void> {
  await input.chatService.applyAction({
    projectId: input.projectId,
    conversationId: input.conversationId,
    action: { action: "assign", assigneeId: MAVEN_ASSIGNEE_ID },
  });
  await input.chatService.addPublicSystemMessage(
    input.conversationId,
    "assigned",
    mavenAssignedSystemContent({
      botName: input.botName,
      actorName: input.actorName,
      reason: input.reason,
    }),
    undefined,
    input.projectId,
  );
}
