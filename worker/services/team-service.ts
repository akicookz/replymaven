import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, or, inArray } from "drizzle-orm";
import {
  teamMembers,
  teamMemberProjects,
  projects,
  users,
  type TeamMemberRow,
} from "../db";
// ─── Team Service ─────────────────────────────────────────────────────────────

export class TeamService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
  ) {}

  // ─── Queries ──────────────────────────────────────────────────────────────

  async getTeamMembers(ownerId: string): Promise<TeamMemberRow[]> {
    return this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          eq(teamMembers.status, "accepted"),
        ),
      );
  }

  async getPendingInvites(ownerId: string): Promise<TeamMemberRow[]> {
    return this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          eq(teamMembers.status, "pending"),
        ),
      );
  }

  async getAllMembers(ownerId: string): Promise<TeamMemberRow[]> {
    return this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          or(
            eq(teamMembers.status, "accepted"),
            eq(teamMembers.status, "pending"),
          ),
        ),
      );
  }

  async getMemberById(id: string): Promise<TeamMemberRow | null> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getInviteByEmail(
    ownerId: string,
    email: string,
  ): Promise<TeamMemberRow | null> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          eq(teamMembers.email, email),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Find a pending invite for the given email across all owners. Used after
   * sign-in to detect that the user should be routed to accept an invite
   * instead of the owner onboarding flow.
   */
  async getPendingInviteForEmail(
    email: string,
  ): Promise<TeamMemberRow | null> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.email, email),
          eq(teamMembers.status, "pending"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * For a given userId, check if they are a team member of someone else's account.
   * Returns the team membership if found (ownerId + role), null if the user is an owner.
   */
  async getTeamMembership(userId: string): Promise<{
    id: string;
    ownerId: string;
    role: "admin" | "member";
    accessAllProjects: boolean;
  } | null> {
    // The app assumes a user belongs to at most one owner's team. If they ever
    // hold multiple accepted memberships we pick the earliest deterministically
    // (rather than relying on storage order) so role/access resolution is stable.
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, "accepted"),
        ),
      )
      .orderBy(teamMembers.acceptedAt)
      .limit(1);

    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      ownerId: rows[0].ownerId,
      role: rows[0].role as "admin" | "member",
      accessAllProjects: rows[0].accessAllProjects,
    };
  }

  /**
   * Resolves the effective userId for billing purposes.
   * If the user is a team member, returns the owner's userId.
   * Otherwise returns the user's own userId.
   */
  async getEffectiveUserId(userId: string): Promise<string> {
    const membership = await this.getTeamMembership(userId);
    return membership ? membership.ownerId : userId;
  }

  async getSeatCount(ownerId: string): Promise<number> {
    const members = await this.db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, ownerId),
          or(
            eq(teamMembers.status, "accepted"),
            eq(teamMembers.status, "pending"),
          ),
        ),
      );
    // +1 for the owner themselves
    return members.length + 1;
  }

  // ─── Project Access ─────────────────────────────────────────────────────────

  /** Project ids a scoped member has been granted access to. */
  async getMemberProjectIds(teamMemberId: string): Promise<string[]> {
    const rows = await this.db
      .select({ projectId: teamMemberProjects.projectId })
      .from(teamMemberProjects)
      .where(eq(teamMemberProjects.teamMemberId, teamMemberId));
    return rows.map((r) => r.projectId);
  }

  /** Whether a scoped member has explicit access to a single project. */
  async memberHasProjectAccess(
    teamMemberId: string,
    projectId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: teamMemberProjects.id })
      .from(teamMemberProjects)
      .where(
        and(
          eq(teamMemberProjects.teamMemberId, teamMemberId),
          eq(teamMemberProjects.projectId, projectId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Map of memberId -> granted projectIds for every member under an owner.
   * Used to decorate the team list without an N+1 query.
   */
  async getMemberProjectMap(
    ownerId: string,
  ): Promise<Record<string, string[]>> {
    const rows = await this.db
      .select({
        teamMemberId: teamMemberProjects.teamMemberId,
        projectId: teamMemberProjects.projectId,
      })
      .from(teamMemberProjects)
      .innerJoin(
        teamMembers,
        eq(teamMemberProjects.teamMemberId, teamMembers.id),
      )
      .where(eq(teamMembers.ownerId, ownerId));

    const map: Record<string, string[]> = {};
    for (const row of rows) {
      (map[row.teamMemberId] ??= []).push(row.projectId);
    }
    return map;
  }

  /** Narrow a list of project ids to those actually owned by the owner. */
  async filterOwnedProjectIds(
    ownerId: string,
    projectIds: string[],
  ): Promise<string[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.userId, ownerId),
          inArray(projects.id, projectIds),
        ),
      );
    return rows.map((r) => r.id);
  }

  /**
   * Statements that replace a member's project grants (delete existing, then
   * insert the new set). Returned rather than executed so callers can commit
   * them atomically alongside the member-row write via `runBatch`.
   */
  private memberProjectStatements(
    teamMemberId: string,
    projectIds: string[],
  ): unknown[] {
    const statements: unknown[] = [
      this.db
        .delete(teamMemberProjects)
        .where(eq(teamMemberProjects.teamMemberId, teamMemberId)),
    ];
    if (projectIds.length > 0) {
      statements.push(
        this.db.insert(teamMemberProjects).values(
          projectIds.map((projectId) => ({
            id: crypto.randomUUID(),
            teamMemberId,
            projectId,
          })),
        ),
      );
    }
    return statements;
  }

  /** Run statements transactionally in a single D1 batch. */
  private async runBatch(statements: unknown[]): Promise<void> {
    await this.db.batch(
      statements as unknown as Parameters<typeof this.db.batch>[0],
    );
  }

  /**
   * Update a member's project-access scope. `projectIds` must already be
   * filtered to projects owned by `ownerId`. When `accessAllProjects` is true
   * (or the member is an admin) the per-project rows are cleared. The flag and
   * the join rows are committed atomically so they can't drift apart.
   */
  async setMemberProjectAccess(
    ownerId: string,
    memberId: string,
    accessAllProjects: boolean,
    projectIds: string[],
  ): Promise<void> {
    const member = await this.getMemberById(memberId);
    if (!member || member.ownerId !== ownerId) {
      throw new Error("Member not found");
    }

    const allAccess = accessAllProjects || member.role === "admin";

    await this.runBatch([
      this.db
        .update(teamMembers)
        .set({ accessAllProjects: allAccess })
        .where(eq(teamMembers.id, memberId)),
      ...this.memberProjectStatements(memberId, allAccess ? [] : projectIds),
    ]);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  async inviteMember(
    ownerId: string,
    email: string,
    role: "admin" | "member",
    accessAllProjects = true,
    projectIds: string[] = [],
  ): Promise<TeamMemberRow> {
    // Check if already invited/accepted
    const existing = await this.getInviteByEmail(ownerId, email);
    if (existing && existing.status !== "revoked") {
      throw new Error("This email has already been invited");
    }

    // Check if inviting themselves
    const ownerRows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    if (ownerRows[0]?.email === email) {
      throw new Error("You cannot invite yourself");
    }

    // Admins always have account-wide access.
    const allAccess = accessAllProjects || role === "admin";
    const scopedProjectIds = allAccess ? [] : projectIds;

    const id = existing?.status === "revoked" ? existing.id : crypto.randomUUID();

    // Re-invite a previously revoked member, otherwise create a fresh row. The
    // member write and its project grants are committed atomically.
    const memberStatement =
      existing && existing.status === "revoked"
        ? this.db
            .update(teamMembers)
            .set({
              role,
              status: "pending",
              userId: null,
              acceptedAt: null,
              accessAllProjects: allAccess,
            })
            .where(eq(teamMembers.id, existing.id))
        : this.db.insert(teamMembers).values({
            id,
            ownerId,
            email,
            role,
            status: "pending",
            accessAllProjects: allAccess,
          });

    await this.runBatch([
      memberStatement,
      ...this.memberProjectStatements(id, scopedProjectIds),
    ]);

    return (await this.getMemberById(id))!;
  }

  async acceptInvite(inviteId: string, userId: string, userEmail: string): Promise<void> {
    const invite = await this.getMemberById(inviteId);
    if (!invite) throw new Error("Invite not found");
    if (invite.email !== userEmail) throw new Error("This invite is for a different email");

    // Idempotent: if the invite is already accepted by this same user, treat
    // as success so concurrent accept calls (React StrictMode, retries, etc.)
    // don't flip the UI into an error state.
    if (invite.status === "accepted") {
      if (invite.userId === userId) return;
      throw new Error("Invite is no longer valid");
    }

    if (invite.status !== "pending") throw new Error("Invite is no longer valid");

    await this.db
      .update(teamMembers)
      .set({
        userId,
        status: "accepted",
        acceptedAt: new Date(),
      })
      .where(eq(teamMembers.id, inviteId));
  }

  async revokeMember(ownerId: string, memberId: string): Promise<void> {
    const member = await this.getMemberById(memberId);
    if (!member || member.ownerId !== ownerId) {
      throw new Error("Member not found");
    }

    await this.db
      .update(teamMembers)
      .set({ status: "revoked" })
      .where(eq(teamMembers.id, memberId));
  }

  async updateMemberRole(
    ownerId: string,
    memberId: string,
    role: "admin" | "member",
  ): Promise<TeamMemberRow> {
    const member = await this.getMemberById(memberId);
    if (!member || member.ownerId !== ownerId) {
      throw new Error("Member not found");
    }

    // Promoting to admin grants account-wide access and clears any scoping.
    // Demoting admin -> member only changes the role: the member keeps whatever
    // access they had (admins are accessAllProjects, so a demoted admin stays
    // all-projects until the owner explicitly scopes them via the access UI).
    if (role === "admin") {
      await this.runBatch([
        this.db
          .update(teamMembers)
          .set({ role, accessAllProjects: true })
          .where(eq(teamMembers.id, memberId)),
        ...this.memberProjectStatements(memberId, []),
      ]);
    } else {
      await this.db
        .update(teamMembers)
        .set({ role })
        .where(eq(teamMembers.id, memberId));
    }

    return (await this.getMemberById(memberId))!;
  }
}
