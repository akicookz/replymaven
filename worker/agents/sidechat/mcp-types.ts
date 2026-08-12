import type { SidechatToolDescriptor } from "../../../shared/sidechat-agent";
import type { McpPresetKey } from "./mcp-presets";

export type ProjectMcpAuthMode = "oauth" | "bearer" | "headers" | "none";

export interface ConnectProjectMcpInput {
  name: string;
  presetKey: McpPresetKey | null;
  url: string;
  authMode: ProjectMcpAuthMode;
  bearerToken?: string;
  headers?: Record<string, string>;
  callbackHost: string;
  callbackPath: string;
}

export interface McpConnectionView {
  id: string;
  name: string;
  presetKey: McpPresetKey | null;
  url: string;
  authMode: ProjectMcpAuthMode;
  state: string;
  authUrl?: string;
  issue?: "tool_discovery_failed";
  tools: SidechatToolDescriptor[];
}

export interface ProjectMcpPolicyInput {
  toolName: string;
  catalogFingerprint: string;
  enabled: boolean;
  access: "read" | "write";
}
