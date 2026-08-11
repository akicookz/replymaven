export type McpPresetKey =
  | "posthog"
  | "stripe"
  | "slack"
  | "attio"
  | "linear";

export type McpAuthMode = "oauth" | "bearer";

export interface McpPreset {
  key: McpPresetKey;
  label: string;
  url: string;
  auth: readonly McpAuthMode[];
  icon: string;
}

const MCP_PRESETS: readonly McpPreset[] = Object.freeze([
  Object.freeze({
    key: "posthog",
    label: "PostHog",
    url: "https://mcp.posthog.com/mcp",
    auth: Object.freeze(["oauth", "bearer"] satisfies McpAuthMode[]),
    icon: "/integrations/posthog.svg",
  }),
  Object.freeze({
    key: "stripe",
    label: "Stripe",
    url: "https://mcp.stripe.com",
    auth: Object.freeze(["oauth", "bearer"] satisfies McpAuthMode[]),
    icon: "/integrations/stripe.svg",
  }),
  Object.freeze({
    key: "slack",
    label: "Slack",
    url: "https://mcp.slack.com/mcp",
    auth: Object.freeze(["bearer"] satisfies McpAuthMode[]),
    icon: "/integrations/slack.svg",
  }),
  Object.freeze({
    key: "attio",
    label: "Attio",
    url: "https://mcp.attio.com/mcp",
    auth: Object.freeze(["oauth"] satisfies McpAuthMode[]),
    icon: "/integrations/attio.svg",
  }),
  Object.freeze({
    key: "linear",
    label: "Linear",
    url: "https://mcp.linear.app/mcp",
    auth: Object.freeze(["oauth", "bearer"] satisfies McpAuthMode[]),
    icon: "/integrations/linear.svg",
  }),
]);

export function listMcpPresets(): readonly McpPreset[] {
  return MCP_PRESETS;
}

export function getMcpPreset(key: string): McpPreset | null {
  return MCP_PRESETS.find((preset) => preset.key === key) ?? null;
}
