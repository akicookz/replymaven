import { Resend } from "resend";

// ─── Email Design Tokens ──────────────────────────────────────────────────────

const BODY_TEXT = "color: #c7c7cc;";
const MUTED_TEXT = "color: #98989d;";
const ACCENT_COLOR = "#2563eb";
const EMAIL_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

function buildAccentStyles(): {
  heading: string;
  button: string;
} {
  return {
    heading: `color: #f5f5f7; font-family: ${EMAIL_FONT}; font-size: 27px; font-weight: 400; letter-spacing: -0.55px; line-height: 1.18;`,
    button: `display: inline-block; box-sizing: border-box; min-height: 40px; line-height: 38px; background: ${ACCENT_COLOR}; color: #ffffff; padding: 0 18px; border: 1px solid rgba(255,255,255,0.35); border-radius: 10px; box-shadow: inset 0 6px 14px -6px rgba(255,255,255,0.3); text-decoration: none; font-family: ${EMAIL_FONT}; font-size: 14px; font-weight: 500;`,
  };
}

// ─── Shared Email Layout ──────────────────────────────────────────────────────

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin: 0; padding: 40px 16px; background: #0b0c0f; color: #f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #0b0c0f; font-family: ${EMAIL_FONT}; color: #f5f5f7; font-size: 15px; line-height: 1.65;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #16171c; border-radius: 15px;"><tr><td style="padding: 36px 40px 40px;">
<img src="https://replymaven.com/email-logo-mark.png" width="16" height="18" alt="ReplyMaven" style="display: block; width: 16px; height: 18px; margin: 0 0 24px; border: 0;">
${body}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function replySubject(subject: string | null | undefined): string {
  const trimmed = subject?.trim();
  if (!trimmed) return "Re: your message";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function formatRfcMessageId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed}>`;
}

// Derive the text/plain alternative from a rendered HTML email. Multipart
// messages with a matching plain-text part score notably better with spam
// filters than HTML-only mail. Only handles the markup our own templates emit.
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(
      /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => {
        const labelText = label.replace(/<[^>]+>/g, "").trim();
        return labelText && labelText !== href
          ? `${labelText} (${href})`
          : href;
      },
    )
    .replace(/<[^>]+>/g, "");
  return stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Sending domain & platform sender ─────────────────────────────────────────

const EMAIL_DOMAIN = "updates.replymaven.com";

// Absolute origin for leftover relative attachment paths in emails.
// New uploads already store https://replymaven.com/api/uploads/....
const APP_ORIGIN = "https://replymaven.com";

// Platform emails come from a monitored, replyable alias — "noreply" senders
// depress engagement signals and are a weak spam heuristic at mailbox
// providers. Every local part we send from (or historically sent from) is
// reserved so the inbound-mail webhook never treats it as a project slug.
export const PLATFORM_SENDER_LOCAL_PART = "support";
export const RESERVED_INBOUND_LOCAL_PARTS: ReadonlySet<string> = new Set([
  PLATFORM_SENDER_LOCAL_PART,
  "noreply",
]);
const PLATFORM_FROM = `ReplyMaven <${PLATFORM_SENDER_LOCAL_PART}@${EMAIL_DOMAIN}>`;

// ─── Message-ID helpers ───────────────────────────────────────────────────────

const MESSAGE_ID_PATTERN = new RegExp(
  `<msg-([0-9a-f-]{36})@${EMAIL_DOMAIN.replace(/\./g, "\\.")}>`,
  "gi",
);

export function buildEmailMessageId(messageId: string): string {
  return `<msg-${messageId}@${EMAIL_DOMAIN}>`;
}

// Extract a ReplyMaven message id from an `In-Reply-To` or `References` header.
// `In-Reply-To` carries a single id (we take the first match). `References` is
// space-separated and ordered oldest-to-newest, so when reading from References
// we want the *last* match — i.e. the most recent ancestor.
export function parseEmailMessageId(
  header: string | null | undefined,
  options: { source?: "in-reply-to" | "references" } = {},
): string | null {
  if (!header) return null;
  const matches = [...header.matchAll(MESSAGE_ID_PATTERN)];
  if (matches.length === 0) return null;
  const pick = options.source === "references" ? matches.at(-1) : matches[0];
  return pick?.[1] ?? null;
}

function buildVisitorSubjectIdentifier(opts: {
  name?: string | null;
  email?: string | null;
  id?: string | null;
}): string {
  const name = opts.name?.trim();
  const email = opts.email?.trim();
  const id = opts.id?.trim();
  const raw = name || email || (id ? `Visitor ${id.slice(0, 8)}` : "Visitor");
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
}

// ─── OTP Email Template ───────────────────────────────────────────────────────

export function buildOtpEmailHtml(otp: string): string {
  const styles = buildAccentStyles();
  return wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Your verification code</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Enter this code to verify your email address. It expires in 10 minutes.</p>
<p class="email-otp" style="font-size: 34px; font-weight: 500; letter-spacing: 6px; line-height: 1.2; margin: 0 0 26px; color: #ffffff; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;">${escapeHtml(otp)}</p>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
  `);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EmailService {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  // All sends funnel through here: injects the platform sender, derives the
  // text/plain part, and surfaces failures — the Resend SDK reports errors via
  // its return value instead of throwing, so an unchecked send fails silently.
  private async send(email: {
    from?: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
  }): Promise<void> {
    let body: { html?: string; text: string } | { text: string };
    if (email.text !== undefined) {
      body = { text: email.text };
    } else if (email.html !== undefined) {
      body = { html: email.html, text: htmlToText(email.html) };
    } else {
      throw new Error("Email requires HTML or plain text content");
    }

    const { error } = await this.resend.emails.send({
      from: email.from ?? PLATFORM_FROM,
      to: email.to,
      subject: email.subject,
      ...body,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
    });
    if (error) {
      throw new Error(`Resend send failed: ${error.name}: ${error.message}`);
    }
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    await this.send({
      to,
      subject: `${otp} is your ReplyMaven verification code`,
      html: buildOtpEmailHtml(otp),
    });
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const styles = buildAccentStyles();
    await this.send({
      to,
      subject: "Welcome to ReplyMaven",
      html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Welcome to ReplyMaven</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)}, thanks for signing up. You can now create your first project and start building your AI support agent.</p>
<a href="https://replymaven.com/app" class="email-button" style="${styles.button}">Go to Dashboard</a>
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
    const styles = buildAccentStyles();
    await this.send({
      to,
      subject: `${inviterName} invited you to join their ReplyMaven team`,
      html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">You've been invited to ReplyMaven</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">${escapeHtml(inviterName)} (${escapeHtml(inviterEmail)}) has invited you to join their team as ${role === "admin" ? "an administrator" : "a member"}.</p>
<a href="${acceptUrl}" class="email-button" style="${styles.button} margin-top: 8px;">Accept Invitation</a>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.</p>
      `),
    });
  }

  // ─── Escalation Notification (to project owner) ────────────────────────────

  async sendEscalationNotification(details: {
    ownerEmail: string;
    projectName: string;
    projectSlug: string;
    conversationId: string;
    visitorName?: string | null;
    visitorEmail?: string | null;
    visitorId?: string | null;
    summary: string;
    conversationUrl: string;
    accentColor?: string | null;
  }): Promise<void> {
    try {
      const visitor = buildVisitorSubjectIdentifier({
        name: details.visitorName,
        email: details.visitorEmail,
        id: details.visitorId,
      });
      // Sent from the project address, not the platform one: replies to
      // `support@` are dropped as a reserved local part, so answering this
      // notification from an inbox would go nowhere.
      await this.send({
        from: `${details.projectName} <${details.projectSlug}@${EMAIL_DOMAIN}>`,
        replyTo: `${details.projectSlug}+c${details.conversationId}@${EMAIL_DOMAIN}`,
        to: details.ownerEmail,
        subject: `Needs human review - ${visitor}`,
        text: `Conversation needs your review\n\n${details.summary}\n\nOpen conversation: ${details.conversationUrl}\n\nReply to this email to answer. Your reply is added to the conversation and sent to the visitor when we have their address.`,
      });
    } catch (error) {
      console.error("[EmailService] Escalation notification email failed:", error);
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
      const styles = buildAccentStyles();
      await this.send({
        to,
        subject: "You've used 80% of your monthly messages",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Your message usage is at 80%</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used <span style="color: #f5f5f7;">${used}</span> of <span style="color: #f5f5f7;">${max}</span> messages on your <span style="color: #f5f5f7;">${escapeHtml(plan)}</span> plan this billing period.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Once you reach your limit, your chatbot will stop responding to visitors until the next period. Consider upgrading if you expect to exceed your quota.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${styles.button}">View Usage</a>
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
      const styles = buildAccentStyles();
      await this.send({
        to,
        subject: "You've reached your message limit",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">You've reached your message limit</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used all <span style="color: #f5f5f7;">${max}</span> messages on your <span style="color: #f5f5f7;">${escapeHtml(plan)}</span> plan. Your chatbot will not respond to new visitor messages until your next billing period.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Upgrade your plan to get more messages and keep your chatbot online.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${styles.button}">Upgrade Plan</a>
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
      const styles = buildAccentStyles();
      const reasonMessages: Record<
        SubscriptionInactiveReason,
        { subject: string; heading: string; body: string }
      > = {
        payment_failed: {
          subject: "Action Required: Your chatbot is paused",
          heading: "Your chatbot is paused",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Update your payment method to restore service.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${styles.button}">Update payment</a>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          heading: "Your subscription has been canceled",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">If this was a mistake, you can resubscribe anytime.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${styles.button}">View billing</a>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          heading: "Your chatbot is unavailable",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Check your billing settings to restore service.</p>
<a href="https://replymaven.com/app/account/billing" class="email-button" style="${styles.button}">View billing</a>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.send({
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">${msg.heading}</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
    messageId: string;
    agentName: string;
    agentAvatar: string | null;
    messageContent: string;
    imageUrls?: string[];
    dashboardUrl: string;
    accentColor?: string | null;
    inReplyToMessageId?: string | null;
    inReplyToRfcId?: string | null;
    referencesRfcIds?: string[];
    subject?: string | null;
    autoSubmitted?: boolean;
  }): Promise<void> {
    const {
      to,
      projectSlug,
      projectName,
      conversationId,
      messageId,
      messageContent,
      imageUrls = [],
      inReplyToMessageId,
      inReplyToRfcId,
      referencesRfcIds = [],
      subject,
      autoSubmitted,
    } = details;

    // Image-only replies carry a synthetic "Sent an image"/"Sent images"
    // placeholder as content — the attached images below convey it, so the
    // placeholder text is dropped from the email body.
    const isPlaceholderOnly =
      imageUrls.length > 0 &&
      (messageContent === "Sent an image" || messageContent === "Sent images");
    const bodyText = isPlaceholderOnly ? "" : messageContent;

    const imageLinks = imageUrls.map((url) =>
      url.startsWith("/") ? `${APP_ORIGIN}${url}` : url
    );

    const headers: Record<string, string> = {
      "X-Conversation-Id": conversationId,
      "X-Project-Slug": projectSlug,
      "Message-ID": buildEmailMessageId(messageId),
    };
    const inReplyTo = inReplyToRfcId
      ? formatRfcMessageId(inReplyToRfcId)
      : inReplyToMessageId
        ? buildEmailMessageId(inReplyToMessageId)
        : null;
    const references = [
      ...referencesRfcIds.map(formatRfcMessageId),
      ...(inReplyTo && !referencesRfcIds.some((id) =>
        formatRfcMessageId(id) === inReplyTo
      )
        ? [inReplyTo]
        : []),
    ];
    if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
    if (references.length > 0) headers.References = references.join(" ");
    if (autoSubmitted) {
      headers["Auto-Submitted"] = "auto-generated";
    }

    await this.send({
      from: `${projectName} <${projectSlug}@${EMAIL_DOMAIN}>`,
      replyTo: `${projectSlug}+c${conversationId}@${EMAIL_DOMAIN}`,
      to,
      subject: replySubject(subject),
      headers,
      text: [
        bodyText,
        ...imageLinks.map((url) => `Image: ${url}`),
      ].filter(Boolean).join("\n\n"),
    });
  }

  async sendVisitorReplyToAgentEmail(details: {
    to: string;
    projectSlug: string;
    projectName: string;
    conversationId: string;
    messageId: string;
    visitorDisplayName: string;
    messageContent: string;
    dashboardUrl: string;
    accentColor?: string | null;
  }): Promise<void> {
    const {
      to,
      projectSlug,
      projectName,
      conversationId,
      messageId,
      visitorDisplayName,
      messageContent,
      dashboardUrl,
    } = details;

    await this.send({
      from: `${projectName} <${projectSlug}@${EMAIL_DOMAIN}>`,
      replyTo: `${projectSlug}+c${conversationId}@${EMAIL_DOMAIN}`,
      to,
      subject: `Re: ${visitorDisplayName} replied - ${projectName}`,
      headers: {
        "X-Conversation-Id": conversationId,
        "X-Project-Slug": projectSlug,
        "Message-ID": buildEmailMessageId(messageId),
        "Auto-Submitted": "auto-generated",
        "Precedence": "bulk",
      },
      text: `${visitorDisplayName} replied\n\n${messageContent}\n\nView conversation: ${dashboardUrl}\n\nReply to this email to respond. Your reply will be sent to ${visitorDisplayName} and added to the conversation.`,
    });
  }

  async sendSubscriptionRecoveredEmail(
    to: string,
    name: string,
  ): Promise<void> {
    try {
      const styles = buildAccentStyles();
      await this.send({
        to,
        subject: "Your chatbot is back online",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Your chatbot is back online</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
