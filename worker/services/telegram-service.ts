import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";
import { resolveTelegramToken } from "./telegram-secrets";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildEscalationNotificationText(params: {
  visitorName: string | null;
  visitorEmail: string | null;
  summary: string;
  conversationUrl: string;
  conversationId: string;
  isUpdate: boolean;
}): string {
  const headline = params.isUpdate
    ? `<b>Conversation updated, needs human review</b>`
    : `<b>Needs human review</b>`;
  const who =
    [params.visitorName, params.visitorEmail].filter(Boolean).join(" · ") ||
    "Visitor";
  return [
    headline,
    "",
    `<b>${escapeHtml(who)}</b>`,
    escapeHtml(params.summary),
    "",
    `<b>Conversation:</b> <code>${escapeHtml(params.conversationId)}</code>`,
    `<a href="${params.conversationUrl}">Open conversation</a>`,
  ].join("\n");
}

export function buildBotResolvedNotificationText(
  botName: string | null,
  conversationId: string,
): string {
  const resolvedBy = escapeHtml(botName?.trim() || "The AI assistant");
  return [
    `<b>${resolvedBy} resolved this before a teammate joined.</b>`,
    "",
    `<b>Conversation:</b> <code>${escapeHtml(conversationId)}</code>`,
  ].join("\n");
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
    };
    return {
      ok: result.ok,
      message_id: result.result?.message_id,
    };
  }

  // ─── Notify Escalation with Conversation Deep-Link ──────────────────────────

  async notifyEscalation(
    storedBotToken: string,
    chatId: string,
    params: {
      visitorName: string | null;
      visitorEmail: string | null;
      summary: string;
      conversationUrl: string;
      conversationId: string;
      isUpdate: boolean;
      replyToMessageId?: number;
    },
  ): Promise<number | null> {
    const text = buildEscalationNotificationText(params);
    const result = await this.sendMessage(
      storedBotToken,
      chatId,
      text,
      params.replyToMessageId,
    );
    return result.message_id ?? null;
  }

  async notifyBotResolved(
    storedBotToken: string,
    chatId: string,
    botName: string | null,
    conversationId: string,
    replyToMessageId?: number,
  ): Promise<void> {
    await this.sendMessage(
      storedBotToken,
      chatId,
      buildBotResolvedNotificationText(botName, conversationId),
      replyToMessageId,
    );
  }

  // ─── Forward Visitor Message to Agent ─────────────────────────────────────

  async forwardVisitorMessage(
    storedBotToken: string,
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
    await this.sendMessage(storedBotToken, chatId, text, replyToMessageId);
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
