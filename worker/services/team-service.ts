import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, or } from "drizzle-orm";
import {
  teamMembers,
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
   * For a given userId, check if they are a team member of someone else's account.
   * Returns the team membership if found (ownerId + role), null if the user is an owner.
   */
  async getTeamMembership(
    userId: string,
  ): Promise<{ ownerId: string; role: "admin" | "member" } | null> {
    const rows = await this.db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.status, "accepted"),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    return {
      ownerId: rows[0].ownerId,
      role: rows[0].role as "admin" | "member",
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

  // ─── Mutations ────────────────────────────────────────────────────────────

  async inviteMember(
    ownerId: string,
    email: string,
    role: "admin" | "member",
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

    const id = crypto.randomUUID();

    if (existing && existing.status === "revoked") {
      // Re-invite a previously revoked member
      await this.db
        .update(teamMembers)
        .set({
          role,
          status: "pending",
          userId: null,
          acceptedAt: null,
        })
        .where(eq(teamMembers.id, existing.id));
      return (await this.getMemberById(existing.id))!;
    }

    await this.db.insert(teamMembers).values({
      id,
      ownerId,
      email,
      role,
      status: "pending",
    });

    return (await this.getMemberById(id))!;
  }

  async acceptInvite(inviteId: string, userId: string, userEmail: string): Promise<void> {
    const invite = await this.getMemberById(inviteId);
    if (!invite) throw new Error("Invite not found");
    if (invite.status !== "pending") throw new Error("Invite is no longer valid");
    if (invite.email !== userEmail) throw new Error("This invite is for a different email");

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

    await this.db
      .update(teamMembers)
      .set({ role })
      .where(eq(teamMembers.id, memberId));

    return (await this.getMemberById(memberId))!;
  }
}
