import { type AiParticipation } from "../types";

export type HardGateDecision = "muted" | "agent_mode" | "closed" | null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseVisitorAiInvocation(
  message: string,
  botName: string | null | undefined,
): { invoked: boolean; content: string } {
  const normalizedBotName = botName?.trim();
  if (!normalizedBotName) return { invoked: false, content: message };

  const mention = new RegExp(
    `^@${escapeRegExp(normalizedBotName)}(?:\\s+|[,:]\\s*|$)`,
    "i",
  );
  if (!mention.test(message)) return { invoked: false, content: message };

  const content = message.replace(mention, "").trim();
  if (!content) return { invoked: false, content: message };

  return { invoked: true, content };
}

export function identifyHardGate(input: {
  status: string;
  closeReason: string | null;
  aiParticipation?: AiParticipation;
  aiInvoked?: boolean;
}): HardGateDecision {
  if (input.closeReason === "spam") return "muted";
  if (input.status === "closed") return "closed";
  if (input.aiParticipation === "human_only") {
    return input.aiInvoked ? null : "agent_mode";
  }
  if (input.status === "waiting_agent" || input.status === "agent_replied") {
    if (input.aiParticipation === "assist_until_agent") return null;
    return "agent_mode";
  }
  return null;
}
