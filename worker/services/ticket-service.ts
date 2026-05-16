import { type DrizzleD1Database } from "drizzle-orm/d1";
import {
  eq,
  and,
  asc,
  desc,
  inArray,
  or,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  tickets,
  ticketConfig,
  projects,
  teamMembers,
  type TicketRow,
  type TicketConfigRow,
} from "../db";
import { users } from "../db/auth.schema";

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
}

export interface ResolvedAssignee {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface EnrichedTicket extends TicketRow {
  data: string; // still JSON string at row level — callers parse via parseTicketData
  assignee: ResolvedAssignee | null;
}

export interface TicketListOptions {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  assigneeId?: string;
  unassigned?: boolean;
  q?: string;
  sortBy?: "createdAt" | "updatedAt" | "dueDate" | "priority" | "status";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function parseTicketData(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") {
        result[key] = value;
      } else if (value != null) {
        result[key] = String(value);
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function buildTicketTitle(options: {
  visitorName?: string | null;
  visitorEmail?: string | null;
  visitorId?: string | null;
}): string {
  const visitorName = options.visitorName?.trim() ?? "";
  const visitorEmail = options.visitorEmail?.trim() ?? "";
  const visitorId = options.visitorId?.trim() ?? "";

  if (visitorName && visitorEmail) {
    return `${visitorName} <${visitorEmail}>`;
  }
  if (visitorName) return visitorName;
  if (visitorEmail) return visitorEmail;
  if (visitorId) return `Visitor ${visitorId}`;
  return "Ticket";
}

// Priority sort order — used when sortBy = "priority" to get a sensible ordering.
const PRIORITY_RANK_SQL = sql`CASE ${tickets.priority}
  WHEN 'urgent' THEN 4
  WHEN 'high' THEN 3
  WHEN 'medium' THEN 2
  WHEN 'low' THEN 1
  ELSE 0 END`;

// Status sort order — open first, then in_progress, resolved, closed.
const STATUS_RANK_SQL = sql`CASE ${tickets.status}
  WHEN 'open' THEN 4
  WHEN 'in_progress' THEN 3
  WHEN 'resolved' THEN 2
  WHEN 'closed' THEN 1
  ELSE 0 END`;

export class TicketService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Config ───────────────────────────────────────────────────────────────

  async getConfig(projectId: string): Promise<TicketConfigRow | null> {
    const rows = await this.db
      .select()
      .from(ticketConfig)
      .where(eq(ticketConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertConfig(
    projectId: string,
    updates: {
      enabled?: boolean;
      description?: string | null;
      fields?: Array<{ label: string; type: string; required: boolean }>;
    },
  ): Promise<TicketConfigRow> {
    const existing = await this.getConfig(projectId);

    if (existing) {
      const setData: Record<string, unknown> = {};
      if (updates.enabled !== undefined) setData.enabled = updates.enabled;
      if (updates.description !== undefined)
        setData.description = updates.description;
      if (updates.fields !== undefined)
        setData.fields = JSON.stringify(updates.fields);

      await this.db
        .update(ticketConfig)
        .set(setData)
        .where(eq(ticketConfig.projectId, projectId));

      return (await this.getConfig(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(ticketConfig).values({
      id,
      projectId,
      enabled: updates.enabled ?? false,
      description:
        updates.description ?? "We'll get back to you within 1-2 hours.",
      fields: updates.fields ? JSON.stringify(updates.fields) : "[]",
    });
    return (await this.getConfig(projectId))!;
  }

  // ─── Tickets CRUD ─────────────────────────────────────────────────────────

  async createTicket(options: {
    projectId: string;
    conversationId?: string | null;
    visitorId?: string;
    title: string;
    data: Record<string, string>;
    appendMode?: boolean;
  }): Promise<{ ticket: TicketRow; created: boolean; appended: boolean }> {
    if (options.conversationId) {
      const existing = await this.getTicketByConversationId(
        options.projectId,
        options.conversationId,
      );
      if (existing) {
        const mergedData = options.appendMode
          ? { ...parseTicketData(existing.data), ...options.data }
          : options.data;

        await this.db
          .update(tickets)
          .set({
            visitorId: options.visitorId ?? existing.visitorId,
            title: options.title,
            data: JSON.stringify(mergedData),
          })
          .where(eq(tickets.id, existing.id));

        return {
          ticket: (await this.getTicketById(existing.id, options.projectId))!,
          created: false,
          appended: Boolean(options.appendMode),
        };
      }
    }

    const id = crypto.randomUUID();
    await this.db.insert(tickets).values({
      id,
      projectId: options.projectId,
      conversationId: options.conversationId ?? null,
      visitorId: options.visitorId ?? null,
      title: options.title,
      data: JSON.stringify(options.data),
    });

    return {
      ticket: (await this.getTicketById(id, options.projectId))!,
      created: true,
      appended: false,
    };
  }

  async getTickets(
    projectId: string,
    opts: TicketListOptions = {},
  ): Promise<TicketRow[]> {
    const filters: SQL[] = [eq(tickets.projectId, projectId)];
    if (opts.status?.length) {
      filters.push(inArray(tickets.status, opts.status));
    }
    if (opts.priority?.length) {
      filters.push(inArray(tickets.priority, opts.priority));
    }
    if (opts.unassigned) {
      filters.push(isNull(tickets.assigneeId));
    } else if (opts.assigneeId) {
      filters.push(eq(tickets.assigneeId, opts.assigneeId));
    }
    if (opts.q) {
      const needle = `%${opts.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
      // Search across title + serialized data JSON. SQLite's LIKE ignores the
      // backslash escape unless ESCAPE is set, so use a raw sql fragment.
      const qFilter = or(
        sql`${tickets.title} LIKE ${needle} ESCAPE '\\'`,
        sql`${tickets.data} LIKE ${needle} ESCAPE '\\'`,
      );
      if (qFilter) filters.push(qFilter);
    }

    const sortDir = opts.sortDir ?? "desc";
    const dirFn = sortDir === "asc" ? asc : desc;
    const sortExpr =
      opts.sortBy === "updatedAt"
        ? dirFn(tickets.updatedAt)
        : opts.sortBy === "dueDate"
          ? dirFn(tickets.dueDate)
          : opts.sortBy === "priority"
            ? dirFn(PRIORITY_RANK_SQL)
            : opts.sortBy === "status"
              ? dirFn(STATUS_RANK_SQL)
              : dirFn(tickets.createdAt);

    let q = this.db
      .select()
      .from(tickets)
      .where(and(...filters))
      .orderBy(sortExpr)
      .$dynamic();

    if (opts.limit != null) q = q.limit(opts.limit);
    if (opts.offset != null) q = q.offset(opts.offset);

    return q;
  }

  async getTicketsWithAssignees(
    projectId: string,
    opts: TicketListOptions = {},
  ): Promise<EnrichedTicket[]> {
    const rows = await this.getTickets(projectId, opts);
    if (rows.length === 0) return [];

    const assigneeIds = Array.from(
      new Set(
        rows
          .map((r) => r.assigneeId)
          .filter((v): v is string => Boolean(v)),
      ),
    );

    const assigneeMap = new Map<string, ResolvedAssignee>();
    if (assigneeIds.length > 0) {
      const assigneeRows = await this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          profilePicture: users.profilePicture,
        })
        .from(users)
        .where(inArray(users.id, assigneeIds));

      for (const u of assigneeRows) {
        assigneeMap.set(u.id, {
          id: u.id,
          name: u.name,
          email: u.email,
          image: u.profilePicture ?? u.image,
        });
      }
    }

    return rows.map((row) => ({
      ...row,
      assignee: row.assigneeId
        ? assigneeMap.get(row.assigneeId) ?? null
        : null,
    }));
  }

  async getTicketById(
    id: string,
    projectId: string,
  ): Promise<TicketRow | null> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);
    if (!rows[0] || rows[0].projectId !== projectId) return null;
    return rows[0];
  }

  async getTicketByIdWithAssignee(
    id: string,
    projectId: string,
  ): Promise<EnrichedTicket | null> {
    const row = await this.getTicketById(id, projectId);
    if (!row) return null;
    if (!row.assigneeId) return { ...row, assignee: null };
    const assigneeRows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        profilePicture: users.profilePicture,
      })
      .from(users)
      .where(eq(users.id, row.assigneeId))
      .limit(1);
    const a = assigneeRows[0];
    return {
      ...row,
      assignee: a
        ? {
            id: a.id,
            name: a.name,
            email: a.email,
            image: a.profilePicture ?? a.image,
          }
        : null,
    };
  }

  async getTicketByConversationId(
    projectId: string,
    conversationId: string,
  ): Promise<TicketRow | null> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.projectId, projectId),
          eq(tickets.conversationId, conversationId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── Updates ──────────────────────────────────────────────────────────────

  async updateTicket(
    id: string,
    projectId: string,
    patch: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: string | null;
      dueDate?: Date | null;
    },
  ): Promise<TicketRow | null> {
    const existing = await this.getTicketById(id, projectId);
    if (!existing) return null;

    if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
      const assignable = await this.getAssignableUserIds(projectId);
      if (!assignable.has(patch.assigneeId)) {
        throw new Error("ASSIGNEE_NOT_ALLOWED");
      }
    }

    const setData: Record<string, unknown> = {};
    if (patch.status !== undefined) setData.status = patch.status;
    if (patch.priority !== undefined) setData.priority = patch.priority;
    if (patch.assigneeId !== undefined) setData.assigneeId = patch.assigneeId;
    if (patch.dueDate !== undefined) setData.dueDate = patch.dueDate;

    if (Object.keys(setData).length === 0) return existing;

    await this.db.update(tickets).set(setData).where(eq(tickets.id, id));
    return this.getTicketById(id, projectId);
  }

  async updateTicketStatus(
    id: string,
    projectId: string,
    status: TicketStatus,
  ): Promise<TicketRow | null> {
    return this.updateTicket(id, projectId, { status });
  }

  async bulkUpdateTicketStatus(
    ids: string[],
    projectId: string,
    status: TicketStatus,
  ): Promise<number> {
    await this.db
      .update(tickets)
      .set({ status })
      .where(and(inArray(tickets.id, ids), eq(tickets.projectId, projectId)));
    return ids.length;
  }

  // ─── Assignable users (owner + accepted team members) ────────────────────

  async getAssignableUsers(projectId: string): Promise<AssignableUser[]> {
    const projRows = await this.db
      .select({ id: projects.id, userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const proj = projRows[0];
    if (!proj) return [];

    // Owner
    const ownerRows = await this.db
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
    const memberRows = await this.db
      .select({
        userId: teamMembers.userId,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.ownerId, proj.userId),
          eq(teamMembers.status, "accepted"),
        ),
      );

    const memberUserIds = memberRows
      .map((m) => m.userId)
      .filter((v): v is string => Boolean(v));

    if (memberUserIds.length > 0) {
      const memberUserRows = await this.db
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
        memberRows
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

  async getAssignableUserIds(projectId: string): Promise<Set<string>> {
    const list = await this.getAssignableUsers(projectId);
    return new Set(list.map((u) => u.id));
  }
}
