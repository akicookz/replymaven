import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { projectSettings } from "../db";

interface TelegramMessage {
  role: string;
  content: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMessageHistory(messages: TelegramMessage[]): string {
  return messages
    .map((m) => {
      const label =
        m.role === "visitor"
          ? "Visitor"
          : m.role === "bot"
            ? "Bot"
            : "Agent";
      const truncated =
        m.content.length > 300
          ? m.content.slice(0, 300) + "..."
          : m.content;
      return `<b>${label}:</b> ${escapeHtml(truncated)}`;
    })
    .join("\n\n");
}

function buildCommandFooter(botName?: string | null): string {
  const lines = ["Reply to respond to the visitor."];
  if (botName) {
    lines.push(`@${botName} to hand back to the bot.`);
  }
  return lines.join("\n");
}

function buildDashboardLink(
  baseUrl: string,
  projectId: string,
  conversationId: string,
): string {
  return `${baseUrl}/app/projects/${projectId}/conversations?id=${conversationId}`;
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

  // ─── Notify Agent of Handoff ────────────────────────────────────────────────

  async notifyHandoff(
    botToken: string,
    chatId: string,
    conversationId: string,
    visitorName: string | null,
    summary: string,
    recentMessages: TelegramMessage[],
    dashboardBaseUrl: string,
    projectId: string,
    botName?: string | null,
  ): Promise<number | null> {
    const dashboardLink = buildDashboardLink(
      dashboardBaseUrl,
      projectId,
      conversationId,
    );
    const last4 = recentMessages.slice(-4);

    const footer = buildCommandFooter(botName);

    const text = [
      `<b>New support request</b>`,
      ``,
      `<b>Visitor:</b> ${escapeHtml(visitorName ?? "Anonymous")}`,
      `<b>Conversation:</b> <code>${conversationId}</code>`,
      ``,
      `<b>Summary:</b>`,
      escapeHtml(summary),
      ``,
      ...(last4.length > 0
        ? [`<b>Recent messages:</b>`, ``, formatMessageHistory(last4), ``]
        : []),
      `<a href="${dashboardLink}">View conversation on dashboard</a>`,
      ``,
      footer,
    ].join("\n");

    const result = await this.sendMessage(botToken, chatId, text);
    return result.message_id ?? null;
  }

  // ─── Notify New Booking ─────────────────────────────────────────────────────

  async notifyNewBooking(
    botToken: string,
    chatId: string,
    booking: {
      visitorName: string;
      visitorEmail: string;
      visitorPhone?: string | null;
      notes?: string | null;
      startTime: Date;
      endTime: Date;
      timezone: string;
    },
    projectName: string,
    dashboardBaseUrl: string,
    projectId: string,
    conversationId?: string | null,
  ): Promise<void> {
    const startFormatted = booking.startTime.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: booking.timezone,
    });
    const endFormatted = booking.endTime.toLocaleString("en-US", {
      timeStyle: "short",
      timeZone: booking.timezone,
    });

    const lines = [
      `<b>New booking received</b>`,
      ``,
      `<b>Project:</b> ${escapeHtml(projectName)}`,
      `<b>Name:</b> ${escapeHtml(booking.visitorName)}`,
      `<b>Email:</b> ${escapeHtml(booking.visitorEmail)}`,
    ];

    if (booking.visitorPhone) {
      lines.push(`<b>Phone:</b> ${escapeHtml(booking.visitorPhone)}`);
    }

    lines.push(
      `<b>Time:</b> ${startFormatted} – ${endFormatted} (${escapeHtml(booking.timezone)})`,
    );

    if (booking.notes) {
      lines.push(`<b>Notes:</b> ${escapeHtml(booking.notes)}`);
    }

    if (conversationId) {
      const dashboardLink = buildDashboardLink(
        dashboardBaseUrl,
        projectId,
        conversationId,
      );
      lines.push(``, `<a href="${dashboardLink}">View conversation</a>`);
    }

    await this.sendMessage(botToken, chatId, lines.join("\n"));
  }

  // ─── Notify New Conversation Message ────────────────────────────────────────

  async notifyNewConversation(
    botToken: string,
    chatId: string,
    conversationId: string,
    visitorName: string | null,
    visitorEmail: string | null,
    firstMessage: string,
    dashboardBaseUrl: string,
    projectId: string,
    botName?: string | null,
  ): Promise<number | null> {
    const dashboardLink = buildDashboardLink(
      dashboardBaseUrl,
      projectId,
      conversationId,
    );

    const footer = buildCommandFooter(botName);

    const lines = [
      `<b>New conversation started</b>`,
      ``,
      `<b>Visitor:</b> ${escapeHtml(visitorName ?? "Anonymous")}`,
      `<b>Conversation:</b> <code>${conversationId}</code>`,
    ];

    if (visitorEmail) {
      lines.push(`<b>Email:</b> ${escapeHtml(visitorEmail)}`);
    }

    lines.push(
      ``,
      `<b>Message:</b>`,
      escapeHtml(
        firstMessage.length > 500
          ? firstMessage.slice(0, 500) + "..."
          : firstMessage,
      ),
      ``,
      `<a href="${dashboardLink}">View conversation on dashboard</a>`,
      ``,
      footer,
    );

    const result = await this.sendMessage(botToken, chatId, lines.join("\n"));
    return result.message_id ?? null;
  }

  // ─── Notify Contact Form with Dashboard Link ───────────────────────────────

  async notifyContactForm(
    botToken: string,
    chatId: string,
    fields: Record<string, string>,
    dashboardBaseUrl: string,
    projectId: string,
  ): Promise<void> {
    const fieldLines = Object.entries(fields)
      .map(([key, val]) => `<b>${escapeHtml(key)}:</b> ${escapeHtml(val)}`)
      .join("\n");

    const projectLink = `${dashboardBaseUrl}/app/projects/${projectId}/contact-submissions`;

    const text = [
      `<b>New contact form submission</b>`,
      ``,
      fieldLines,
      ``,
      `<a href="${projectLink}">View on dashboard</a>`,
    ].join("\n");

    await this.sendMessage(botToken, chatId, text);
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
