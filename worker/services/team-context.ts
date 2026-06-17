import { type DrizzleD1Database } from "drizzle-orm/d1";
import { TeamService } from "./team-service";
import { ProjectService } from "./project-service";

/**
 * The resolved "active team" context for a request: which team the user is
 * acting in, their role there, and (for scoped members) which projects they may
 * access. Computed from the DB and cached in KV for 15 minutes; invalidated
 * eagerly whenever the user's standing in a team changes (accept / kick / role /
 * access / switch) so changes take effect well within the TTL.
 */
export interface TeamContext {
  /** Owner id of the active team — used everywhere `effectiveUserId` was. */
  effectiveUserId: string;
  /** The user's role in the active team. */
  activeRole: "owner" | "admin" | "member";
  /** True for owners/admins and members with account-wide access. */
  accessAllProjects: boolean;
  /** Granted project ids for a scoped member; null when accessAllProjects. */
  projectIds: string[] | null;
}

const TTL_SECONDS = 15 * 60;
const keyFor = (userId: string) => `teamctx:${userId}`;

function ownerContext(userId: string): TeamContext {
  return {
    effectiveUserId: userId,
    activeRole: "owner",
    accessAllProjects: true,
    projectIds: null,
  };
}

async function membershipContext(
  teamService: TeamService,
  ownerId: string,
  membership: { id: string; role: "admin" | "member"; accessAllProjects: boolean },
): Promise<TeamContext> {
  if (membership.role === "admin" || membership.accessAllProjects) {
    return {
      effectiveUserId: ownerId,
      activeRole: membership.role,
      accessAllProjects: true,
      projectIds: null,
    };
  }
  const projectIds = await teamService.getMemberProjectIds(membership.id);
  return {
    effectiveUserId: ownerId,
    activeRole: "member",
    accessAllProjects: false,
    projectIds,
  };
}

/**
 * Resolve the active-team context from the database (no cache). Validates the
 * persisted choice against live membership; an unset choice falls back to a
 * smart default so a pure member isn't forced into onboarding for their empty
 * own team.
 */
export async function buildTeamContext(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<TeamContext> {
  const teamService = new TeamService(db);
  const activeTeamId = await teamService.getActiveTeamId(userId);

  // Explicit choice: another team the user belongs to.
  if (activeTeamId && activeTeamId !== userId) {
    const membership = await teamService.getMembershipForOwner(
      userId,
      activeTeamId,
    );
    if (membership) {
      return membershipContext(teamService, activeTeamId, membership);
    }
    // Stale (membership revoked) — fall through to the smart default.
  } else if (activeTeamId === userId) {
    // Explicit choice: the user's own team.
    return ownerContext(userId);
  }

  // No explicit choice (or stale). Default to the own team unless the user is a
  // pure member (no onboarded own project) — then fall back to a team they've
  // joined so they aren't bounced into onboarding for an empty own account.
  // Check memberships first to skip the project scan for the common owner case.
  const memberships = await teamService.getMembershipsForUser(userId);
  if (memberships.length === 0) return ownerContext(userId);

  const projectService = new ProjectService(db);
  const ownProjects = await projectService.getProjectsByUserId(userId);
  if (ownProjects.some((p) => p.onboarded)) return ownerContext(userId);

  const chosen = memberships[0];
  return membershipContext(teamService, chosen.ownerId, {
    id: chosen.id,
    role: chosen.role as "admin" | "member",
    accessAllProjects: chosen.accessAllProjects,
  });
}

/** Runtime shape guard for a cached context (tolerates legacy/partial entries). */
function isTeamContext(value: unknown): value is TeamContext {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.effectiveUserId === "string" &&
    (v.activeRole === "owner" ||
      v.activeRole === "admin" ||
      v.activeRole === "member") &&
    typeof v.accessAllProjects === "boolean" &&
    (v.projectIds === null || Array.isArray(v.projectIds))
  );
}

/** Read the cached context, computing and caching it on a miss. */
export async function getTeamContext(
  kv: KVNamespace,
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<TeamContext> {
  try {
    const cached = await kv.get(keyFor(userId));
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      // Ignore malformed/legacy entries and re-resolve from the DB.
      if (isTeamContext(parsed)) return parsed;
    }
  } catch {
    // KV read failures fall back to a live DB resolution.
  }

  const context = await buildTeamContext(db, userId);

  try {
    await kv.put(keyFor(userId), JSON.stringify(context), {
      expirationTtl: TTL_SECONDS,
    });
  } catch {
    // Best-effort cache; a failed write just means a recompute next request.
  }

  return context;
}

/** Drop a user's cached context so the next request re-resolves from the DB. */
export async function invalidateTeamContext(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  try {
    await kv.delete(keyFor(userId));
  } catch {
    // Best-effort; the 15-minute TTL bounds staleness even if this fails.
  }
}
