import { and, eq } from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { channelIdentities, projects, teamMembers } from "../db";
import { users } from "../db/auth.schema";
import { TeamService } from "./team-service";

export type IdentityChannel = "slack" | "telegram";

export interface ResolvedTeammate {
  userId: string;
  name: string;
  email: string;
}

const TELEGRAM_LINK_TTL_MS = 15 * 60 * 1_000;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index]! ^ b[index]!;
  return mismatch === 0;
}

export class ChannelIdentityService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // The teammate behind a channel account, if linked and still on the team
  // with access to this project.
  async resolveAuthor(input: {
    projectId: string;
    ownerId: string;
    channel: IdentityChannel;
    externalId: string;
  }): Promise<ResolvedTeammate | null> {
    const rows = await this.db
      .select({ userId: channelIdentities.userId })
      .from(channelIdentities)
      .where(
        and(
          eq(channelIdentities.ownerId, input.ownerId),
          eq(channelIdentities.channel, input.channel),
          eq(channelIdentities.externalId, input.externalId),
        ),
      )
      .limit(1);
    const userId = rows[0]?.userId;
    if (!userId) return null;
    return this.teammateWithAccess(input.projectId, input.ownerId, userId);
  }

  // Match an email (from Slack users.info) to the owner or an accepted member.
  async resolveByEmail(input: {
    projectId: string;
    ownerId: string;
    email: string;
  }): Promise<ResolvedTeammate | null> {
    const wanted = input.email.trim().toLowerCase();
    if (!wanted) return null;
    const rows = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, wanted))
      .limit(1);
    const userId = rows[0]?.id;
    if (!userId) return null;
    return this.teammateWithAccess(input.projectId, input.ownerId, userId);
  }

  async link(input: {
    ownerId: string;
    userId: string;
    channel: IdentityChannel;
    externalId: string;
  }): Promise<void> {
    await this.db
      .insert(channelIdentities)
      .values({ id: crypto.randomUUID(), ...input })
      .onConflictDoUpdate({
        target: [
          channelIdentities.ownerId,
          channelIdentities.channel,
          channelIdentities.externalId,
        ],
        set: { userId: input.userId },
      });
  }

  async teammateWithAccess(
    projectId: string,
    ownerId: string,
    userId: string,
  ): Promise<ResolvedTeammate | null> {
    const userRows = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) return null;
    if (userId !== ownerId) {
      const teamService = new TeamService(this.db);
      const membership = await teamService.getMembershipForOwner(userId, ownerId);
      if (!membership) return null;
      const hasAccess = membership.accessAllProjects ||
        await teamService.memberHasProjectAccess(membership.id, projectId);
      if (!hasAccess) return null;
    }
    return { userId: user.id, name: user.name, email: user.email };
  }

  // The user is the owner or an accepted member of that owner's team.
  async canJoinOwner(userId: string, ownerId: string): Promise<boolean> {
    if (userId === ownerId) return true;
    const rows = await this.db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, "accepted"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async ownerIdForProject(projectId: string): Promise<string | null> {
    const rows = await this.db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]?.userId ?? null;
  }
}

// ─── Telegram link tokens ─────────────────────────────────────────────────────
// `@Maven link` in the group mints one; opening it while signed in binds the
// Telegram account to the signed-in user.

interface TelegramLinkPayload {
  ownerId: string;
  telegramUserId: string;
  exp: number;
}

export async function mintTelegramLinkToken(
  payload: Omit<TelegramLinkPayload, "exp">,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const body = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, exp: now + TELEGRAM_LINK_TTL_MS }),
    ),
  );
  const signature = encodeBase64Url(await hmac(secret, body));
  return `${body}.${signature}`;
}

export async function verifyTelegramLinkToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<TelegramLinkPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = await hmac(secret, body);
  let given: Uint8Array;
  try {
    given = decodeBase64Url(signature);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(body)),
    ) as Partial<TelegramLinkPayload>;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.telegramUserId !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < now
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      telegramUserId: parsed.telegramUserId,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
