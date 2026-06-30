export type DeliveryStatus = "sent" | "delivered" | "seen";

export interface MessageStatusInput {
  role: "visitor" | "bot" | "agent" | "system";
  deliveredAt?: string | null;
  readAt?: string | null;
  emailedAt?: string | null;
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
