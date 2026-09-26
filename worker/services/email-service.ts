import { Lexer, Marked, type Token, type Tokens } from "marked";
import { Resend } from "resend";

// ─── Email Design Tokens ──────────────────────────────────────────────────────

const BODY_TEXT = "color: #c7c7cc;";
const MUTED_TEXT = "color: #98989d;";
const ACCENT_COLOR = "#2563eb";
const EMAIL_FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

function buildAccentStyles(): { button: string } {
  return {
    button: `display: inline-block; box-sizing: border-box; min-height: 40px; line-height: 38px; background: ${ACCENT_COLOR}; color: #ffffff; padding: 0 18px; border: 1px solid rgba(255,255,255,0.35); border-radius: 10px; box-shadow: inset 0 6px 14px -6px rgba(255,255,255,0.3); text-decoration: none; font-family: ${EMAIL_FONT}; font-size: 14px; font-weight: 500;`,
  };
}

// ─── Shared Email Layout ──────────────────────────────────────────────────────

function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin: 0; padding: 0; background: #0b0c0f; color: #f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #0b0c0f; font-family: ${EMAIL_FONT}; color: #f5f5f7; font-size: 15px; line-height: 1.65;"><tr><td align="center" style="padding: 32px 20px;">
<table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: 0 auto;"><tr><td align="left">
<img src="https://replymaven.com/email-logo-mark.png" width="16" height="18" alt="ReplyMaven" style="display: block; width: 16px; height: 18px; margin: 0 0 24px; border: 0;">
${body}
<p style="${MUTED_TEXT} font-size: 14px; margin: 24px 0 0;">&mdash; ReplyMaven team</p>
<p style="${MUTED_TEXT} font-size: 12px; line-height: 1.5; margin: 24px 0 0;">You are receiving this email because you are a ReplyMaven user.</p>
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

// Bot replies are markdown; mail clients show it raw. Flatten it before send.
export function markdownToPlainText(markdown: string): string {
  const tokens = Lexer.lex(markdown, { gfm: true });
  return renderBlocks(tokens).replace(/\n{3,}/g, "\n\n").trim();
}

// Same markdown as HTML for the email's HTML part: raw HTML is escaped and
// only http(s) and mailto links become anchors.
const emailMarked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^(?:https?:|mailto:)/i.test(href)) return label;
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    },
    image({ href, text }) {
      if (!/^https?:/i.test(href)) return escapeHtml(text);
      return `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
    },
  },
});

export function markdownToEmailHtml(markdown: string): string {
  return (emailMarked.parse(markdown, { async: false }) as string).trim();
}

export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

// "Hi Dana," unless the message already opens by naming them.
function greetingFor(body: string, name: string | null): string | null {
  if (!name) return "Hi there,";
  const opening = body.split("\n").find((line) => line.trim()) ?? "";
  return opening.toLowerCase().includes(name.toLowerCase()) ? null : `Hi ${name},`;
}

export interface ComposedEmail {
  text: string;
  html: string;
}

// Greeting, markdown body, extra links, and sign-off, as plain text and as
// minimal HTML (no styling, so it reads like a plain email).
export function composeEmail(input: {
  bodyMarkdown: string;
  recipientName: string | null;
  links?: Array<{ label: string; url: string }>;
  signature: string[];
}): ComposedEmail {
  const bodyText = markdownToPlainText(input.bodyMarkdown);
  const greeting = bodyText ? greetingFor(bodyText, input.recipientName) : null;
  const links = input.links ?? [];
  const text = [
    greeting,
    bodyText,
    ...links.map((link) => `${link.label}: ${link.url}`),
    input.signature.join("\n"),
  ].filter(Boolean).join("\n\n");
  const html = [
    greeting ? `<p>${escapeHtml(greeting)}</p>` : "",
    bodyText ? markdownToEmailHtml(input.bodyMarkdown) : "",
    ...links.map((link) =>
      `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`
    ),
    input.signature.length > 0
      ? `<p>${input.signature.map(escapeHtml).join("<br>")}</p>`
      : "",
  ].filter(Boolean).join("\n");
  return { text, html: `<div>${html}</div>` };
}

function renderBlocks(tokens: Token[], indent = ""): string {
  const out: string[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
      case "paragraph":
        out.push(indent + renderInline((token as Tokens.Paragraph).tokens ?? []));
        break;
      case "list": {
        const list = token as Tokens.List;
        out.push(list.items.map((item, index) => {
          const marker = list.ordered ? `${Number(list.start || 1) + index}. ` : "- ";
          const body = renderBlocks(item.tokens, indent + "  ").trimStart();
          return `${indent}${marker}${body}`;
        }).join("\n"));
        break;
      }
      case "blockquote":
        out.push(renderBlocks((token as Tokens.Blockquote).tokens, indent + "> "));
        break;
      case "code":
        out.push((token as Tokens.Code).text.split("\n").map((line) => `${indent}  ${line}`).join("\n"));
        break;
      case "table": {
        const table = token as Tokens.Table;
        const rows = [table.header, ...table.rows].map((row) =>
          indent + row.map((cell) => renderInline(cell.tokens)).join(" | ")
        );
        out.push(rows.join("\n"));
        break;
      }
      case "hr":
      case "space":
        break;
      case "html":
        out.push(indent + htmlToText((token as Tokens.HTML).text));
        break;
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          out.push(indent + renderInline(token.tokens as Token[]));
        } else if ("text" in token && typeof token.text === "string") {
          out.push(indent + token.text);
        }
    }
  }
  return out.join("\n\n");
}

function renderInline(tokens: Token[]): string {
  return tokens.map((token) => {
    switch (token.type) {
      case "link": {
        const link = token as Tokens.Link;
        const label = renderInline(link.tokens);
        const bare = link.href.replace(/^mailto:/i, "");
        return label && label !== link.href && label !== bare
          ? `${label} (${link.href})`
          : bare;
      }
      case "image":
        return (token as Tokens.Image).href;
      case "strong":
      case "em":
      case "del":
        return renderInline((token as Tokens.Strong).tokens);
      case "codespan":
        return (token as Tokens.Codespan).text;
      case "br":
        return "\n";
      case "escape":
      case "text":
        return "tokens" in token && Array.isArray(token.tokens)
          ? renderInline(token.tokens as Token[])
          : (token as Tokens.Text).text;
      default:
        return "raw" in token && typeof token.raw === "string" ? token.raw : "";
    }
  }).join("");
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

// ─── OTP Email Template ───────────────────────────────────────────────────────

export function buildOtpEmailHtml(otp: string): string {
  return wrapEmail(`
<p style="${BODY_TEXT} margin: 0 0 24px;">Enter this code to verify your email address. It expires in 10 minutes.</p>
<p style="font-size: 34px; font-weight: 500; letter-spacing: 6px; line-height: 1.2; margin: 0 0 26px; color: #ffffff; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;">${escapeHtml(otp)}</p>
<p style="${MUTED_TEXT} font-size: 13px; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
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
  }): Promise<{ id: string | null }> {
    let body: { html?: string; text: string } | { text: string };
    if (email.text !== undefined && email.html !== undefined) {
      body = { html: email.html, text: email.text };
    } else if (email.text !== undefined) {
      body = { text: email.text };
    } else if (email.html !== undefined) {
      body = { html: email.html, text: htmlToText(email.html) };
    } else {
      throw new Error("Email requires HTML or plain text content");
    }

    const { data, error } = await this.resend.emails.send({
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
    return { id: data?.id ?? null };
  }

  // Resend rewrites Message-ID on send and only exposes the final value on
  // the retrieved email (the SDK type omits it). One retry covers the small
  // gap before the sent mail is readable.
  async resolveRfcMessageId(id: string | null): Promise<string | null> {
    if (!id) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data } = await this.resend.emails.get(id);
      const messageId = (data as Record<string, unknown> | null)?.message_id;
      if (typeof messageId === "string" && messageId) return messageId;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return null;
  }

  async sendTeammateEmail(input: {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo: string | null;
  }): Promise<{ id: string | null }> {
    // Keeps out-of-office responders from answering Maven.
    const headers: Record<string, string> = {
      "Auto-Submitted": "auto-generated",
    };
    if (input.inReplyTo) {
      const rfc = formatRfcMessageId(input.inReplyTo);
      headers["In-Reply-To"] = rfc;
      headers.References = rfc;
    }
    return this.send({
      from: input.from,
      replyTo: input.replyTo,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
      headers,
    });
  }

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    await this.send({
      to,
      subject: `${otp} is your ReplyMaven verification code`,
      html: buildOtpEmailHtml(otp),
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
<p style="${BODY_TEXT} margin: 0 0 16px;">${escapeHtml(inviterName)} (${escapeHtml(inviterEmail)}) has invited you to join their team as ${role === "admin" ? "an administrator" : "a member"}.</p>
<a href="${acceptUrl}" style="${styles.button} margin-top: 8px;">Accept Invitation</a>
<p style="${MUTED_TEXT} font-size: 13px; margin: 24px 0 0;">This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.</p>
      `),
    });
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
<p style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="${BODY_TEXT} margin: 0 0 16px;">You've used <span style="color: #f5f5f7;">${used}</span> of <span style="color: #f5f5f7;">${max}</span> messages on your <span style="color: #f5f5f7;">${escapeHtml(plan)}</span> plan this billing period.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Once you reach your limit, your chatbot will stop responding to visitors until the next period. Consider upgrading if you expect to exceed your quota.</p>
<a href="https://replymaven.com/app/account/billing" style="${styles.button}">View Usage</a>
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
<p style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
<p style="${BODY_TEXT} margin: 0 0 16px;">You've used all <span style="color: #f5f5f7;">${max}</span> messages on your <span style="color: #f5f5f7;">${escapeHtml(plan)}</span> plan. Your chatbot will not respond to new visitor messages until your next billing period.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Upgrade your plan to get more messages and keep your chatbot online.</p>
<a href="https://replymaven.com/app/account/billing" style="${styles.button}">Upgrade Plan</a>
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
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your recent payment failed and your chatbot has been paused. Visitors will not be able to use it until the issue is resolved.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Update your payment method to restore service.</p>
<a href="https://replymaven.com/app/account/billing" style="${styles.button}">Update payment</a>`,
        },
        canceled: {
          subject: "Your ReplyMaven subscription has been canceled",
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your subscription has been canceled and your chatbot is no longer active. Visitors will see an unavailable message.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">If this was a mistake, you can resubscribe anytime.</p>
<a href="https://replymaven.com/app/account/billing" style="${styles.button}">View billing</a>`,
        },
        other: {
          subject: "Your chatbot is currently unavailable",
          body: `<p style="${BODY_TEXT} margin: 0 0 16px;">Your subscription is inactive and your chatbot is currently unavailable to visitors.</p>
<p style="${BODY_TEXT} margin: 0 0 24px;">Check your billing settings to restore service.</p>
<a href="https://replymaven.com/app/account/billing" style="${styles.button}">View billing</a>`,
        },
      };

      const msg = reasonMessages[reason];

      await this.send({
        to,
        subject: msg.subject,
        html: wrapEmail(`
<p style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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
    messageContent: string;
    imageUrls?: string[];
    inReplyToMessageId?: string | null;
    inReplyToRfcId?: string | null;
    referencesRfcIds?: string[];
    subject?: string | null;
    // Chat conversations have no email thread yet: the first email is not a reply.
    subjectIsReply?: boolean;
    autoSubmitted?: boolean;
    // Who wrote the message (a teammate or the bot) and who receives it.
    authorName?: string | null;
    customerName?: string | null;
  }): Promise<{ id: string | null }> {
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
    const imageLinks = imageUrls.map((url) =>
      url.startsWith("/") ? `${APP_ORIGIN}${url}` : url
    );
    const author = firstName(details.authorName);
    const composed = composeEmail({
      bodyMarkdown: isPlaceholderOnly ? "" : messageContent,
      recipientName: firstName(details.customerName),
      links: imageLinks.map((url, index) => ({
        label: imageLinks.length > 1 ? `Image ${index + 1}` : "Image",
        url,
      })),
      signature: author ? [author, projectName] : [projectName],
    });

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

    return this.send({
      from: `${senderDisplayName(author ? `${author} from ${projectName}` : projectName)} <${projectSlug}@${EMAIL_DOMAIN}>`,
      replyTo: `${projectSlug}+c${conversationId}@${EMAIL_DOMAIN}`,
      to,
      subject: details.subjectIsReply === false && subject?.trim()
        ? subject.trim()
        : replySubject(subject),
      headers,
      text: composed.text,
      html: composed.html,
    });
  }

  async sendSubscriptionRecoveredEmail(
    to: string,
    name: string,
  ): Promise<void> {
    try {
      await this.send({
        to,
        subject: "Your chatbot is back online",
        html: wrapEmail(`
<p style="${BODY_TEXT} margin: 0 0 16px;">Hi ${escapeHtml(name)},</p>
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

// Quoted so a comma or parenthesis in a name cannot break the From header.
function senderDisplayName(name: string): string {
  const clean = name.replace(/["\\\r\n]/g, "").trim();
  return /[^\w .-]/.test(clean) ? `"${clean}"` : clean;
}

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
