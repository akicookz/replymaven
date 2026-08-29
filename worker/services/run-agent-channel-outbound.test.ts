import { expect, mock, test } from "bun:test";
import type { AgentChannelAdapter } from "./agent-channel";
import { forwardVisitorToJoinedHumans } from "./run-agent-channel-outbound";

function channel(
  id: "telegram" | "slack",
  deliveries: string[],
): AgentChannelAdapter {
  return {
    channel: id,
    resolveConversation: async () => null,
    notifyEscalation: async () => null,
    async forwardVisitorMessage(input) {
      deliveries.push(`${id}:${input.content}:${input.threadId ?? "none"}`);
    },
    confirm: async () => undefined,
  };
}

test("forwards only to joined channel clients and all joined email clients", async () => {
  const channelDeliveries: string[] = [];
  const emailDeliveries: string[] = [];
  const emailService = {
    async sendVisitorReplyToAgentEmail(input: { to: string }) {
      emailDeliveries.push(input.to);
    },
  };

  await forwardVisitorToJoinedHumans({
    channels: [
      channel("telegram", channelDeliveries),
      channel("slack", channelDeliveries),
    ],
    activeHumanRoutes: [
      { kind: "agent_channel", channel: "telegram" },
      {
        kind: "email",
        userId: "user-1",
      },
      {
        kind: "email",
        userId: "user-2",
      },
    ],
    conversationId: "conversation-1",
    visitorName: "Alice",
    content: "More details",
    channelThreads: {
      telegram: "telegram-thread",
      slack: "slack-thread",
    },
    email: {
      db: {} as never,
      service: emailService,
      projectId: "project-1",
      projectSlug: "acme",
      projectName: "Acme",
      messageId: "visitor-message-1",
      dashboardUrl: "https://app.test/conversation-1",
      accentColor: null,
    },
    dependencies: {
      getAssignableUsers: mock(async () => [
        {
          id: "user-1",
          name: "One",
          email: "one@example.com",
          image: null,
          role: "member" as const,
        },
        {
          id: "user-2",
          name: "Two",
          email: "two@example.com",
          image: null,
          role: "admin" as const,
        },
      ]),
    },
  });

  expect(channelDeliveries).toEqual([
    "telegram:More details:telegram-thread",
  ]);
  expect(emailDeliveries).toEqual([
    "one@example.com",
    "two@example.com",
  ]);
});

test("does not forward before any human client joins", async () => {
  const deliveries: string[] = [];

  await forwardVisitorToJoinedHumans({
    channels: [channel("telegram", deliveries), channel("slack", deliveries)],
    activeHumanRoutes: [],
    conversationId: "conversation-1",
    visitorName: null,
    content: "Still waiting",
  });

  expect(deliveries).toEqual([]);
});

test("skips a joined email route after project access is revoked", async () => {
  const sendVisitorReplyToAgentEmail = mock(async () => undefined);

  await forwardVisitorToJoinedHumans({
    channels: [],
    activeHumanRoutes: [{ kind: "email", userId: "revoked-user" }],
    conversationId: "conversation-1",
    visitorName: "Alice",
    content: "More details",
    email: {
      db: {} as never,
      service: { sendVisitorReplyToAgentEmail },
      projectId: "project-1",
      projectSlug: "acme",
      projectName: "Acme",
      messageId: "visitor-message-1",
      dashboardUrl: "https://app.test/conversation-1",
      accentColor: null,
    },
    dependencies: {
      getAssignableUsers: mock(async () => []),
    },
  });

  expect(sendVisitorReplyToAgentEmail).not.toHaveBeenCalled();
});

test("forwards two concurrent visitor messages without dropping either", async () => {
  const deliveries: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const adapter = channel("telegram", deliveries);
  const originalForward = adapter.forwardVisitorMessage;
  let calls = 0;
  adapter.forwardVisitorMessage = async (input) => {
    calls += 1;
    if (calls === 1) await firstBlocked;
    await originalForward(input);
  };
  const base = {
    channels: [adapter],
    activeHumanRoutes: [
      { kind: "agent_channel", channel: "telegram" as const },
    ],
    conversationId: "conversation-1",
    visitorName: "Alice",
    channelThreads: { telegram: "telegram-thread" },
  };

  const first = forwardVisitorToJoinedHumans({ ...base, content: "First" });
  const second = forwardVisitorToJoinedHumans({ ...base, content: "Second" });
  await second;
  releaseFirst?.();
  await first;

  expect(deliveries.sort()).toEqual([
    "telegram:First:telegram-thread",
    "telegram:Second:telegram-thread",
  ]);
});
