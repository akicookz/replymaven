import { MAVEN_ASSIGNEE_ID } from "../../shared/maven-assignee";
import { parseAgentBotNameCommand } from "../chat-runtime/routing/public-turn-gates";
import {
  fallbackAiParticipationForStatus,
  parseChatState,
} from "../chat-runtime/types";
import { type PublicConversationStore } from "../conversations/public-conversation-store";
import { buildConversationDeepLink } from "../lib/deep-links";
import { logError, logWarn } from "../observability";
import type { AgentChannelAdapter, AgentChannelInbound } from "./agent-channel";
import { readConversationChannelMetadata } from "../../shared/maven-conversation";
import { assignConversation } from "./conversation-actions";
import {
  deriveTeammateThreadId,
  isTeammateThread,
  startSidechatTurn,
  startTeammateThreadTurn,
  type StartSidechatTurnResult,
} from "./start-sidechat-turn";
import type { AppEnv } from "../types";
import type { DrizzleD1Database } from "drizzle-orm/d1";

// Where Maven's answer goes: the Slack thread, the Telegram message, or the
// RFC id of the teammate's email.
function replyThreadFor(inbound: AgentChannelInbound): string | null {
  if (inbound.channel === "slack") {
    return inbound.replyToExternalId ?? inbound.externalMessageId;
  }
  if (inbound.channel === "email") return inbound.replyToExternalId;
  return inbound.externalMessageId;
}

// Same window the dashboard uses to show a customer as online.
const CUSTOMER_ONLINE_WINDOW_MS = 2 * 60 * 1_000;

// Starts the Maven turn after a teammate's direct reply; the prompt says
// what it means. Never shown to the customer.
function replyPostedTrigger(messageId: string): string {
  return `Teammate reply posted to the customer's chat (messageId ${messageId}).`;
}

const FAILED_DELIVERY =
  "That reply did not reach the visitor. Open the conversation in the dashboard and send it from there.";

// Sent at most once a day to a channel account we cannot match to a teammate.
const UNKNOWN_AUTHOR_HINT_TTL_SECONDS = 24 * 60 * 60;

async function postUnknownAuthorHint(input: {
  adapter: AgentChannelAdapter;
  inbound: AgentChannelInbound;
  hint: string | null | undefined;
  cache: KVNamespace;
}): Promise<void> {
  const externalId = input.inbound.author.externalId;
  if (!input.hint || !externalId) return;
  const key = `link-hint:${input.inbound.channel}:${externalId}`;
  if (await input.cache.get(key)) return;
  await input.cache.put(key, "1", {
    expirationTtl: UNKNOWN_AUTHOR_HINT_TTL_SECONDS,
  });
  await input.adapter.post({
    conversationId: "",
    text: input.hint,
    threadId: input.inbound.externalMessageId,
    conversationLink: "",
  }).catch((error: unknown) => {
    logError(`${input.inbound.channel}.unknown_author_hint_failed`, error);
  });
}

// One entry for every channel message from a teammate. When Maven owns the
// thread the message is a Sidechat turn; when a human owns it, plain text is a
// reply to the customer and an @BotName prefix still reaches Maven. A message
// to Maven outside any thread opens the teammate's own thread.
export async function ingestTeammateMessage(input: {
  adapter: AgentChannelAdapter;
  inbound: AgentChannelInbound;
  botName: string | null | undefined;
  projectId: string;
  project: { id: string; slug: string; name: string };
  db: DrizzleD1Database<Record<string, unknown>>;
  chatService: PublicConversationStore;
  env: Pick<
    AppEnv,
    "MAVEN_PROJECT_AGENT" | "BETTER_AUTH_URL" | "RESEND_API_KEY" | "CONVERSATIONS_CACHE"
  >;
  findByChannelThread(threadId: string): Promise<string | null>;
  // Shown to a sender who is not a verified teammate.
  unknownAuthorHint?: string | null;
  // Telegram only: index this message so a reply to it finds its thread.
  recordTeammateMessage?: (conversationId: string, messageId: string) => Promise<void>;
  startTurn?: typeof startSidechatTurn;
}): Promise<void> {
  const { adapter, inbound } = input;
  const resolved = await adapter.resolveConversation({
    inbound,
    findByChannelThread: input.findByChannelThread,
  });
  if (resolved.kind === "none") {
    logWarn(`${inbound.channel}.reply_dropped`, { reason: resolved.reason });
    return;
  }
  // Only a verified teammate reaches Maven or the customer, and Maven acts
  // with that teammate's own access.
  const authorUserId = inbound.author.userId;
  if (!authorUserId) {
    logWarn(`${inbound.channel}.unknown_author_dropped`, { kind: resolved.kind });
    await postUnknownAuthorHint({
      adapter,
      inbound,
      hint: input.unknownAuthorHint,
      cache: input.env.CONVERSATIONS_CACHE,
    });
    return;
  }
  const mention = parseAgentBotNameCommand(inbound.text, input.botName);
  const turnFields = {
    projectId: input.projectId,
    env: input.env,
    origin: inbound.channel,
    actorUserId: authorUserId,
    authorUserId,
    authorDisplayName: inbound.author.displayName,
    channelMessageId: `${inbound.channel}:${inbound.externalMessageId}`,
    replyThreadId: replyThreadFor(inbound),
    replyRecipient: inbound.author.email,
  };
  const replyInThread = (text: string) =>
    adapter.post({
      conversationId: "",
      text,
      threadId: inbound.externalMessageId,
      conversationLink: "",
    }).catch((error: unknown) => {
      logError(`${inbound.channel}.reply_post_failed`, error);
      return null;
    });

  if (resolved.kind === "new_thread") {
    const text = mention.commandText.trim();
    if (!text) return;
    const started = await startTeammateThreadTurn({
      ...turnFields,
      conversationId: await deriveTeammateThreadId(
        input.projectId,
        inbound.channel,
        inbound.externalMessageId,
      ),
      text,
      createdBy: authorUserId,
      telegramRootId: inbound.channel === "telegram"
        ? inbound.externalMessageId
        : null,
      slackRootTs: inbound.channel === "slack"
        ? inbound.replyToExternalId ?? inbound.externalMessageId
        : null,
      emailThread: null,
    });
    if (!started.accepted && started.reason !== "duplicate") {
      await replyInThread("Maven could not start that. Try again in a moment.");
    }
    return;
  }

  if (input.recordTeammateMessage) {
    await input.recordTeammateMessage(
      resolved.conversationId,
      inbound.externalMessageId,
    ).catch(() => undefined);
  }
  if (
    await isTeammateThread({
      projectId: input.projectId,
      env: input.env,
      threadId: resolved.conversationId,
    })
  ) {
    const text = mention.isCommand ? mention.commandText.trim() : inbound.text.trim();
    if (!text) return;
    const started = await (input.startTurn ?? startSidechatTurn)({
      ...turnFields,
      conversationId: resolved.conversationId,
      text,
    });
    if (!started.accepted && started.reason !== "duplicate") {
      await replyInThread("Maven could not start that. Try again in a moment.");
    }
    return;
  }

  const conversation = await input.chatService.getOperational(
    input.projectId,
    resolved.conversationId,
  );
  if (!conversation) {
    logWarn(`${inbound.channel}.reply_dropped`, {
      conversationId: resolved.conversationId,
      reason: "conversation_not_found",
    });
    return;
  }
  const conversationLink = buildConversationDeepLink(
    input.env.BETTER_AUTH_URL,
    input.projectId,
    conversation.id,
  );
  const reply = (text: string) =>
    adapter.post({
      conversationId: conversation.id,
      text,
      threadId: inbound.externalMessageId,
      conversationLink,
    }).catch((error: unknown) => {
      logError(`${inbound.channel}.reply_post_failed`, error, {
        conversationId: conversation.id,
      });
      return null;
    });

  const chatState = parseChatState(JSON.stringify(conversation.chatState), {
    fallbackAiParticipation: fallbackAiParticipationForStatus(
      conversation.status,
    ),
  });

  if (chatState.aiParticipation === "human_only" && !mention.isCommand) {
    const appended = await input.chatService.appendHuman({
      projectId: input.projectId,
      conversationId: conversation.id,
      content: inbound.text,
      senderName: inbound.author.displayName,
      ...(inbound.author.userId ? { userId: inbound.author.userId } : {}),
      idempotencyKey: `${inbound.channel}:${inbound.externalMessageId}`,
      origin: inbound.channel,
      externalReplyTo: inbound.replyToExternalId,
    }).catch((error: unknown) => {
      logError(`${inbound.channel}.reply_append_failed`, error, {
        projectId: input.projectId,
        conversationId: conversation.id,
      });
      return null;
    });
    if (!appended) {
      await reply(FAILED_DELIVERY);
      return;
    }
    // The reply lands in the chat. When the customer may not see it there
    // (they wrote in by email, or are offline) and has an email, Maven gets a
    // turn to offer emailing it, or to email it if told to earlier.
    const lastSeen = conversation.visitorLastSeenAt;
    const customerOnline = lastSeen !== null &&
      Date.now() - lastSeen < CUSTOMER_ONLINE_WINDOW_MS &&
      conversation.visitorPresence !== "background";
    const wroteByEmail =
      readConversationChannelMetadata(conversation.metadata).channel === "email";
    if (
      inbound.author.userId &&
      conversation.visitorEmail?.trim() &&
      (wroteByEmail || !customerOnline)
    ) {
      await (input.startTurn ?? startSidechatTurn)({
        projectId: input.projectId,
        env: input.env,
        conversationId: conversation.id,
        text: replyPostedTrigger(appended.id),
        origin: inbound.channel,
        actorUserId: authorUserId,
        authorUserId: inbound.author.userId,
        authorDisplayName: inbound.author.displayName,
        channelMessageId: `${inbound.channel}:${inbound.externalMessageId}:posted`,
        replyThreadId: replyThreadFor(inbound),
        replyRecipient: inbound.author.email,
      }).catch((error: unknown) => {
        logError(`${inbound.channel}.email_offer_turn_failed`, error, {
          conversationId: conversation.id,
        });
      });
    }
    return;
  }

  const text = mention.isCommand ? mention.commandText : inbound.text.trim();
  if (!text) {
    // A bare @BotName hands the thread back to Maven.
    const handed = await assignConversation({
      db: input.db,
      chatService: input.chatService,
      projectId: input.projectId,
      conversationId: conversation.id,
      assigneeId: MAVEN_ASSIGNEE_ID,
      actorName: inbound.author.displayName,
    });
    await reply(
      "error" in handed
        ? "Could not hand this back to Maven."
        : `Handed back to ${input.botName?.trim() || "Maven"}.`,
    );
    return;
  }

  const started: StartSidechatTurnResult = await (input.startTurn ??
    startSidechatTurn)({
    projectId: input.projectId,
    env: input.env,
    conversationId: conversation.id,
    text,
    origin: inbound.channel,
    actorUserId: authorUserId,
    authorUserId: inbound.author.userId,
    authorDisplayName: inbound.author.displayName,
    channelMessageId: `${inbound.channel}:${inbound.externalMessageId}`,
    replyThreadId: replyThreadFor(inbound),
    replyRecipient: inbound.author.email,
  });
  if (started.accepted || started.reason === "duplicate") return;
  await reply(`Maven could not start that. Open the conversation: ${conversationLink}`);
}
