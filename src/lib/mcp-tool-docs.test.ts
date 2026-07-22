import { describe, expect, test } from "bun:test";
import { MCP_TOOL_DOCS } from "./mcp-tool-docs";

const expectedToolNames = [
  "list_projects",
  "get_project_overview",
  "list_resources",
  "get_resource_content",
  "list_conversations",
  "get_conversation",
  "send_agent_reply",
  "create_faq_resource",
  "update_faq_resource",
  "create_webpage_resource",
  "reindex_resource",
];

describe("MCP tool documentation", () => {
  test("documents every registered ReplyMaven MCP tool", () => {
    expect(MCP_TOOL_DOCS.map((tool) => tool.name)).toEqual(expectedToolNames);
  });

  test("documents every input with its type and purpose", () => {
    for (const tool of MCP_TOOL_DOCS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.scope.length).toBeGreaterThan(0);
      for (const input of tool.inputs) {
        expect(input.type.length).toBeGreaterThan(0);
        expect(input.description.length).toBeGreaterThan(0);
      }
    }
  });

  test("requires explicit confirmation for every write tool", () => {
    const writeTools = MCP_TOOL_DOCS.filter((tool) => !tool.readOnly);
    for (const tool of writeTools) {
      expect(tool.inputs.some((input) => input.name === "confirm")).toBe(true);
    }
  });
});
