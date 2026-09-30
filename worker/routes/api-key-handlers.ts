import type { Context } from "hono";
import type { HonoAppContext } from "../types";
import { createApiKeySchema } from "../validation";
import { BodyTooLargeError, readLimitedBody } from "../lib/read-limited-body";
import { ApiKeyService } from "../services/api-key-service";
import { ProjectService } from "../services/project-service";

async function authorizeKeyManagement(c: Context<HonoAppContext>): Promise<Response | null> {
  c.header("Cache-Control", "no-store");
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const role = c.get("activeRole");
  if (role !== "owner" && role !== "admin") return c.json({ error: "Forbidden" }, 403);
  const projectId = c.req.param("id");
  const project = await new ProjectService(c.get("db")).getProjectById(projectId);
  if (!project || project.userId !== (c.get("effectiveUserId") ?? user.id)) {
    return c.json({ error: "Not found" }, 404);
  }
  if (!c.get("activeAccessAllProjects") && !c.get("activeProjectIds")?.includes(projectId)) {
    return c.json({ error: "Not found" }, 404);
  }
  return null;
}

export async function handleListApiKeys(c: Context<HonoAppContext>): Promise<Response> {
  const denied = await authorizeKeyManagement(c);
  if (denied) return denied;
  const apiKeys = await new ApiKeyService(c.get("db")).list(c.req.param("id"));
  return c.json({ apiKeys });
}

export async function handleCreateApiKey(c: Context<HonoAppContext>): Promise<Response> {
  const denied = await authorizeKeyManagement(c);
  if (denied) return denied;
  let body: unknown;
  try {
    const bytes = await readLimitedBody(c.req.raw.body, 4096, c.req.header("content-length"));
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return c.json({ error: "Request is too large" }, 413);
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid label" }, 400);
  const result = await new ApiKeyService(c.get("db")).create(c.req.param("id"), parsed.data.label);
  return c.json(result, 201);
}

export async function handleRevokeApiKey(c: Context<HonoAppContext>): Promise<Response> {
  const denied = await authorizeKeyManagement(c);
  if (denied) return denied;
  const revoked = await new ApiKeyService(c.get("db")).revoke(c.req.param("id"), c.req.param("keyId"));
  return revoked ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
}
