export type DeliveryStatus = "sent" | "delivered" | "seen";
export type EmailAction = "hidden" | "send" | "sent";

export interface MessageStatusInput {
  role: "visitor" | "bot" | "agent" | "system";
  deliveredAt?: string | null;
  readAt?: string | null;
  emailedAt?: string | null;
}

export interface EmailActionInput {
  role: MessageStatusInput["role"];
  emailedAt?: string | null;
  visitorEmail?: string | null;
  readOnly?: boolean;
  optimistic?: boolean;
}

export interface MessageStatusView {
  status: DeliveryStatus;
  label: "Sent" | "Delivered" | "Seen";
  emailed: boolean;
}

const LABELS: Record<DeliveryStatus, MessageStatusView["label"]> = {
  sent: "Sent",
  delivered: "Delivered",
  seen: "Seen",
};

// Receipts only apply to outbound (agent/bot) messages. Returns null for
// inbound visitor messages and centred system rows.
export function deriveMessageStatus(
  m: MessageStatusInput,
): MessageStatusView | null {
  if (m.role !== "agent" && m.role !== "bot") return null;
  const status: DeliveryStatus = m.readAt
    ? "seen"
    : m.deliveredAt
      ? "delivered"
      : "sent";
  return { status, label: LABELS[status], emailed: Boolean(m.emailedAt) };
}

// Per-message email control lives next to the receipt. Already-emailed rows
// stay labelled even in archived threads; the send action only appears when
// the visitor has an address and the message is a real outbound row.
export function deriveEmailAction(input: EmailActionInput): EmailAction {
  if (input.role !== "agent" && input.role !== "bot") return "hidden";
  if (input.emailedAt) return "sent";
  if (!input.visitorEmail) return "hidden";
  if (input.readOnly) return "hidden";
  if (input.optimistic) return "hidden";
  return "send";
}
