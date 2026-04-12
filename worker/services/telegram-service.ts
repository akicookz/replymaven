import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

  // ─── Notify Inquiry Submission with Dashboard Link ──────────────────────────

  async notifyInquiry(
    botToken: string,
    chatId: string,
    fields: Record<string, string>,
    dashboardBaseUrl: string,
    projectId: string,
    options?: {
      isUpdate?: boolean;
      replyToMessageId?: number;
    },
  ): Promise<number | null> {
    const fieldLines = Object.entries(fields)
      .map(([key, val]) => `<b>${escapeHtml(key)}:</b> ${escapeHtml(val)}`)
      .join("\n");

    const projectLink = `${dashboardBaseUrl}/app/projects/${projectId}/inquiries`;
    const headline = options?.isUpdate
      ? `<b>Inquiry updated</b>`
      : `<b>New inquiry submitted</b>`;

    const text = [
      headline,
      ``,
      fieldLines,
      ``,
      `<a href="${projectLink}">View on dashboard</a>`,
    ].join("\n");

    const result = await this.sendMessage(
      botToken,
      chatId,
      text,
      options?.replyToMessageId,
    );
    return result.message_id ?? null;
  }

  // ─── Forward Visitor Message to Agent ─────────────────────────────────────

  async forwardVisitorMessage(
    botToken: string,
    chatId: string,
    visitorName: string | null,
    content: string,
    conversationId: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const name = escapeHtml(visitorName ?? "Visitor");
    const truncated =
      content.length > 1000 ? content.slice(0, 1000) + "..." : content;
    const text = [
      `<b>${name}:</b> ${escapeHtml(truncated)}`,
      ``,
      `<b>Conversation:</b> <code>${conversationId}</code>`,
    ].join("\n");
    await this.sendMessage(botToken, chatId, text, replyToMessageId);
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
