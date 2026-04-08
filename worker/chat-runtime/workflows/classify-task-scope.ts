export type TaskScopeDecisionKind =
  | "in_scope_support"
  | "out_of_scope_general"
  | "unsafe";

export interface TaskScopeDecision {
  kind: TaskScopeDecisionKind;
  reason: string;
  response?: string;
}

const SUPPORT_SIGNAL_PATTERNS = [
  /\b(account|login|password|email|billing|invoice|refund|subscription|plan|pricing)\b/i,
  /\b(api|sdk|token|integration|webhook|embed|widget|dashboard|project|settings)\b/i,
  /\b(setup|set up|configure|configuration|install|connect|connected|enable|enabled)\b/i,
  /\b(error|issue|problem|bug|broken|failing|failed|not working|working)\b/i,
  /\b(feature|documentation|docs|policy|compliance|security|team|agent|inquiry)\b/i,
];

const UNSAFE_REQUEST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(cook|make|manufacture|synthesize|produce)\b[^.!?\n]{0,80}\b(meth|methamphetamine)\b/i,
    reason: "illegal_drug_instructions",
  },
  {
    pattern:
      /\b(build|make|assemble|create)\b[^.!?\n]{0,80}\b(bomb|explosive|weapon)\b/i,
    reason: "weapon_instructions",
  },
  {
    pattern:
      /\b(write|create|build|make)\b[^.!?\n]{0,80}\b(malware|ransomware|keylogger|virus)\b/i,
    reason: "malware_instructions",
  },
];

const OUT_OF_SCOPE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(recipe|cook|bake|banana bread|ingredients|oven|preheat|sourdough|pasta)\b/i,
    reason: "general_recipe_request",
  },
  {
    pattern:
      /\b(search|browse|google|look up|find)\b[^.!?\n]{0,80}\b(web|internet|online)\b/i,
    reason: "external_web_request",
  },
  {
    pattern: /\b(tell me a joke|write a poem|write a song|write a story)\b/i,
    reason: "general_creative_request",
  },
];

function hasSupportSignals(message: string): boolean {
  return SUPPORT_SIGNAL_PATTERNS.some((pattern) => pattern.test(message));
}

function buildScopeResponse(kind: TaskScopeDecisionKind): string {
  if (kind === "unsafe") {
    return "I can't help with dangerous, illegal, or harmful instructions. I can help with questions about this product, website, or your use of it instead.";
  }

  return "I can help with questions about this product, website, account, or support task, but I can't help with unrelated general-purpose requests here.";
}

export function classifyTaskScope(options: {
  message: string;
  pageContext?: Record<string, string>;
}): TaskScopeDecision {
  const message = options.message.trim();
  if (!message) {
    return { kind: "in_scope_support", reason: "empty_message" };
  }

  for (const entry of UNSAFE_REQUEST_PATTERNS) {
    if (entry.pattern.test(message)) {
      return {
        kind: "unsafe",
        reason: entry.reason,
        response: buildScopeResponse("unsafe"),
      };
    }
  }

  const pageContextSignals = Object.keys(options.pageContext ?? {}).length > 0;
  const supportSignals = hasSupportSignals(message) || pageContextSignals;

  for (const entry of OUT_OF_SCOPE_PATTERNS) {
    if (entry.pattern.test(message) && !supportSignals) {
      return {
        kind: "out_of_scope_general",
        reason: entry.reason,
        response: buildScopeResponse("out_of_scope_general"),
      };
    }
  }

  return {
    kind: "in_scope_support",
    reason: supportSignals ? "support_signals_detected" : "default_allow",
  };
}
