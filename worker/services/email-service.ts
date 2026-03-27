import { Resend } from "resend";

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
      html: `
        <h1>Welcome, ${name}!</h1>
        <p>Thanks for signing up for ReplyMaven. You can now create your first project and start building your AI support agent.</p>
        <p>Get started by creating a project in your dashboard.</p>
      `,
    });
  }

  // ─── Handoff / Agent Request Notification (to project owner) ─────────────────

  async sendHandoffNotification(details: {
    ownerEmail: string;
    projectName: string;
    visitorName: string | null;
    visitorMessage: string;
    dashboardUrl: string;
  }): Promise<void> {
    try {
      const {
        ownerEmail,
        projectName,
        visitorName,
        visitorMessage,
        dashboardUrl,
      } = details;
      const displayName = visitorName ?? "A visitor";

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject: `Agent requested: ${displayName} needs help`,
        html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 8px;">Agent Requested</h1>
          <p style="color: #6b7280; margin: 0 0 24px;">${displayName} needs help from a human agent on <strong>${projectName}</strong>.</p>
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Latest message</p>
            <p style="margin: 0; font-size: 15px;">${escapeHtml(visitorMessage)}</p>
          </div>
          <a href="${dashboardUrl}" style="display: inline-block; background: #18181b; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">View Conversation</a>
        </div>
      `,
      });
    } catch (error) {
      console.error("[EmailService] Handoff notification email failed:", error);
    }
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

      const fieldsHtml = Object.entries(formData)
        .map(
          ([key, value]) =>
            `<p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">${escapeHtml(key)}</p>
           <p style="margin: 0 0 16px; font-size: 15px;">${escapeHtml(String(value))}</p>`,
        )
        .join("");

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject: `New inquiry submission - ${projectName}`,
        html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">New Inquiry Submission</h1>
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            ${fieldsHtml}
          </div>
          <a href="${dashboardUrl}" style="display: inline-block; background: #18181b; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500;">View in Dashboard</a>
        </div>
        `,
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
          body: `<p>Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
               <p>Please update your payment method in your <a href="https://replymaven.com/app/billing">dashboard</a> to restore service.</p>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p>Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
               <p>If this was a mistake, you can resubscribe anytime from your <a href="https://replymaven.com/app/billing">dashboard</a>.</p>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p>Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
               <p>Please check your <a href="https://replymaven.com/app/billing">billing settings</a> to restore service.</p>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: msg.subject,
        html: `
        <h1>Hi ${name},</h1>
        ${msg.body}
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">— The ReplyMaven Team</p>
      `,
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
        html: `
        <h1>Hi ${name},</h1>
        <p>Your subscription is active again and your chatbot is back online. Visitors can use it as normal.</p>
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">— The ReplyMaven Team</p>
      `,
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
