import { type SupportIntent } from "../types";

interface FollowUpOptions {
  userMessage: string;
  intent?: SupportIntent | null;
  explicitHumanRequest?: boolean;
}

function isPricingLikeRequest(options: FollowUpOptions): boolean {
  return (
    options.intent === "policy" ||
    /\b(price|pricing|plan|plans|billing|invoice|refund|subscription|trial|discount|coupon|promo|promotion|cost)\b/i.test(
      options.userMessage,
    )
  );
}

function isPolicyLikeRequest(options: FollowUpOptions): boolean {
  return (
    options.intent === "policy" ||
    /\b(policy|terms|security|compliance|sla|refund|invoice|subscription|billing|pricing|plan)\b/i.test(
      options.userMessage,
    )
  );
}

export function buildIntentAwareFollowUpQuestion(
  options: FollowUpOptions,
): string {
  if (options.explicitHumanRequest || options.intent === "handoff") {
    return "Could you tell me briefly what you need help with so I can forward it cleanly?";
  }

  if (options.intent === "troubleshoot" || options.intent === "clarify") {
    return "Could you share the exact feature, page, step, or error you're seeing?";
  }

  if (isPricingLikeRequest(options)) {
    return "Could you tell me which plan, pricing detail, or discount request you want checked?";
  }

  if (isPolicyLikeRequest(options)) {
    return "Could you tell me which policy, billing detail, or account topic you want checked?";
  }

  return "Could you share a bit more detail about what you want me to check?";
}

export function buildIntentAwareUnsupportedFallback(options: FollowUpOptions): string {
  const question = buildIntentAwareFollowUpQuestion(options);

  if (isPricingLikeRequest(options)) {
    return `I couldn't verify a reliable answer for that from the knowledge base I searched. ${question}`.trim();
  }

  if (options.explicitHumanRequest || options.intent === "handoff") {
    return `I can help with that handoff, but I need a brief description of the issue first. ${question}`.trim();
  }

  return `I couldn't verify that reliably from the knowledge base I searched. ${question}`.trim();
}
