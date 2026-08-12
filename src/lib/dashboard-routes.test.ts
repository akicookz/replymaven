import { describe, expect, it } from "vitest";
import {
  getLegacySettingsDestination,
  normalizeChatWidgetTab,
  projectRoute,
} from "./dashboard-routes";

describe("dashboard routes", () => {
  it("builds every canonical first-class project route", () => {
    expect(projectRoute("project-1", "sources")).toBe(
      "/app/projects/project-1/knowledgebase/sources",
    );
    expect(projectRoute("project-1", "chat-widget")).toBe(
      "/app/projects/project-1/support-chat/widget",
    );
    expect(projectRoute("project-1", "mcp-connections")).toBe(
      "/app/projects/project-1/mcp-connections",
    );
  });

  it("falls back invalid widget tabs to appearance", () => {
    expect(normalizeChatWidgetTab("actions")).toBe("actions");
    expect(normalizeChatWidgetTab("appearance")).toBe("appearance");
    expect(normalizeChatWidgetTab("installation")).toBe("appearance");
    expect(normalizeChatWidgetTab(null)).toBe("appearance");
  });

  it("moves legacy general and MCP settings to first-class pages", () => {
    expect(getLegacySettingsDestination("project-1", "general")).toBe(
      "/app/projects/project-1/knowledgebase/company-info",
    );
    expect(getLegacySettingsDestination("project-1", "mcp")).toBe(
      "/app/projects/project-1/mcp-connections",
    );
    expect(getLegacySettingsDestination("project-1", "billing")).toBeNull();
  });
});
