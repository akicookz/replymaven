import { toolAudienceSchema, type MavenChannel } from "../../validation";
import {
  type MavenToolAuthorizationError,
  type MavenToolCapability,
  type MavenTurnContext,
} from "../types";

export function authorizeCapability(
  context: MavenTurnContext,
  capability: MavenToolCapability,
): { ok: true } | { ok: false; code: MavenToolAuthorizationError } {
  if (capability.projectId !== context.projectId) {
    return { ok: false, code: "project_mismatch" };
  }
  if (!capability.enabled) {
    return { ok: false, code: "tool_disabled" };
  }
  if (capability.source === "mcp" && context.channel === "public") {
    return { ok: false, code: "channel_not_allowed" };
  }
  if (!capability.allowedChannels.includes(context.channel)) {
    return { ok: false, code: "channel_not_allowed" };
  }
  return { ok: true };
}

export async function fingerprintJsonSchema(schema: unknown): Promise<string> {
  const canonicalSchema = JSON.stringify(sortJsonKeys(schema)) ?? "null";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalSchema),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseAllowedChannels(raw: string): MavenChannel[] {
  try {
    const parsed = toolAudienceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonKeys(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = sortJsonKeys((value as Record<string, unknown>)[key]);
      return sorted;
    }, Object.create(null) as Record<string, unknown>);
}
