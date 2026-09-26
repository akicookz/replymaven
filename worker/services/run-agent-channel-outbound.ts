import type { AgentChannelAdapter } from "./agent-channel";
import { readChannelThreadId } from "./agent-channel";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PublicChannelThreads } from "../../shared/maven-conversation";
import type {
  ActiveHumanRoute,
} from "../chat-runtime/types";
import { logError } from "../observability";
import {
  getAssignableUsers,
  type AssignableUser,
} from "./assignable-users";
import type { EmailService } from "./email-service";

const MAX_FORWARD_CHARS = 1000;

// A customer message reaches the channels where a teammate has already
// written (the joined routes), threaded under that conversation.
export async function forwardVisitorToJoinedHumans(input: {
  channels: AgentChannelAdapter[];
  activeHumanRoutes: ActiveHumanRoute[];
  conversationId: string;
  conversationLink: string;
  visitorName: string | null;
  content: string;
  channelThreads?: PublicChannelThreads | null;
  telegramThreadId?: string | null;
  email?: {
    db: DrizzleD1Database<Record<string, unknown>>;
    service: Pick<EmailService, "sendVisitorReplyToAgentEmail">;
    projectId: string;
    projectSlug: string;
    projectName: string;
    messageId: string;
    dashboardUrl: string;
    messageContent?: string;
    visitorDisplayName?: string;
  };
  dependencies?: {
    getAssignableUsers(
      db: DrizzleD1Database<Record<string, unknown>>,
      projectId: string,
    ): Promise<AssignableUser[]>;
  };
}): Promise<void> {
  const joinedChannels = new Set<string>(
    input.activeHumanRoutes
      .filter(
        (
          route,
        ): route is Extract<
          ActiveHumanRoute,
          { kind: "agent_channel" }
        > => route.kind === "agent_channel",
      )
      .map((route) => route.channel),
  );
  const name = input.visitorName?.trim() || "Visitor";
  const content = input.content.length > MAX_FORWARD_CHARS
    ? `${input.content.slice(0, MAX_FORWARD_CHARS)}...`
    : input.content;
  const channelDeliveries = input.channels
    .filter((adapter) => joinedChannels.has(adapter.channel))
    .map((adapter) =>
      adapter.post({
        conversationId: input.conversationId,
        text: `${name}: ${content}`,
        threadId: readChannelThreadId(
          {
            channelThreads: input.channelThreads,
            telegramThreadId: input.telegramThreadId ?? null,
          },
          adapter.channel,
        ),
        conversationLink: input.conversationLink,
      }).catch((error: unknown) => {
        logError("joined_human_route.channel_forward_failed", error, {
          conversationId: input.conversationId,
          channel: adapter.channel,
        });
        return null;
      })
    );
  const email = input.email;
  const loadAssignableUsers =
    input.dependencies?.getAssignableUsers ?? getAssignableUsers;
  const emailDeliveries = email
    ? input.activeHumanRoutes
        .filter(
          (
            route,
          ): route is Extract<
            ActiveHumanRoute,
            { kind: "email" }
          > => route.kind === "email",
        )
        .map((route) =>
          (async () => {
            const assignable = await loadAssignableUsers(
              email.db,
              email.projectId,
            );
            const recipient = assignable.find(
              (candidate) => candidate.id === route.userId,
            );
            if (!recipient?.email) return;
            const visitorDisplayName = email.visitorDisplayName?.trim() ||
              input.visitorName?.trim() ||
              "Visitor";
            await email.service.sendVisitorReplyToAgentEmail({
              to: recipient.email,
              projectSlug: email.projectSlug,
              projectName: email.projectName,
              conversationId: input.conversationId,
              messageId: email.messageId,
              visitorDisplayName,
              messageContent: email.messageContent ?? input.content,
              dashboardUrl: email.dashboardUrl,
            });
          })().catch((error: unknown) => {
            logError("joined_human_route.email_forward_failed", error, {
              conversationId: input.conversationId,
              userId: route.userId,
            });
          })
        )
    : [];

  await Promise.all([...channelDeliveries, ...emailDeliveries]);
}
