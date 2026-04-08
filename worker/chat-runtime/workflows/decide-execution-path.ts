import {
  type ExecutionPathDecision,
  type SupportIntent,
  type SupportToolDefinition,
} from "../types";

interface RankedTool {
  tool: SupportToolDefinition;
  score: number;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function extractToolCorpus(tool: SupportToolDefinition): string {
  return [
    tool.name,
    tool.displayName,
    tool.description,
    tool.parameters,
    tool.responseMapping ?? "",
  ].join(" ");
}

function isReadLikeTool(tool: SupportToolDefinition): boolean {
  if (tool.method === "GET") return true;

  return /\b(get|lookup|find|fetch|status|read|list|search|retrieve|verify|check)\b/i.test(
    extractToolCorpus(tool),
  );
}

function scoreToolRelevance(
  tool: SupportToolDefinition,
  userMessage: string,
): number {
  const messageTokens = new Set(tokenize(userMessage));
  const toolTokens = tokenize(extractToolCorpus(tool));
  if (messageTokens.size === 0 || toolTokens.length === 0) return 0;

  let score = 0;
  for (const token of toolTokens) {
    if (messageTokens.has(token)) {
      score += 2;
    }
  }

  if (tool.name && userMessage.toLowerCase().includes(tool.name.toLowerCase())) {
    score += 4;
  }

  if (
    tool.displayName &&
    userMessage.toLowerCase().includes(tool.displayName.toLowerCase())
  ) {
    score += 4;
  }

  if (
    /\b(check|lookup|find|show|status|search|verify|track|fetch|list)\b/i.test(
      userMessage,
    ) &&
    isReadLikeTool(tool)
  ) {
    score += 2;
  }

  return score;
}

function rankRelevantTools(
  tools: SupportToolDefinition[],
  userMessage: string,
): RankedTool[] {
  return tools
    .map((tool) => ({
      tool,
      score: scoreToolRelevance(tool, userMessage),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
}

function selectLookupTools(
  rankedTools: RankedTool[],
): Pick<ExecutionPathDecision, "allowedTools" | "toolChoice"> {
  const allowedTools = rankedTools.slice(0, 3).map((entry) => entry.tool);
  const bestTool = rankedTools[0];
  const secondTool = rankedTools[1];

  if (
    allowedTools.length === 1 ||
    (bestTool && secondTool && bestTool.score >= secondTool.score + 3)
  ) {
    return {
      allowedTools,
      toolChoice: bestTool
        ? { type: "tool", toolName: bestTool.tool.name }
        : "required",
    };
  }

  return {
    allowedTools,
    toolChoice: allowedTools.length > 0 ? "required" : "none",
  };
}

function selectDiagnosticTools(
  rankedTools: RankedTool[],
): SupportToolDefinition[] {
  return rankedTools
    .filter((entry) => isReadLikeTool(entry.tool))
    .slice(0, 2)
    .map((entry) => entry.tool);
}

function looksLikeTroubleshootingCheck(userMessage: string): boolean {
  return (
    /\b(check|test|verify|confirm)\b/i.test(userMessage) &&
    /\b(work|working|works|broken|failing|failed|error|issue|problem|connected|configured|enabled|running)\b/i.test(
      userMessage,
    ) &&
    /^(how|can|what|where|is|does|do)\b/i.test(userMessage.trim())
  );
}

export function decideExecutionPath(options: {
  intent: SupportIntent;
  userMessage: string;
  enabledTools: SupportToolDefinition[];
}): ExecutionPathDecision {
  const rankedTools = rankRelevantTools(options.enabledTools, options.userMessage);

  switch (options.intent) {
    case "handoff":
      return {
        path: "handoff",
        retrievalMode: "none",
        allowBroaderRetry: false,
        allowedTools: [],
        toolChoice: "none",
      };

    case "lookup": {
      if (looksLikeTroubleshootingCheck(options.userMessage)) {
        const allowedTools = selectDiagnosticTools(rankedTools);
        return {
          path: "docs_first",
          retrievalMode: "full",
          allowBroaderRetry: true,
          allowedTools,
          toolChoice: allowedTools.length > 0 ? "auto" : "none",
        };
      }

      const { allowedTools, toolChoice } = selectLookupTools(rankedTools);
      if (allowedTools.length === 0) {
        return {
          path: "clarify_first",
          retrievalMode: "light",
          allowBroaderRetry: false,
          allowedTools: [],
          toolChoice: "none",
        };
      }

      return {
        path: "tool_first",
        retrievalMode: "none",
        allowBroaderRetry: false,
        allowedTools,
        toolChoice,
      };
    }

    case "clarify":
      return {
        path: "clarify_first",
        retrievalMode: "light",
        allowBroaderRetry: false,
        allowedTools: [],
        toolChoice: "none",
      };

    case "troubleshoot": {
      const allowedTools = selectDiagnosticTools(rankedTools);
      return {
        path: "docs_first",
        retrievalMode: "full",
        allowBroaderRetry: true,
        allowedTools,
        toolChoice: allowedTools.length > 0 ? "auto" : "none",
      };
    }

    case "policy":
      return {
        path: "docs_first",
        retrievalMode: "full",
        allowBroaderRetry: true,
        allowedTools: [],
        toolChoice: "none",
      };

    case "how_to":
    default:
      return {
        path: "docs_first",
        retrievalMode: "full",
        allowBroaderRetry: true,
        allowedTools: [],
        toolChoice: "none",
      };
  }
}
