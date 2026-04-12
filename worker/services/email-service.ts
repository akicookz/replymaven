import { Resend } from "resend";

// ─── Email Design Tokens ──────────────────────────────────────────────────────

const BODY_TEXT = "color: #5c4a28;";
const MUTED_TEXT = "color: #8b744b;";
const HEADING_STYLE = "color: #2a1100; font-size: 18px; font-weight: 600;";
const LINK_STYLE =
  "color:rgb(42, 17, 0); font-weight: 500; text-decoration: underline;";
const BUTTON_STYLE =
  "display: inline-block; background: rgb(42, 17, 0); color: #ffffff; padding: 12px 24px; border: 1px solid rgb(42, 17, 0); border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;";
const CARD_STYLE =
  "background: #fff2c7; border-radius: 18px; padding: 20px 24px;";

// ─── Shared Email Layout ──────────────────────────────────────────────────────

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  body, .email-body { background: #050200 !important; }
  .email-shell { background: #0b0600 !important; color: #f0f0f5 !important; }
  .email-heading, .email-strong, .email-value { color: #f0f0f5 !important; }
  .email-body-text { color: #c8c8d2 !important; }
  .email-muted { color: #8a8a96 !important; }
  .email-card { background: #0c0c10 !important; }
  .email-link, .email-otp { color: #f3c67b !important; }
  .email-button { background: #6b3710 !important; border-color: #8b4e18 !important; color: #ffffff !important; }
}
body[data-ogsc],
body[data-ogsb] { background: #050200 !important; }
[data-ogsc] .email-body,
[data-ogsb] .email-body { background: #050200 !important; }
[data-ogsc] .email-shell,
[data-ogsb] .email-shell { background: #0b0600 !important; color: #f0f0f5 !important; }
[data-ogsc] .email-heading,
[data-ogsb] .email-heading,
[data-ogsc] .email-strong,
[data-ogsb] .email-strong,
[data-ogsc] .email-value,
[data-ogsb] .email-value { color: #f0f0f5 !important; }
[data-ogsc] .email-body-text,
[data-ogsb] .email-body-text { color: #c8c8d2 !important; }
[data-ogsc] .email-muted,
[data-ogsb] .email-muted { color: #8a8a96 !important; }
[data-ogsc] .email-card,
[data-ogsb] .email-card { background: #0c0c10 !important; }
[data-ogsc] .email-link,
[data-ogsb] .email-link,
[data-ogsc] .email-otp,
[data-ogsb] .email-otp { color: #f3c67b !important; }
[data-ogsc] .email-button,
[data-ogsb] .email-button { background: #6b3710 !important; border-color: #8b4e18 !important; color: #ffffff !important; }
</style></head>
<body class="email-body" style="margin: 0; padding: 24px 16px; background:rgb(232, 230, 219);">
<div class="email-shell" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 48px 24px; background: #fff9e8; color: #2a1100; font-size: 15px; line-height: 1.6; border-radius: 24px;">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0"><tr><td style="padding: 48px 24px; background: #fff9e8; border-radius: 24px;"><![endif]-->
${body}
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 40px 0 0;">&mdash; ReplyMaven Team</p>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</body></html>`;
}

// ─── OTP Email Template ───────────────────────────────────────────────────────

export function buildOtpEmailHtml(otp: string): string {
  return wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Your verification code</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Enter this code to verify your email address. It expires in 10 minutes.</p>
<div class="email-card" style="${CARD_STYLE} text-align: center; margin: 0 0 24px;">
  <p class="email-otp" style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 0; color: rgb(42, 17, 0); font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">${escapeHtml(otp)}</p>
</div>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
  `);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EmailService {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.resend.emails.send({
      from: "ReplyMaven <noreply@updates.replymaven.com>",
      to,
      subject: "Welcome to ReplyMaven",
      html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Welcome to ReplyMaven</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)}, thanks for signing up. You can now create your first project and start building your AI support agent.</p>
<a href="https://replymaven.com/app" class="email-button" style="${BUTTON_STYLE}">Go to Dashboard</a>
      `),
    });
  }

  async sendTeamInviteEmail(
    to: string,
    inviterName: string,
    inviterEmail: string,
    role: string,
    acceptUrl: string,
  ): Promise<void> {
    const result = await this.resend.emails.send({
      from: "ReplyMaven <noreply@updates.replymaven.com>",
      to,
      subject: `${inviterName} invited you to join their ReplyMaven team`,
      html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">You've been invited to ReplyMaven</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">${escapeHtml(inviterName)} (${escapeHtml(inviterEmail)}) has invited you to join their team as ${role === "admin" ? "an administrator" : "a member"}.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Click below to accept the invitation and get started:</p>
<a href="${acceptUrl}" class="email-button" style="${BUTTON_STYLE}">Accept Invitation</a>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.</p>
      `),
    });
    console.log("Team invite email sent:", result);
  }

  // ─── Inquiry Notification (to project owner) ────────────────────────────────

  async sendInquiryNotification(details: {
    ownerEmail: string;
    projectName: string;
    formData: Record<string, string>;
    dashboardUrl: string;
    isUpdate?: boolean;
  }): Promise<void> {
    try {
      const { ownerEmail, projectName, formData, dashboardUrl, isUpdate } =
        details;

      const entries = Object.entries(formData);
      const fieldsHtml = entries
        .map(
          ([key, value], i) =>
            `<p class="email-muted" style="font-size: 13px; ${MUTED_TEXT} margin: 0 0 2px;">${escapeHtml(key)}</p>
<p class="email-value" style="font-size: 15px; color: #2a1100; margin: 0 0 ${i < entries.length - 1 ? "12px" : "0"};">${escapeHtml(String(value))}</p>`,
        )
        .join("");

      const subject = isUpdate
        ? `Inquiry updated - ${projectName}`
        : `New inquiry - ${projectName}`;
      const heading = isUpdate ? "Inquiry Updated" : "New Inquiry";

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject,
        html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 20px;">${heading}</p>
<div class="email-card" style="${CARD_STYLE} margin: 0 0 24px;">
${fieldsHtml}
</div>
<a href="${dashboardUrl}" class="email-button" style="${BUTTON_STYLE}">View in Dashboard</a>
        `),
      });
    } catch (error) {
      console.error("[EmailService] Inquiry notification email failed:", error);
    }
  }

  // ─── Usage Alert Notifications ──────────────────────────────────────────────

  async sendUsageWarningEmail(
    to: string,
    name: string,
    plan: string,
    used: number,
    max: number,
  ): Promise<void> {
    try {
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "You've used 80% of your monthly messages",
        html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used <strong class="email-strong" style="color: #2a1100;">${used}</strong> of <strong class="email-strong" style="color: #2a1100;">${max}</strong> messages on your <strong class="email-strong" style="color: #2a1100;">${escapeHtml(plan)}</strong> plan this billing period.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Once you reach your limit, your chatbot will stop responding to visitors until the next period. Consider upgrading if you expect to exceed your quota.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${BUTTON_STYLE}">View Usage</a>
        `),
      });
    } catch (error) {
      console.error("[EmailService] Usage warning email failed:", error);
    }
  }

  async sendUsageLimitReachedEmail(
    to: string,
    name: string,
    plan: string,
    max: number,
  ): Promise<void> {
    try {
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "You've reached your message limit",
        html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used all <strong class="email-strong" style="color: #2a1100;">${max}</strong> messages on your <strong class="email-strong" style="color: #2a1100;">${escapeHtml(plan)}</strong> plan. Your chatbot will not respond to new visitor messages until your next billing period.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Upgrade your plan to get more messages and keep your chatbot online.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${BUTTON_STYLE}">Upgrade Plan</a>
        `),
      });
    } catch (error) {
      console.error("[EmailService] Usage limit reached email failed:", error);
    }
  }

  // ─── Subscription Status Notifications ────────────────────────────────────────

  async sendSubscriptionInactiveEmail(
    to: string,
    name: string,
    reason: SubscriptionInactiveReason,
  ): Promise<void> {
    try {
      const reasonMessages: Record<
        SubscriptionInactiveReason,
        { subject: string; body: string }
      > = {
        payment_failed: {
          subject: "Action Required: Your chatbot is paused",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">Please update your payment method in your <a href="https://replymaven.com/app/billing" class="email-link" style="${LINK_STYLE}">dashboard</a> to restore service.</p>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">If this was a mistake, you can resubscribe anytime from your <a href="https://replymaven.com/app/billing" class="email-link" style="${LINK_STYLE}">dashboard</a>.</p>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">Please check your <a href="https://replymaven.com/app/billing" class="email-link" style="${LINK_STYLE}">billing settings</a> to restore service.</p>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
${msg.body}
        `),
      });
    } catch (error) {
      console.error(
        "[EmailService] Subscription inactive email failed:",
        error,
      );
    }
  }

  async sendAgentMessageEmail(details: {
    to: string;
    projectSlug: string;
    projectName: string;
    conversationId: string;
    agentName: string;
    agentAvatar: string | null;
    messageContent: string;
    dashboardUrl: string;
  }): Promise<void> {
    const {
      to,
      projectSlug,
      projectName,
      conversationId,
      agentName,
      messageContent,
      dashboardUrl,
    } = details;

    const lines = escapeHtml(messageContent)
      .split("\n")
      .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin: 0 0 4px;">${line}</p>`))
      .join("");

    await this.resend.emails.send({
      from: `${projectName} <${projectSlug}@updates.replymaven.com>`,
      replyTo: `${projectSlug}@updates.replymaven.com`,
      to,
      subject: `New reply from ${escapeHtml(agentName)} - ${projectName}`,
      headers: {
        "X-Conversation-Id": conversationId,
        "X-Project-Slug": projectSlug,
      },
      html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 20px;">${escapeHtml(agentName)} replied</p>
<div class="email-card" style="${CARD_STYLE} margin: 0 0 24px;">
  <div style="font-size: 15px; ${BODY_TEXT} line-height: 1.6;">${lines}</div>
</div>
<a href="${dashboardUrl}" class="email-button" style="${BUTTON_STYLE}">View Conversation</a>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">You can reply to this email to continue the conversation.</p>
      `),
    });
  }

  async sendSubscriptionRecoveredEmail(
    to: string,
    name: string,
  ): Promise<void> {
    try {
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "Your chatbot is back online",
        html: wrapEmail(`
<p class="email-heading" style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">Your subscription is active again and your chatbot is back online. Visitors can use it as normal.</p>
        `),
      });
    } catch (error) {
      console.error(
        "[EmailService] Subscription recovered email failed:",
        error,
      );
    }
  }
}

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Subscription Status Types ────────────────────────────────────────────────

export type SubscriptionInactiveReason =
  | "payment_failed"
  | "canceled"
  | "other";
