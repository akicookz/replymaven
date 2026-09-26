import { logWarn } from "../observability";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";
import { resolveTelegramToken } from "./telegram-secrets";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class TelegramService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private encryptionKey: string,
  ) {}

  // Every method takes the token as it is stored, so callers can pass a row
  // straight through without ever holding the decrypted credential.
  private async botToken(storedBotToken: string): Promise<string> {
    const token = await resolveTelegramToken(storedBotToken, this.encryptionKey);
    if (!token) throw new Error("Telegram bot token could not be read");
    return token;
  }

  // ─── Send Message to Telegram ───────────────────────────────────────────────

  async sendMessage(
    storedBotToken: string,
    chatId: string,
    text: string,
    replyToMessageId?: number,
  ): Promise<{ ok: boolean; message_id?: number }> {
    const botToken = await this.botToken(storedBotToken);
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    };
    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const result = (await response.json()) as {
      ok: boolean;
      result?: { message_id: number };
      description?: string;
    };
    if (!result.ok) {
      logWarn("telegram.send_failed", {
        chatId,
        status: response.status,
        description: result.description ?? null,
      });
    }
    return {
      ok: result.ok,
      message_id: result.result?.message_id,
    };
  }

  // ─── Set Webhook ────────────────────────────────────────────────────────────

  async setWebhook(
    storedBotToken: string,
    webhookUrl: string,
    secretToken: string,
  ): Promise<boolean> {
    const botToken = await this.botToken(storedBotToken);
    const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
    });

    const result = (await response.json()) as { ok: boolean };
    return result.ok;
  }

  // ─── Test Connection ────────────────────────────────────────────────────────

  async testConnection(
    storedBotToken: string,
    chatId: string,
  ): Promise<boolean> {
    const result = await this.sendMessage(
      storedBotToken,
      chatId,
      "ReplyMaven connection test successful!",
    );
    return result.ok;
  }

  // ─── Get Settings for Project ───────────────────────────────────────────────

  async getTelegramSettings(projectId: string) {
    const rows = await this.db
      .select({
        telegramBotToken: projectSettings.telegramBotToken,
        telegramChatId: projectSettings.telegramChatId,
      })
      .from(projectSettings)
      .where(eq(projectSettings.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }
}
