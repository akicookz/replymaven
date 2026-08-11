import type { JSONSchema7 } from "json-schema";
import type { SidechatToolDescriptor } from "../../../shared/sidechat-agent";
import { isReservedMavenToolName } from "../../validation";

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SCHEMA_CHARS = 100_000;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 5_000;
const RESERVED_SIDECHAT_TOOL_NAMES = new Set([
  "present_reply_draft",
  "request_team_help",
  "search_knowledge",
]);

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  [key: string]: unknown;
}

export interface DiscoveredMcpTool {
  serverId: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema: JSONSchema7;
  annotations?: McpToolAnnotations;
}

interface FingerprintMcpToolInput {
  name: string;
  description?: string;
  inputSchema: JSONSchema7;
  annotations?: McpToolAnnotations;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return false;
  }

  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeIpv6(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .toLowerCase();
  if (!normalized.includes(":")) return false;
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(fc|fd|fe[89ab])/u.test(normalized)) return true;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);

  const mappedHex = normalized.match(
    /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u,
  );
  if (!mappedHex?.[1] || !mappedHex[2]) return false;
  const high = Number.parseInt(mappedHex[1], 16);
  const low = Number.parseInt(mappedHex[2], 16);
  return isPrivateIpv4(
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
  );
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".metadata.google.internal") ||
    isPrivateIpv4(normalized) ||
    isUnsafeIpv6(normalized)
  );
}

export function validateMcpServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MCP server must use a public HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username !== "" ||
    url.password !== "" ||
    isUnsafeHostname(url.hostname)
  ) {
    throw new Error("MCP server must use a public HTTPS URL");
  }

  return url.toString();
}

export function classifyMcpToolAccess(
  annotations: McpToolAnnotations | undefined,
): "read" | "write" {
  return annotations?.readOnlyHint === true &&
    annotations.destructiveHint !== true
    ? "read"
    : "write";
}

export function normalizeMcpToolResult(result: unknown): unknown {
  try {
    const serialized = JSON.stringify(result);
    return serialized && serialized.length <= MAX_SCHEMA_CHARS
      ? result
      : { error: "mcp_tool_output_too_large" };
  } catch {
    return { error: "mcp_tool_output_too_large" };
  }
}

function assertUnreservedToolName(toolName: string): void {
  const normalized = toolName.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_NAME_LENGTH ||
    isReservedMavenToolName(normalized) ||
    RESERVED_SIDECHAT_TOOL_NAMES.has(normalized)
  ) {
    throw new Error("MCP tool name is empty, invalid, or reserved");
  }
}

export function toMcpExposedName(
  connectionId: string,
  toolName: string,
): string {
  assertUnreservedToolName(toolName);
  const normalizedConnectionId = connectionId.replace(/-/gu, "");
  if (!normalizedConnectionId) {
    throw new Error("MCP connection ID is invalid");
  }
  return `tool_${normalizedConnectionId}_${toolName}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}

export async function fingerprintMcpTool(
  tool: FingerprintMcpToolInput,
): Promise<string> {
  const serialized = JSON.stringify(
    canonicalize({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations ?? {},
    }),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function safeInputSchema(inputSchema: JSONSchema7): JSONSchema7 | null {
  if (
    inputSchema === null ||
    typeof inputSchema !== "object" ||
    Array.isArray(inputSchema)
  ) {
    return null;
  }
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: inputSchema, depth: 0 },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES || current.depth > MAX_SCHEMA_DEPTH) {
      return null;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) return null;
    seen.add(current.value);
    for (const child of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  try {
    return JSON.stringify(inputSchema).length <= MAX_SCHEMA_CHARS
      ? inputSchema
      : null;
  } catch {
    return null;
  }
}

function safeText(value: string | undefined, fallback: string, max: number): string {
  const trimmed = value?.trim();
  return (trimmed || fallback).slice(0, max);
}

export async function normalizeMcpCatalog(
  connectionId: string,
  tools: readonly DiscoveredMcpTool[],
  configured: readonly SidechatToolDescriptor[],
): Promise<SidechatToolDescriptor[]> {
  const configuredByName = new Map(
    configured
      .filter((tool) => tool.connectionId === connectionId)
      .map((tool) => [tool.toolName, tool] as const),
  );
  const normalized: SidechatToolDescriptor[] = [];

  for (const tool of tools) {
    if (tool.serverId !== connectionId) continue;
    try {
      assertUnreservedToolName(tool.name);
    } catch {
      continue;
    }

    const inputSchema = safeInputSchema(tool.inputSchema);
    if (!inputSchema) continue;
    const description = safeText(
      tool.description,
      `Use ${tool.name} through the connected MCP server.`,
      MAX_DESCRIPTION_LENGTH,
    );
    const annotations: McpToolAnnotations = {
      ...(typeof tool.annotations?.readOnlyHint === "boolean"
        ? { readOnlyHint: tool.annotations.readOnlyHint }
        : {}),
      ...(typeof tool.annotations?.destructiveHint === "boolean"
        ? { destructiveHint: tool.annotations.destructiveHint }
        : {}),
    };
    const catalogFingerprint = await fingerprintMcpTool({
      name: tool.name,
      description,
      inputSchema,
      annotations,
    });
    const previous = configuredByName.get(tool.name);
    const previousIsCurrent =
      previous?.catalogFingerprint === catalogFingerprint;
    normalized.push({
      connectionId,
      toolName: tool.name,
      exposedName: toMcpExposedName(connectionId, tool.name),
      displayName: safeText(tool.title, tool.name, MAX_NAME_LENGTH),
      description,
      inputSchema,
      catalogFingerprint,
      audience: "sidechat",
      access: previousIsCurrent
        ? previous.access
        : classifyMcpToolAccess(annotations),
      enabled: previousIsCurrent ? previous.enabled : false,
    });
  }

  return normalized;
}
