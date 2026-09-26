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

  // Needs the users:read.email scope on the bot token; without it Slack
  // answers missing_scope and the author stays unknown.
  async lookupUserEmail(
    storedBotToken: string,
    userId: string,
  ): Promise<{ email: string; name: string | null } | { error: string }> {
    const token = await this.botToken(storedBotToken);
    const response = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      user?: { real_name?: string; profile?: { email?: string; real_name?: string } };
    };
    if (!result.ok) return { error: result.error ?? "users_info_failed" };
    const email = result.user?.profile?.email?.trim();
    if (!email) return { error: "no_email" };
    return {
      email,
      name: result.user?.real_name ?? result.user?.profile?.real_name ?? null,
    };
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
