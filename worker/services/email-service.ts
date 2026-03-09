import { Resend } from "resend";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingEmailDetails {
  visitorName: string;
  visitorEmail: string;
  visitorPhone?: string | null;
  notes?: string | null;
  startTime: Date;
  endTime: Date;
  timezone: string;
  projectName: string;
  ownerEmail?: string;
  ownerTimezone?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class EmailService {
  private resend: Resend;

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.resend.emails.send({
      from: "ReplyMaven <noreply@replymaven.com>",
      to,
      subject: "Welcome to ReplyMaven",
      html: `
        <h1>Welcome, ${name}!</h1>
        <p>Thanks for signing up for ReplyMaven. You can now create your first project and start building your AI support agent.</p>
        <p>Get started by creating a project in your dashboard.</p>
      `,
    });
  }

  // ─── Booking Confirmation (to visitor) ──────────────────────────────────────

  async sendBookingConfirmation(details: BookingEmailDetails): Promise<void> {
    const { visitorName, visitorEmail, startTime, endTime, timezone, projectName } = details;

    const dateStr = formatDateForEmail(startTime, timezone);
    const timeStr = `${formatTimeForEmail(startTime, timezone)} - ${formatTimeForEmail(endTime, timezone)}`;
    const tzAbbr = getTimezoneAbbreviation(startTime, timezone);

    const icsContent = generateICS({
      summary: `Meeting with ${projectName}`,
      startTime,
      endTime,
      description: details.notes ? `Notes: ${details.notes}` : "",
      attendeeEmail: visitorEmail,
      attendeeName: visitorName,
    });

    const icsBase64 = btoa(icsContent);

    await this.resend.emails.send({
      from: `${projectName} <noreply@replymaven.com>`,
      to: visitorEmail,
      subject: `Booking Confirmed - ${dateStr}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="width: 48px; height: 48px; background: #dcfce7; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
              <span style="font-size: 24px;">&#10003;</span>
            </div>
          </div>
          <h1 style="font-size: 20px; font-weight: 600; text-align: center; margin: 0 0 8px;">Booking Confirmed</h1>
          <p style="color: #6b7280; text-align: center; margin: 0 0 24px;">Your meeting with <strong>${projectName}</strong> has been scheduled.</p>
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Date</p>
            <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600;">${dateStr}</p>
            <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Time</p>
            <p style="margin: 0; font-size: 16px; font-weight: 600;">${timeStr} ${tzAbbr}</p>
          </div>
          <p style="color: #6b7280; font-size: 13px; text-align: center;">A calendar invite (.ics) is attached to this email.</p>
        </div>
      `,
      attachments: [
        {
          filename: "booking.ics",
          content: icsBase64,
          contentType: "text/calendar",
        },
      ],
    });
  }

  // ─── Booking Notification (to project owner) ───────────────────────────────

  async sendBookingNotification(details: BookingEmailDetails): Promise<void> {
    if (!details.ownerEmail) return;

    const ownerTz = details.ownerTimezone ?? details.timezone;
    const dateStr = formatDateForEmail(details.startTime, ownerTz);
    const timeStr = `${formatTimeForEmail(details.startTime, ownerTz)} - ${formatTimeForEmail(details.endTime, ownerTz)}`;
    const tzAbbr = getTimezoneAbbreviation(details.startTime, ownerTz);

    const icsContent = generateICS({
      summary: `Meeting with ${details.visitorName}`,
      startTime: details.startTime,
      endTime: details.endTime,
      description: [
        `Visitor: ${details.visitorName}`,
        `Email: ${details.visitorEmail}`,
        details.visitorPhone ? `Phone: ${details.visitorPhone}` : "",
        details.notes ? `Notes: ${details.notes}` : "",
      ]
        .filter(Boolean)
        .join("\\n"),
      attendeeEmail: details.visitorEmail,
      attendeeName: details.visitorName,
    });

    const icsBase64 = btoa(icsContent);

    await this.resend.emails.send({
      from: "ReplyMaven <noreply@replymaven.com>",
      to: details.ownerEmail,
      subject: `New Booking: ${details.visitorName} - ${dateStr}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">New Booking</h1>
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">When</p>
            <p style="margin: 0 0 16px; font-size: 16px; font-weight: 600;">${dateStr} &middot; ${timeStr} ${tzAbbr}</p>
            <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Visitor</p>
            <p style="margin: 0 0 4px; font-size: 16px; font-weight: 600;">${details.visitorName}</p>
            <p style="margin: 0 0 ${details.visitorPhone || details.notes ? "16px" : "0"}; font-size: 14px; color: #6b7280;">${details.visitorEmail}</p>
            ${details.visitorPhone ? `<p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Phone</p><p style="margin: 0 0 ${details.notes ? "16px" : "0"}; font-size: 15px;">${details.visitorPhone}</p>` : ""}
            ${details.notes ? `<p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">Notes</p><p style="margin: 0; font-size: 15px;">${details.notes}</p>` : ""}
          </div>
          <p style="color: #6b7280; font-size: 13px;">A calendar invite (.ics) is attached.</p>
        </div>
      `,
      attachments: [
        {
          filename: "booking.ics",
          content: icsBase64,
          contentType: "text/calendar",
        },
      ],
    });
  }

  // ─── Subscription Status Notifications ────────────────────────────────────────

  async sendSubscriptionInactiveEmail(
    to: string,
    name: string,
    reason: SubscriptionInactiveReason,
  ): Promise<void> {
    const reasonMessages: Record<SubscriptionInactiveReason, { subject: string; body: string }> = {
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
      from: "ReplyMaven <noreply@replymaven.com>",
      to,
      subject: msg.subject,
      html: `
        <h1>Hi ${name},</h1>
        ${msg.body}
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">— The ReplyMaven Team</p>
      `,
    });
  }

  async sendSubscriptionRecoveredEmail(
    to: string,
    name: string,
  ): Promise<void> {
    await this.resend.emails.send({
      from: "ReplyMaven <noreply@replymaven.com>",
      to,
      subject: "Your chatbot is back online",
      html: `
        <h1>Hi ${name},</h1>
        <p>Your subscription is active again and your chatbot is back online. Visitors can use it as normal.</p>
        <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">— The ReplyMaven Team</p>
      `,
    });
  }
}

// ─── ICS Generation ───────────────────────────────────────────────────────────

interface ICSInput {
  summary: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  attendeeEmail?: string;
  attendeeName?: string;
}

function generateICS(input: ICSInput): string {
  const uid = crypto.randomUUID();
  const now = formatICSDate(new Date());
  const start = formatICSDate(input.startTime);
  const end = formatICSDate(input.endTime);

  let ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ReplyMaven//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}@replymaven.com`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICS(input.summary)}`,
  ];

  if (input.description) {
    ics.push(`DESCRIPTION:${escapeICS(input.description)}`);
  }

  if (input.attendeeEmail) {
    const cn = input.attendeeName
      ? `;CN=${escapeICS(input.attendeeName)}`
      : "";
    ics.push(`ATTENDEE${cn}:mailto:${input.attendeeEmail}`);
  }

  ics.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return ics.join("\r\n");
}

function formatICSDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeICS(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// ─── Date Formatting Helpers ──────────────────────────────────────────────────

function formatDateForEmail(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimeForEmail(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function getTimezoneAbbreviation(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

// ─── Subscription Status Types ────────────────────────────────────────────────

export type SubscriptionInactiveReason =
  | "payment_failed"
  | "canceled"
  | "other";
