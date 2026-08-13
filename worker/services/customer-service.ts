import {
  and,
  desc,
  eq,
  exists,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import type {
  CustomerConversationDto,
  CustomerDetail,
  CustomerFieldValue,
  CustomerInput,
  CustomerListItem,
  CustomerListResult,
  CustomerVisitorDto,
  UpdateCustomerInput,
} from "../../shared/customer-types";
import type { PublicConversationRecord } from "../../shared/maven-conversation";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import {
  customerVisitors,
  customers,
  type CustomerRow,
} from "../db";

export interface CustomerCursor {
  updatedAt: number;
  id: string;
}

export interface CustomerListOptions {
  query?: string;
  cursor?: string;
  limit: number;
}

export interface DeleteCustomerResult {
  customerId: string;
  conversationIds: string[];
}

interface CustomerListRow {
  customer: CustomerRow;
  conversationCount: number;
}

function encodeBase64Url(value: string): string {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return atob(normalized + "=".repeat(paddingLength));
}

export function encodeCustomerCursor(cursor: CustomerCursor): string {
  return encodeBase64Url(JSON.stringify(cursor));
}

export function decodeCustomerCursor(cursor: string): CustomerCursor | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(cursor)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.updatedAt) ||
      typeof value.id !== "string" ||
      value.id.length === 0
    ) {
      return null;
    }
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    return null;
  }
}

export function buildCustomerByIdQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
  customerId: string,
) {
  return db
    .select()
    .from(customers)
    .where(and(eq(customers.projectId, projectId), eq(customers.id, customerId)))
    .limit(1);
}

export function buildCustomerListQuery(
  db: DrizzleD1Database<Record<string, unknown>>,
  projectId: string,
  options: CustomerListOptions,
) {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const cursor = options.cursor ? decodeCustomerCursor(options.cursor) : null;
  const trimmedQuery = options.query?.trim().toLowerCase();
  const conditions = [eq(customers.projectId, projectId)];

  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;
    conditions.push(
      or(
        like(sql`LOWER(${customers.name})`, pattern),
        like(sql`LOWER(${customers.email})`, pattern),
        like(sql`LOWER(${customers.externalId})`, pattern),
        exists(
          db
            .select({ value: customerVisitors.id })
            .from(customerVisitors)
            .where(
              and(
                eq(customerVisitors.projectId, projectId),
                eq(customerVisitors.customerId, customers.id),
                like(sql`LOWER(${customerVisitors.visitorId})`, pattern),
              ),
            ),
        ),
      )!,
    );
  }

  if (cursor) {
    const cursorDate = new Date(cursor.updatedAt);
    conditions.push(
      or(
        lt(customers.updatedAt, cursorDate),
        and(eq(customers.updatedAt, cursorDate), lt(customers.id, cursor.id)),
      )!,
    );
  }

  return db
    .select({
      customer: customers,
    })
    .from(customers)
    .where(and(...conditions))
    .orderBy(desc(customers.updatedAt), desc(customers.id))
    .limit(limit + 1);
}

function isCustomerFieldValue(value: unknown): value is CustomerFieldValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function parseCustomFields(value: string): Record<string, CustomerFieldValue> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed);
    if (!entries.every(([, fieldValue]) => isCustomerFieldValue(fieldValue))) {
      return {};
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function mapCustomerListItem(row: CustomerListRow): CustomerListItem {
  return {
    id: row.customer.id,
    externalId: row.customer.externalId,
    name: row.customer.name,
    email: row.customer.email,
    phone: row.customer.phone,
    customFields: parseCustomFields(row.customer.customFields),
    conversationCount: Number(row.conversationCount),
    firstSeenAt: toIso(row.customer.firstSeenAt),
    lastSeenAt: toIso(row.customer.lastSeenAt),
    createdAt: row.customer.createdAt.toISOString(),
    updatedAt: row.customer.updatedAt.toISOString(),
  };
}

function mapVisitor(
  row: typeof customerVisitors.$inferSelect,
): CustomerVisitorDto {
  return {
    id: row.id,
    visitorId: row.visitorId,
    linkedBy: row.linkedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapConversation(row: PublicConversationRecord): CustomerConversationDto {
  return {
    id: row.id,
    visitorName: row.visitorName,
    visitorEmail: row.visitorEmail,
    status: row.status,
    closeReason: row.closeReason,
    lastActivityAt: new Date(row.lastActivityAt).toISOString(),
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export class CustomerService {
  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private conversationStore: PublicConversationStore,
  ) {}

  async listCustomers(
    projectId: string,
    options: CustomerListOptions,
  ): Promise<CustomerListResult> {
    const limit = Math.min(Math.max(options.limit, 1), 100);
    const rows = await buildCustomerListQuery(this.db, projectId, {
      ...options,
      limit,
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);
    const counts = await this.conversationStore.getConversationCountsByCustomer(
      projectId,
      pageRows.map((row) => row.customer.id),
    );
    return {
      customers: pageRows.map((row) =>
        mapCustomerListItem({
          ...row,
          conversationCount: counts.get(row.customer.id) ?? 0,
        }),
      ),
      nextCursor:
        hasMore && lastRow
          ? encodeCustomerCursor({
              updatedAt: lastRow.customer.updatedAt.getTime(),
              id: lastRow.customer.id,
            })
          : null,
    };
  }

  async getCustomerDetail(
    projectId: string,
    customerId: string,
  ): Promise<CustomerDetail | null> {
    const customerRows = await buildCustomerByIdQuery(
      this.db,
      projectId,
      customerId,
    );
    const customer = customerRows[0];
    if (!customer) return null;

    const [visitorRows, conversationRows] = await Promise.all([
      this.db
        .select()
        .from(customerVisitors)
        .where(
          and(
            eq(customerVisitors.projectId, projectId),
            eq(customerVisitors.customerId, customerId),
          ),
        )
        .orderBy(desc(customerVisitors.createdAt)),
      this.conversationStore.listByCustomer(projectId, customerId),
    ]);

    return {
      ...mapCustomerListItem({
        customer,
        conversationCount: conversationRows.length,
      }),
      visitors: visitorRows.map(mapVisitor),
      conversations: conversationRows.map(mapConversation),
    };
  }

  async insertCustomerProfile(
    projectId: string,
    input: CustomerInput,
  ): Promise<CustomerDetail> {
    const id = crypto.randomUUID();
    await this.db.insert(customers).values({
      id,
      projectId,
      externalId: input.externalId ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      customFields: JSON.stringify(input.customFields),
    });
    const customer = await this.getCustomerDetail(projectId, id);
    if (!customer) throw new Error("Created customer could not be loaded");
    return customer;
  }

  async updateCustomerProfile(
    projectId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerDetail | null> {
    const updates: Partial<CustomerRow> = {};
    if (input.externalId !== undefined) updates.externalId = input.externalId;
    if (input.name !== undefined) updates.name = input.name;
    if (input.email !== undefined) updates.email = input.email;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.customFields !== undefined) {
      updates.customFields = JSON.stringify(input.customFields);
    }

    if (Object.keys(updates).length > 0) {
      const rows = await this.db
        .update(customers)
        .set(updates)
        .where(
          and(
            eq(customers.projectId, projectId),
            eq(customers.id, customerId),
          ),
        )
        .returning({ id: customers.id });
      if (rows.length === 0) return null;
    }
    return this.getCustomerDetail(projectId, customerId);
  }

  async deleteCustomer(
    projectId: string,
    customerId: string,
  ): Promise<DeleteCustomerResult | null> {
    const [customerRows, conversationRows] = await Promise.all([
      this.db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.projectId, projectId), eq(customers.id, customerId)),
        )
        .limit(1),
      this.conversationStore.listByCustomer(projectId, customerId),
    ]);
    if (customerRows.length === 0) return null;

    await this.db
      .delete(customers)
      .where(
        and(eq(customers.projectId, projectId), eq(customers.id, customerId)),
      );
    if (conversationRows.length > 0) {
      await this.conversationStore.applyCustomerMutation({
        projectId,
        mutationId: crypto.randomUUID(),
        updates: conversationRows.map((conversation) => ({
          conversationId: conversation.id,
          customerId: null,
        })),
      });
    }
    return {
      customerId,
      conversationIds: conversationRows.map((row) => row.id),
    };
  }
}
