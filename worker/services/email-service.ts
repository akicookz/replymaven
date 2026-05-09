import { Resend } from "resend";

// ─── Email Design Tokens ──────────────────────────────────────────────────────

const BODY_TEXT = "color: #5c4a28;";
const MUTED_TEXT = "color: #8b744b;";
const CARD_STYLE =
  "background: #fff2c7; border-radius: 18px; padding: 20px 24px;";

const DEFAULT_ACCENT = "rgb(42, 17, 0)";
const DEFAULT_ACCENT_DARK = "#6b3710";
const DEFAULT_ACCENT_DARK_LINK = "#f3c67b";

interface AccentTheme {
  light: string;
  lightForeground: string;
  dark: string;
  darkBorder: string;
  darkLink: string;
}

function isValidHex(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function getReadableForeground(color: string): string {
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#1a1a1a" : "#ffffff";
}

function resolveAccent(accentColor?: string | null): AccentTheme {
  if (!isValidHex(accentColor)) {
    return {
      light: DEFAULT_ACCENT,
      lightForeground: "#ffffff",
      dark: DEFAULT_ACCENT_DARK,
      darkBorder: "#8b4e18",
      darkLink: DEFAULT_ACCENT_DARK_LINK,
    };
  }
  const accent = accentColor.trim();
  return {
    light: accent,
    lightForeground: getReadableForeground(accent),
    dark: accent,
    darkBorder: accent,
    darkLink: accent,
  };
}

function buildAccentStyles(accentColor?: string | null): {
  heading: string;
  link: string;
  button: string;
} {
  const theme = resolveAccent(accentColor);
  return {
    heading: `color: ${theme.light}; font-size: 18px; font-weight: 600;`,
    link: `color: ${theme.light}; font-weight: 500; text-decoration: underline;`,
    button: `display: inline-block; background: ${theme.light}; color: ${theme.lightForeground}; padding: 12px 24px; border: 1px solid ${theme.light}; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;`,
  };
}

// ─── Shared Email Layout ──────────────────────────────────────────────────────

function wrapEmail(body: string, accentColor?: string | null): string {
  const theme = resolveAccent(accentColor);
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
  .email-link, .email-otp { color: ${theme.darkLink} !important; }
  .email-button { background: ${theme.dark} !important; border-color: ${theme.darkBorder} !important; color: ${theme.lightForeground} !important; }
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
[data-ogsb] .email-otp { color: ${theme.darkLink} !important; }
[data-ogsc] .email-button,
[data-ogsb] .email-button { background: ${theme.dark} !important; border-color: ${theme.darkBorder} !important; color: ${theme.lightForeground} !important; }
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

// ─── Message-ID helpers ───────────────────────────────────────────────────────

const MESSAGE_ID_DOMAIN = "updates.replymaven.com";
const MESSAGE_ID_PATTERN = new RegExp(
  `<msg-([0-9a-f-]{36})@${MESSAGE_ID_DOMAIN.replace(/\./g, "\\.")}>`,
  "gi",
);

export function buildEmailMessageId(messageId: string): string {
  return `<msg-${messageId}@${MESSAGE_ID_DOMAIN}>`;
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
    const styles = buildAccentStyles();
    await this.resend.emails.send({
      from: "ReplyMaven <noreply@updates.replymaven.com>",
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
    const result = await this.resend.emails.send({
      from: "ReplyMaven <noreply@updates.replymaven.com>",
      to,
      subject: `${inviterName} invited you to join their ReplyMaven team`,
      html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">You've been invited to ReplyMaven</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">${escapeHtml(inviterName)} (${escapeHtml(inviterEmail)}) has invited you to join their team as ${role === "admin" ? "an administrator" : "a member"}.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 24px;">Click below to accept the invitation and get started:</p>
<a href="${acceptUrl}" class="email-button" style="${styles.button}">Accept Invitation</a>
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
    actionLabel?: string | null;
    visitorName?: string | null;
    visitorEmail?: string | null;
    visitorId?: string | null;
    accentColor?: string | null;
  }): Promise<void> {
    try {
      const {
        ownerEmail,
        projectName,
        formData,
        dashboardUrl,
        isUpdate,
        actionLabel,
        visitorName,
        visitorEmail,
        visitorId,
        accentColor,
      } = details;

      const entries = Object.entries(formData);
      const fieldsHtml = entries
        .map(
          ([key, value], i) =>
            `<p class="email-muted" style="font-size: 13px; ${MUTED_TEXT} margin: 0 0 2px;">${escapeHtml(key)}</p>
<p class="email-value" style="font-size: 15px; color: #2a1100; margin: 0 0 ${i < entries.length - 1 ? "12px" : "0"};">${escapeHtml(String(value))}</p>`,
        )
        .join("");

      const rawLabel = actionLabel?.trim() || "New inquiry";
      const labelText =
        rawLabel.length > 40 ? `${rawLabel.slice(0, 37)}...` : rawLabel;
      const visitor = buildVisitorSubjectIdentifier({
        name: visitorName,
        email: visitorEmail,
        id: visitorId,
      });
      const subject = isUpdate
        ? `Re: ${labelText} - ${visitor}`
        : `${labelText} - ${visitor}`;
      const heading = isUpdate ? "Inquiry Updated" : labelText;
      const styles = buildAccentStyles(accentColor);

      await this.resend.emails.send({
        from: `${projectName} <noreply@updates.replymaven.com>`,
        to: ownerEmail,
        subject,
        html: wrapEmail(
          `
<p class="email-heading" style="${styles.heading} margin: 0 0 20px;">${escapeHtml(heading)}</p>
<div class="email-card" style="${CARD_STYLE} margin: 0 0 24px;">
${fieldsHtml}
</div>
<a href="${dashboardUrl}" class="email-button" style="${styles.button}">View in Dashboard</a>
        `,
          accentColor,
        ),
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
      const styles = buildAccentStyles();
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "You've used 80% of your monthly messages",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used <strong class="email-strong" style="color: #2a1100;">${used}</strong> of <strong class="email-strong" style="color: #2a1100;">${max}</strong> messages on your <strong class="email-strong" style="color: #2a1100;">${escapeHtml(plan)}</strong> plan this billing period.</p>
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
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "You've reached your message limit",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">You've used all <strong class="email-strong" style="color: #2a1100;">${max}</strong> messages on your <strong class="email-strong" style="color: #2a1100;">${escapeHtml(plan)}</strong> plan. Your chatbot will not respond to new visitor messages until your next billing period.</p>
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
        { subject: string; body: string }
      > = {
        payment_failed: {
          subject: "Action Required: Your chatbot is paused",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">Please update your payment method in your <a href="https://replymaven.com/app/billing" class="email-link" style="${styles.link}">dashboard</a> to restore service.</p>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">If this was a mistake, you can resubscribe anytime from your <a href="https://replymaven.com/app/billing" class="email-link" style="${styles.link}">dashboard</a>.</p>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p class="email-body-text" style="${BODY_TEXT} margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p class="email-body-text" style="${BODY_TEXT} margin: 0;">Please check your <a href="https://replymaven.com/app/billing" class="email-link" style="${styles.link}">billing settings</a> to restore service.</p>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
    dashboardUrl: string;
    accentColor?: string | null;
    inReplyToMessageId?: string | null;
    autoSubmitted?: boolean;
  }): Promise<void> {
    const {
      to,
      projectSlug,
      projectName,
      conversationId,
      messageId,
      agentName,
      messageContent,
      dashboardUrl,
      accentColor,
      inReplyToMessageId,
      autoSubmitted,
    } = details;

    const lines = escapeHtml(messageContent)
      .split("\n")
      .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin: 0 0 4px;">${line}</p>`))
      .join("");

    const styles = buildAccentStyles(accentColor);
    const headers: Record<string, string> = {
      "X-Conversation-Id": conversationId,
      "X-Project-Slug": projectSlug,
      "Message-ID": buildEmailMessageId(messageId),
    };
    if (inReplyToMessageId) {
      const ref = buildEmailMessageId(inReplyToMessageId);
      headers["In-Reply-To"] = ref;
      headers["References"] = ref;
    }
    if (autoSubmitted) {
      headers["Auto-Submitted"] = "auto-generated";
      headers["Precedence"] = "bulk";
    }

    await this.resend.emails.send({
      from: `${projectName} <${projectSlug}@updates.replymaven.com>`,
      replyTo: `${projectSlug}@updates.replymaven.com`,
      to,
      subject: `New reply from ${agentName} - ${projectName}`,
      headers,
      html: wrapEmail(
        `
<p class="email-heading" style="${styles.heading} margin: 0 0 20px;">${escapeHtml(agentName)} replied</p>
<div class="email-card" style="${CARD_STYLE} margin: 0 0 24px;">
  <div style="font-size: 15px; ${BODY_TEXT} line-height: 1.6;">${lines}</div>
</div>
<a href="${dashboardUrl}" class="email-button" style="${styles.button}">View Conversation</a>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">You can reply to this email to continue the conversation.</p>
      `,
        accentColor,
      ),
    });
  }

  async sendVisitorReplyToAgentEmail(details: {
    to: string;
    projectSlug: string;
    projectName: string;
    conversationId: string;
    messageId: string;
    inReplyToMessageId: string;
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
      inReplyToMessageId,
      visitorDisplayName,
      messageContent,
      dashboardUrl,
      accentColor,
    } = details;

    const lines = escapeHtml(messageContent)
      .split("\n")
      .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin: 0 0 4px;">${line}</p>`))
      .join("");

    const styles = buildAccentStyles(accentColor);
    const ref = buildEmailMessageId(inReplyToMessageId);

    await this.resend.emails.send({
      from: `${projectName} <${projectSlug}@updates.replymaven.com>`,
      replyTo: `${projectSlug}@updates.replymaven.com`,
      to,
      subject: `Re: ${visitorDisplayName} replied - ${projectName}`,
      headers: {
        "X-Conversation-Id": conversationId,
        "X-Project-Slug": projectSlug,
        "Message-ID": buildEmailMessageId(messageId),
        "In-Reply-To": ref,
        "References": ref,
        "Auto-Submitted": "auto-generated",
        "Precedence": "bulk",
      },
      html: wrapEmail(
        `
<p class="email-heading" style="${styles.heading} margin: 0 0 20px;">${escapeHtml(visitorDisplayName)} replied</p>
<div class="email-card" style="${CARD_STYLE} margin: 0 0 24px;">
  <div style="font-size: 15px; ${BODY_TEXT} line-height: 1.6;">${lines}</div>
</div>
<a href="${dashboardUrl}" class="email-button" style="${styles.button}">View Conversation</a>
<p class="email-muted" style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">Reply to this email to respond &mdash; your reply will be sent to ${escapeHtml(visitorDisplayName)} and added to the conversation.</p>
      `,
        accentColor,
      ),
    });
  }

  async sendSubscriptionRecoveredEmail(
    to: string,
    name: string,
  ): Promise<void> {
    try {
      const styles = buildAccentStyles();
      await this.resend.emails.send({
        from: "ReplyMaven <noreply@updates.replymaven.com>",
        to,
        subject: "Your chatbot is back online",
        html: wrapEmail(`
<p class="email-heading" style="${styles.heading} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
