import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";
import { resolveSlackSecret } from "./slack-secrets";

function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSlackEscalationText(params: {
  visitorName: string | null;
  visitorEmail: string | null;
  summary: string;
  conversationUrl: string;
  conversationId: string;
  isUpdate: boolean;
}): string {
  const headline = params.isUpdate
    ? "*Conversation updated, needs human review*"
    : "*Needs human review*";
  const who =
    [params.visitorName, params.visitorEmail].filter(Boolean).join(" · ") ||
    "Visitor";
  return [
    headline,
    "",
    `*${escapeMrkdwn(who)}*`,
    escapeMrkdwn(params.summary),
    "",
    `*Conversation:* \`${escapeMrkdwn(params.conversationId)}\``,
    `<${params.conversationUrl}|Open conversation>`,
  ].join("\n");
}

export class SlackService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private encryptionKey: string,
  ) {}

  private async botToken(storedBotToken: string): Promise<string> {
    const token = await resolveSlackSecret(storedBotToken, this.encryptionKey);
    if (!token) throw new Error("Slack bot token could not be read");
    return token;
  }

  async postMessage(
    storedBotToken: string,
    input: {
      channelId: string;
      text: string;
      threadTs?: string | null;
    },
  ): Promise<string | null> {
    const token = await this.botToken(storedBotToken);
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: input.channelId,
        text: input.text,
        unfurl_links: false,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as { ok?: boolean; ts?: string };
    if (!result.ok || !result.ts) return null;
    return result.ts;
  }

  async notifyEscalation(
    storedBotToken: string,
    channelId: string,
    params: {
      visitorName: string | null;
      visitorEmail: string | null;
      summary: string;
      conversationUrl: string;
      conversationId: string;
      isUpdate: boolean;
      threadTs?: string | null;
    },
  ): Promise<string | null> {
    return this.postMessage(storedBotToken, {
      channelId,
      text: buildSlackEscalationText(params),
      threadTs: params.threadTs,
    });
  }

  async forwardVisitorMessage(
    storedBotToken: string,
    channelId: string,
    visitorName: string | null,
    content: string,
    conversationId: string,
    threadTs?: string | null,
  ): Promise<void> {
    const name = escapeMrkdwn(visitorName ?? "Visitor");
    const truncated =
      content.length > 1000 ? content.slice(0, 1000) + "..." : content;
    await this.postMessage(storedBotToken, {
      channelId,
      threadTs,
      text: [
        `*${name}:* ${escapeMrkdwn(truncated)}`,
        "",
        `*Conversation:* \`${conversationId}\``,
      ].join("\n"),
    });
  }

  async testConnection(
    storedBotToken: string,
    channelId: string,
  ): Promise<boolean> {
    const ts = await this.postMessage(storedBotToken, {
      channelId,
      text: "ReplyMaven connection test successful!",
    });
    return ts !== null;
  }

  async getSlackSettings(projectId: string) {
    const rows = await this.db
      .select({
        slackBotToken: projectSettings.slackBotToken,
        slackSigningSecret: projectSettings.slackSigningSecret,
        slackChannelId: projectSettings.slackChannelId,
      })
      .from(projectSettings)
      .where(eq(projectSettings.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }
}
