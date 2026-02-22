import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";

export class TelegramService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Send Message to Telegram ───────────────────────────────────────────────

  async sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    replyToMessageId?: number,
  ): Promise<{ ok: boolean; message_id?: number }> {
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
    });

    const result = (await response.json()) as {
      ok: boolean;
      result?: { message_id: number };
    };
    return {
      ok: result.ok,
      message_id: result.result?.message_id,
    };
  }

  // ─── Notify Agent of New Conversation ───────────────────────────────────────

  async notifyHandoff(
    botToken: string,
    chatId: string,
    conversationId: string,
    visitorName: string | null,
    summary: string,
  ): Promise<number | null> {
    const text = [
      `<b>New support request</b>`,
      ``,
      `<b>Visitor:</b> ${visitorName ?? "Anonymous"}`,
      `<b>Conversation:</b> <code>${conversationId}</code>`,
      ``,
      `<b>Summary:</b>`,
      summary,
      ``,
      `Reply to this message to respond to the visitor.`,
    ].join("\n");

    const result = await this.sendMessage(botToken, chatId, text);
    return result.message_id ?? null;
  }

  // ─── Set Webhook ────────────────────────────────────────────────────────────

  async setWebhook(
    botToken: string,
    webhookUrl: string,
  ): Promise<boolean> {
    const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const result = (await response.json()) as { ok: boolean };
    return result.ok;
  }

  // ─── Test Connection ────────────────────────────────────────────────────────

  async testConnection(
    botToken: string,
    chatId: string,
  ): Promise<boolean> {
    const result = await this.sendMessage(
      botToken,
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
