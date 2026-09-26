import type { DrizzleD1Database } from "drizzle-orm/d1";
import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";
import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import type { AppEnv } from "../types";
import { assignConversation } from "./conversation-actions";
import { startSidechatTurn } from "./start-sidechat-turn";

export type TeammateComposerResult =
  | { handled: false }
  | { handled: true; confirmation: string };

// The dashboard composer and MCP `send_agent_reply` talk to the customer by
// default. A leading @BotName turns the text into a Sidechat turn instead;
// a bare @BotName hands the thread back to Maven.
export async function handleTeammateComposerText(input: {
  text: string;
  botName: string | null | undefined;
  origin: "dashboard" | "mcp";
  projectId: string;
  conversationId: string;
  user: { id: string; name: string | null };
  db: DrizzleD1Database<Record<string, unknown>>;
  chatService: PublicConversationStore;
  env: Pick<AppEnv, "MAVEN_PROJECT_AGENT">;
}): Promise<TeammateComposerResult> {
  const mention = parseAgentBotNameCommand(input.text, input.botName);
  if (!mention.isCommand) return { handled: false };
  const botLabel = input.botName?.trim() || "Maven";

  if (!mention.commandText) {
    const handed = await assignConversation({
      db: input.db,
      chatService: input.chatService,
      projectId: input.projectId,
      conversationId: input.conversationId,
      assigneeId: MAVEN_ASSIGNEE_ID,
      actorName: input.user.name,
    });
    return {
      handled: true,
      confirmation: "error" in handed
        ? `Could not hand this back to ${botLabel}.`
        : `Handed back to ${botLabel}.`,
    };
  }

  const started = await startSidechatTurn({
    projectId: input.projectId,
    env: input.env,
    conversationId: input.conversationId,
    text: mention.commandText,
    origin: input.origin,
    actorUserId: input.user.id,
    authorUserId: input.user.id,
    authorDisplayName: input.user.name,
  });
  if (started.accepted) {
    return { handled: true, confirmation: `${botLabel} is looking into that.` };
  }
  if (started.reason === "busy") {
    return { handled: true, confirmation: `${botLabel} is already working on this.` };
  }
  return {
    handled: true,
    confirmation: `${botLabel} could not start that. Open Sidechat in the dashboard.`,
  };
}
