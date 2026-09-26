import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";
import { resolveSlackSecret } from "./slack-secrets";

export function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
