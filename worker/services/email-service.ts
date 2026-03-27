import { Resend } from "resend";

// ─── Shared Email Layout ──────────────────────────────────────────────────────

const LINK_STYLE = "color: #18181b; font-weight: 500; text-decoration: underline;";
const BUTTON_STYLE = "display: inline-block; background: #18181b; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;";

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #ffffff;">
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #18181b; font-size: 15px; line-height: 1.6;">
<!--[if mso]><table role="presentation" width="480" align="center" cellpadding="0" cellspacing="0"><tr><td style="padding: 40px 20px;"><![endif]-->
${body}
<p style="color: #a1a1aa; font-size: 13px; margin: 32px 0 0;">— ReplyMaven</p>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</body></html>`;
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
<p style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">Welcome to ReplyMaven</p>
<p style="color: #3f3f46; margin: 0 0 16px;">Hi ${escapeHtml(name)}, thanks for signing up. You can now create your first project and start building your AI support agent.</p>
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
            `<p style="font-size: 13px; color: #a1a1aa; margin: 0 0 2px;">${escapeHtml(key)}</p>
<p style="font-size: 15px; color: #18181b; margin: 0 0 ${i < entries.length - 1 ? "12px" : "0"};">${escapeHtml(String(value))}</p>`,
        )
        .join("");

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject: `New inquiry - ${projectName}`,
        html: wrapEmail(`
<p style="font-size: 18px; font-weight: 600; margin: 0 0 20px;">New Inquiry</p>
<div style="background: #fafafa; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px;">
${fieldsHtml}
</div>
<a href="${dashboardUrl}" style="${BUTTON_STYLE}">View in Dashboard</a>
        `),
      });
    } catch (error) {
      console.error("[EmailService] Inquiry notification email failed:", error);
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
          body: `<p style="color: #3f3f46; margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p style="color: #3f3f46; margin: 0;">Please update your payment method in your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">dashboard</a> to restore service.</p>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p style="color: #3f3f46; margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p style="color: #3f3f46; margin: 0;">If this was a mistake, you can resubscribe anytime from your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">dashboard</a>.</p>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p style="color: #3f3f46; margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p style="color: #3f3f46; margin: 0;">Please check your <a href="https://replymaven.com/app/billing" style="${LINK_STYLE}">billing settings</a> to restore service.</p>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
<p style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="color: #3f3f46; margin: 0;">Your subscription is active again and your chatbot is back online. Visitors can use it as normal.</p>
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
