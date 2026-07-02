import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, inArray } from "drizzle-orm";
import { projects, teamMembers, teamMemberProjects } from "../db";
import { users } from "../db/auth.schema";

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
}

/**
 * Users a conversation (or, historically, a ticket) may be assigned to for a
 * project: the project owner plus accepted team members with access to it.
 * Backs `GET /api/projects/:id/assignable-users` (AssigneeMenu) and the
 * conversation `PATCH .../assign` route's assignee validation.
 */
export async function getAssignableUsers(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
): Promise<AssignableUser[]> {
  const projRows = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const proj = projRows[0];
  if (!proj) return [];

  // Owner
  const ownerRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      profilePicture: users.profilePicture,
    })
    .from(users)
    .where(eq(users.id, proj.userId))
    .limit(1);

  const result: AssignableUser[] = [];
  if (ownerRows[0]) {
    result.push({
      id: ownerRows[0].id,
      name: ownerRows[0].name,
      email: ownerRows[0].email,
      image: ownerRows[0].profilePicture ?? ownerRows[0].image,
      role: "owner",
    });
  }

  // Accepted team members under this owner
  const memberRows = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      role: teamMembers.role,
      accessAllProjects: teamMembers.accessAllProjects,
    })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.ownerId, proj.userId),
        eq(teamMembers.status, "accepted"),
      ),
    );

  // Members scoped to specific projects are only assignable on the projects
  // they were granted.
  const scopedMemberIds = memberRows
    .filter((m) => m.role !== "admin" && !m.accessAllProjects)
    .map((m) => m.id);
  let grantedScopedIds = new Set<string>();
  if (scopedMemberIds.length > 0) {
    const grantRows = await db
      .select({ teamMemberId: teamMemberProjects.teamMemberId })
      .from(teamMemberProjects)
      .where(
        and(
          eq(teamMemberProjects.projectId, projectId),
          inArray(teamMemberProjects.teamMemberId, scopedMemberIds),
        ),
      );
    grantedScopedIds = new Set(grantRows.map((r) => r.teamMemberId));
  }
  const accessibleMembers = memberRows.filter(
    (m) =>
      m.role === "admin" || m.accessAllProjects || grantedScopedIds.has(m.id),
  );

  const memberUserIds = accessibleMembers
    .map((m) => m.userId)
    .filter((v): v is string => Boolean(v));

  if (memberUserIds.length > 0) {
    const memberUserRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
      })
      .from(users)
      .where(inArray(users.id, memberUserIds));

    const roleByUserId = new Map(
      accessibleMembers
        .filter((m) => m.userId)
        .map((m) => [m.userId as string, m.role as "admin" | "member"]),
    );

    for (const u of memberUserRows) {
      if (u.id === proj.userId) continue; // owner already added
      result.push({
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.profilePicture ?? u.image,
        role: roleByUserId.get(u.id) ?? "member",
      });
    }
  }

  return result;
}
