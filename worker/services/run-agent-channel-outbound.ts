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

export async function forwardVisitorToJoinedHumans(input: {
  channels: AgentChannelAdapter[];
  activeHumanRoutes: ActiveHumanRoute[];
  conversationId: string;
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
    accentColor: string | null;
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
  const joinedChannels = new Set(
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
  const channelDeliveries = input.channels
    .filter((adapter) => joinedChannels.has(adapter.channel))
    .map((adapter) =>
      adapter.forwardVisitorMessage({
        conversationId: input.conversationId,
        visitorName: input.visitorName,
        content: input.content,
        threadId: readChannelThreadId(
          {
            channelThreads: input.channelThreads,
            telegramThreadId: input.telegramThreadId ?? null,
          },
          adapter.channel,
        ),
      }).catch((error: unknown) => {
        logError("joined_human_route.channel_forward_failed", error, {
          conversationId: input.conversationId,
          channel: adapter.channel,
        });
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
              accentColor: email.accentColor,
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
