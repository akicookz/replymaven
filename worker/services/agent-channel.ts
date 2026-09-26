// A channel is a transport for the team thread: teammate text comes in, Maven's
// text goes out. Everything else (who decides what, what the note says) lives
// in the Sidechat.

export type AgentChannelId = "telegram" | "slack" | "email";

export type AgentChannelResolve =
  | { kind: "targeted"; conversationId: string }
  | { kind: "ambiguous"; hint: string }
  | { kind: "none"; reason: string };

export interface AgentChannelAuthor {
  // Verified ReplyMaven user id, "" until the channel account is linked.
  userId: string;
  displayName: string | null;
  email: string | null;
}

export interface AgentChannelInbound {
  channel: AgentChannelId;
  text: string;
  externalMessageId: string;
  replyToExternalId: string | null;
  replyToText: string | null;
  author: AgentChannelAuthor;
}

export interface AgentChannelPost {
  conversationId: string;
  text: string;
  // Where to reply on the channel. null starts a new thread.
  threadId: string | null;
  conversationLink: string;
  // Email only.
  recipient?: string | null;
  subject?: string | null;
}

export function readChannelThreadId(
  conversation: {
    telegramThreadId?: string | null;
    channelThreads?: { telegram?: string; slack?: string } | null;
  },
  channel: AgentChannelId,
): string | null {
  if (channel === "email") return null;
  return conversation.channelThreads?.[channel]
    ?? (channel === "telegram" ? conversation.telegramThreadId ?? null : null);
}

export interface AgentChannelAdapter {
  readonly channel: AgentChannelId;
  resolveConversation(input: {
    inbound: AgentChannelInbound;
    getAgentModeConversations(): Promise<Array<{ id: string }>>;
    findByChannelThread(threadId: string): Promise<string | null>;
  }): Promise<AgentChannelResolve>;
  // Returns the thread id to reply under next time, or null when unknown.
  post(input: AgentChannelPost): Promise<string | null>;
}
