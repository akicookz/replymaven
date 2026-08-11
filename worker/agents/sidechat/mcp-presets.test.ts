import { describe, expect, test } from "bun:test";
import { getMcpPreset, listMcpPresets } from "./mcp-presets";

describe("Sidechat MCP presets", () => {
  test("exposes only the five verified presentation presets", () => {
    expect(listMcpPresets()).toEqual([
      {
        key: "posthog",
        label: "PostHog",
        url: "https://mcp.posthog.com/mcp",
        auth: ["oauth", "bearer"],
        icon: "/integrations/posthog.svg",
      },
      {
        key: "stripe",
        label: "Stripe",
        url: "https://mcp.stripe.com",
        auth: ["oauth", "bearer"],
        icon: "/integrations/stripe.svg",
      },
      {
        key: "slack",
        label: "Slack",
        url: "https://mcp.slack.com/mcp",
        auth: ["bearer"],
        icon: "/integrations/slack.svg",
      },
      {
        key: "attio",
        label: "Attio",
        url: "https://mcp.attio.com/mcp",
        auth: ["oauth"],
        icon: "/integrations/attio.svg",
      },
      {
        key: "linear",
        label: "Linear",
        url: "https://mcp.linear.app/mcp",
        auth: ["oauth", "bearer"],
        icon: "/integrations/linear.svg",
      },
    ]);
  });

  test("returns immutable presentation data without provider actions", () => {
    const preset = getMcpPreset("stripe");

    expect(preset).toMatchObject({ key: "stripe", label: "Stripe" });
    expect(preset).not.toHaveProperty("tools");
    expect(preset).not.toHaveProperty("actions");
    expect(preset).not.toHaveProperty("reducer");
    expect(preset).not.toHaveProperty("identityMapping");
    expect(getMcpPreset("unknown")).toBeNull();
  });
});
