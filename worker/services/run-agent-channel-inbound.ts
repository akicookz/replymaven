import { logWarn } from "../observability";
import type {
  AgentChannelAdapter,
  AgentChannelId,
  AgentChannelInbound,
} from "./agent-channel";

const FAILED_DELIVERY =
  "That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.";

export interface AgentChannelCommandConversation {
  id: string;
  visitorId: string;
  visitorEmail: string | null;
  metadata: Record<string, unknown>;
}

export interface RunAgentChannelInboundDeps {
  adapter: AgentChannelAdapter;
  inbound: AgentChannelInbound;
  botName: string | null | undefined;
  getAgentModeConversations(): Promise<Array<{ id: string }>>;
  findByChannelThread(threadId: string): Promise<string | null>;
  getOperationalConversation(
    conversationId: string,
  ): Promise<AgentChannelCommandConversation | null>;
  executeCommand(input: {
    text: string;
    actorName: string | null;
    commandId: string;
    conversation: AgentChannelCommandConversation;
  }): Promise<{ handled: false } | { handled: true; confirmation: string }>;
  appendHuman(input: {
    conversationId: string;
    content: string;
    senderName: string | null;
    origin: AgentChannelId;
    externalReplyTo: string | null;
    idempotencyKey: string;
  }): Promise<unknown | null>;
}

export async function runAgentChannelInbound(
  input: RunAgentChannelInboundDeps,
): Promise<void> {
  const resolved = await input.adapter.resolveConversation({
    inbound: input.inbound,
    getAgentModeConversations: input.getAgentModeConversations,
    findByChannelThread: input.findByChannelThread,
  });
  if (resolved.kind === "ambiguous") {
    await input.adapter.confirm({
      text: resolved.hint,
      replyToExternalId: input.inbound.externalMessageId,
    });
    return;
  }
  if (resolved.kind === "none") {
    logWarn(`${input.inbound.channel}.reply_dropped`, {
      reason: resolved.reason,
    });
    return;
  }

  const conversation = await input.getOperationalConversation(
    resolved.conversationId,
  );
  if (!conversation) {
    logWarn(`${input.inbound.channel}.reply_dropped`, {
      conversationId: resolved.conversationId,
      reason: "conversation_not_found",
    });
    return;
  }

  const command = await input.executeCommand({
    text: input.inbound.text,
    actorName: input.inbound.actorName,
    commandId: input.inbound.commandId,
    conversation,
  });
  if (command.handled) {
    await input.adapter.confirm({
      text: command.confirmation,
      replyToExternalId: input.inbound.externalMessageId,
    });
    return;
  }

  const appended = await input.appendHuman({
    conversationId: conversation.id,
    content: input.inbound.text,
    senderName: input.inbound.actorName,
    origin: input.inbound.channel,
    externalReplyTo: input.inbound.replyToExternalId,
    idempotencyKey: input.inbound.commandId,
  });
  if (!appended) {
    await input.adapter.confirm({
      text: FAILED_DELIVERY,
      replyToExternalId: input.inbound.externalMessageId,
    });
  }
}
