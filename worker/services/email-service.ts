import { Resend } from "resend";

// ─── Dark-Mode Email Design Tokens ────────────────────────────────────────────

const BODY_TEXT = "color: #c8c8d2;";
const MUTED_TEXT = "color: #8a8a96;";
const HEADING_STYLE =
  "color: #f0f0f5; font-size: 18px; font-weight: 600;";
const LINK_STYLE =
  "color: #f97316; font-weight: 500; text-decoration: underline;";
const BUTTON_STYLE =
  "display: inline-block; background: #f97316; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;";
const CARD_STYLE =
  "background: #0c0c10; border-radius: 12px; padding: 20px 24px;";

// ─── Shared Email Layout ──────────────────────────────────────────────────────

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #0b0600;">
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 48px 24px; color: #f0f0f5; font-size: 15px; line-height: 1.6;">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0"><tr><td style="padding: 48px 24px;"><![endif]-->
${body}
<p style="${MUTED_TEXT} font-size: 13px; margin: 40px 0 0;">&mdash; ReplyMaven</p>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</body></html>`;
}

// ─── OTP Email Template ───────────────────────────────────────────────────────

export function buildOtpEmailHtml(otp: string): string {
  return wrapEmail(`
<p style="${HEADING_STYLE} margin: 0 0 16px;">Your verification code</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Enter this code to verify your email address. It expires in 10 minutes.</p>
<div style="${CARD_STYLE} text-align: center; margin: 0 0 24px;">
  <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 0; color: #f97316; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">${escapeHtml(otp)}</p>
</div>
<p style="${MUTED_TEXT} font-size: 13px; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
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
<p style="${HEADING_STYLE} margin: 0 0 16px;">Welcome to ReplyMaven</p>
<p style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)}, thanks for signing up. You can now create your first project and start building your AI support agent.</p>
<a href="https://replymaven.com/app" style="${BUTTON_STYLE}">Go to Dashboard</a>
      `),
    });
  }

  // ─── Inquiry Notification (to project owner) ────────────────────────────────

  async sendInquiryNotification(details: {
    ownerEmail: string;
    projectName: string;
    formData: Record<string, string>;
    dashboardUrl: string;
  }): Promise<void> {
    try {
      const { ownerEmail, projectName, formData, dashboardUrl } = details;

      const entries = Object.entries(formData);
      const fieldsHtml = entries
        .map(
          ([key, value], i) =>
            `<p style="font-size: 13px; ${MUTED_TEXT} margin: 0 0 2px;">${escapeHtml(key)}</p>
<p style="font-size: 15px; color: #f0f0f5; margin: 0 0 ${i < entries.length - 1 ? "12px" : "0"};">${escapeHtml(String(value))}</p>`,
        )
        .join("");

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject: `New inquiry - ${projectName}`,
        html: wrapEmail(`
<p style="${HEADING_STYLE} margin: 0 0 20px;">New Inquiry</p>
<div style="${CARD_STYLE} margin: 0 0 24px;">
${fieldsHtml}
</div>
<a href="${dashboardUrl}" style="${BUTTON_STYLE}">View in Dashboard</a>
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
<p style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="${BODY_TEXT} margin: 0 0 16px;">You've used <strong style="color: #f0f0f5;">${used}</strong> of <strong style="color: #f0f0f5;">${max}</strong> messages on your <strong style="color: #f0f0f5;">${escapeHtml(plan)}</strong> plan this billing period.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Once you reach your limit, your chatbot will stop responding to visitors until the next period. Consider upgrading if you expect to exceed your quota.</p>
<a href="https://replymaven.com/app/account/billing" style="${BUTTON_STYLE}">View Usage</a>
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
<p style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="${BODY_TEXT} margin: 0 0 16px;">You've used all <strong style="color: #f0f0f5;">${max}</strong> messages on your <strong style="color: #f0f0f5;">${escapeHtml(plan)}</strong> plan. Your chatbot will not respond to new visitor messages until your next billing period.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Upgrade your plan to get more messages and keep your chatbot online.</p>
<a href="https://replymaven.com/app/account/billing" style="${BUTTON_STYLE}">Upgrade Plan</a>
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
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p style="${BODY_TEXT} margin: 0;">Please update your payment method in your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">dashboard</a> to restore service.</p>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p style="${BODY_TEXT} margin: 0;">If this was a mistake, you can resubscribe anytime from your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">dashboard</a>.</p>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p style="${BODY_TEXT} margin: 0;">Please check your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">billing settings</a> to restore service.</p>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
<p style="${HEADING_STYLE} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="${BODY_TEXT} margin: 0;">Your subscription is active again and your chatbot is back online. Visitors can use it as normal.</p>
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
