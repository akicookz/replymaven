import { fallbackRenderContactTimingMessage } from "../llm/render-contact-timing-message";
import { type ContactAcceptedPayload } from "../types";

// Only reached when the model produced nothing at all (empty stream or a
// failed turn), so there is no generated text to fall back to. Everything the
// visitor sees on the normal path is written by the model.
export function buildContactFallbackMessage(
  timingMessage?: string | null,
): string {
  const timing = timingMessage?.trim() || fallbackRenderContactTimingMessage();
  return `This is with our team now. ${timing}`;
}

export function buildContactFormMessage(
  formData: Record<string, string>,
  visitorName: string | null,
  visitorEmail: string | null,
): string {
  const enrichedData = { ...formData };

  if (visitorName && !extractFormName(enrichedData)) {
    enrichedData["Visitor name"] = visitorName;
  }
  if (visitorEmail && !extractFormEmail(enrichedData)) {
    enrichedData["Visitor email"] = visitorEmail;
  }

  const lines = ["Contact form submission"];
  for (const [key, value] of Object.entries(enrichedData)) {
    const trimmedValue = value.trim();
    if (trimmedValue) lines.push(`${key}: ${trimmedValue}`);
  }
  return lines.join("\n");
}

export function extractFormEmail(
  formData: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(formData)) {
    if (!/email/i.test(key)) continue;
    const trimmedValue = value.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue)) {
      return trimmedValue;
    }
  }
  return null;
}

export function extractFormName(
  formData: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(formData)) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey.includes("company") || !normalizedKey.includes("name")) {
      continue;
    }
    const trimmedValue = value.trim();
    if (trimmedValue) return trimmedValue.slice(0, 100);
  }
  return null;
}

export function buildContactAcceptedPayload(options: {
  conversationId: string;
  visitorMessageId: string;
  conversationStatus: string;
  visitorName: string | null;
  visitorEmail: string | null;
  botName: string | null;
}): ContactAcceptedPayload {
  const fallbackMessage = buildContactFallbackMessage(null);

  return {
    conversationId: options.conversationId,
    visitorMessageId: options.visitorMessageId,
    conversationStatus: options.conversationStatus,
    aiWillRespond: options.conversationStatus !== "agent_replied",
    visitorName: options.visitorName,
    visitorEmail: options.visitorEmail,
    assistantName: options.botName?.trim() || "Our assistant",
    fallbackMessage,
  };
}

export function markContactAiUnavailable(
  payload: ContactAcceptedPayload,
): ContactAcceptedPayload {
  return { ...payload, aiWillRespond: false };
}
