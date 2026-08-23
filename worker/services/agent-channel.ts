export type AgentChannelId = "telegram" | "slack";

export type AgentChannelResolve =
  | { kind: "targeted"; conversationId: string }
  | { kind: "ambiguous"; hint: string }
  | { kind: "none"; reason: string };

export interface AgentChannelInbound {
  channel: AgentChannelId;
  text: string;
  actorName: string | null;
  commandId: string;
  externalMessageId: string;
  replyToExternalId: string | null;
  replyToText: string | null;
}

export interface AgentChannelAdapter {
  readonly channel: AgentChannelId;
  resolveConversation(input: {
    inbound: AgentChannelInbound;
    getAgentModeConversations(): Promise<Array<{ id: string }>>;
    findByChannelThread(threadId: string): Promise<string | null>;
  }): Promise<AgentChannelResolve>;
  notifyEscalation(input: {
    conversationId: string;
    visitorName: string | null;
    visitorEmail: string | null;
    summary: string;
    conversationUrl: string;
    isUpdate: boolean;
    threadId: string | null;
  }): Promise<string | null>;
  forwardVisitorMessage(input: {
    conversationId: string;
    visitorName: string | null;
    content: string;
    threadId: string | null;
  }): Promise<void>;
  confirm(input: {
    text: string;
    replyToExternalId: string;
  }): Promise<void>;
}
