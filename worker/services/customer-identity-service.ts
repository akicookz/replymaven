import { and, eq, exists, sql } from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import type {
  ConversationCustomerResponse,
  CustomerDetail,
  CustomerFieldValue,
  CustomerIdentityTokenPayload,
  CustomerInput,
  CustomerVisitorLinkSource,
  UpdateCustomerInput,
} from "../../shared/customer-types";
import type { PublicConversationRecord } from "../../shared/maven-conversation";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import {
  customers,
  customerVisitors,
  type CustomerRow,
  type CustomerVisitorRow,
} from "../db";
import {
  CustomerService,
  type DeleteCustomerResult,
} from "./customer-service";

export type CustomerResolution =
  | { kind: "none" }
  | { kind: "resolved"; customerId: string }
  | { kind: "conflict"; customerIds: [string, string] };

export type CreateCustomerResult =
  | { kind: "created"; customer: CustomerDetail }
  | { kind: "existing_customer"; customerId: string }
  | { kind: "conflict"; customerIds: [string, string] };

export type UpdateCustomerResult =
  | { kind: "updated"; customer: CustomerDetail }
  | { kind: "not_found" }
  | { kind: "conflict"; customerIds: [string, string] };

export type ConversationCustomerResult =
  | ({ kind: "linked" } & ConversationCustomerResponse)
  | { kind: "not_found" }
  | { kind: "conflict"; customerIds: [string, string] };

export type SignedVisitorIdentifyResult =
  | ({ kind: "linked" } & ConversationCustomerResponse)
  | { kind: "not_found" }
  | { kind: "conflict"; customerIds?: [string, string] };

export type MergeCustomerResult =
  | {
      kind: "merged";
      customerId: string;
      conversationIds: string[];
    }
  | { kind: "not_found" };

interface CustomerLookupInput {
  externalId?: string | null;
  email?: string | null;
}

function parseCustomFields(value: string): Record<string, CustomerFieldValue> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, CustomerFieldValue>;
  } catch {
    return {};
  }
}

function earliestDate(values: Date[]): Date {
  return new Date(Math.min(...values.map((value) => value.getTime())));
}

function latestDate(values: Date[]): Date {
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizeExternalId(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    error.message.toLowerCase().includes("unique constraint")
  );
}

export function normalizeCustomerEmail(
  value: string | null | undefined,
): string | null {
  return value?.trim().toLowerCase() || null;
}

export class CustomerIdentityService {
  private customerService: CustomerService;

  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private conversationStore: PublicConversationStore,
  ) {
    this.customerService = new CustomerService(db, conversationStore);
  }

  private async executeBatch(queries: unknown[]): Promise<void> {
    if (queries.length === 0) return;
    await this.db.batch(
      queries as unknown as Parameters<typeof this.db.batch>[0],
    );
  }

  private async getCustomerRow(
    projectId: string,
    customerId: string,
  ): Promise<CustomerRow | null> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.projectId, projectId), eq(customers.id, customerId)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findCustomerByExternalId(
    projectId: string,
    externalId: string,
  ): Promise<CustomerRow | null> {
    const normalized = normalizeExternalId(externalId);
    if (!normalized) return null;
    const rows = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.projectId, projectId),
          eq(customers.externalId, normalized),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findCustomerByEmail(
    projectId: string,
    email: string,
  ): Promise<CustomerRow | null> {
    const normalized = normalizeCustomerEmail(email);
    if (!normalized) return null;
    const rows = await this.db
      .select()
      .from(customers)
      .where(
        and(eq(customers.projectId, projectId), eq(customers.email, normalized)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<CustomerVisitorRow | null> {
    const rows = await this.db
      .select()
      .from(customerVisitors)
      .where(
        and(
          eq(customerVisitors.projectId, projectId),
          eq(customerVisitors.visitorId, visitorId.trim()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findInputConflict(
    projectId: string,
    customerId: string,
    input: CustomerLookupInput,
  ): Promise<CustomerRow | null> {
    const [externalOwner, emailOwner] = await Promise.all([
      input.externalId
        ? this.findCustomerByExternalId(projectId, input.externalId)
        : Promise.resolve(null),
      input.email
        ? this.findCustomerByEmail(projectId, input.email)
        : Promise.resolve(null),
    ]);
    return (
      [externalOwner, emailOwner].find(
        (customer) => customer && customer.id !== customerId,
      ) ?? null
    );
  }

  private async getConversation(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    return this.conversationStore.get(projectId, conversationId);
  }

  private async getVisitorConversations(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord[]> {
    const rows = await this.conversationStore.listByVisitor(
      projectId,
      visitorId,
    );
    return rows.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }

  async resolveCustomer(
    projectId: string,
    lookup: CustomerLookupInput,
  ): Promise<CustomerResolution> {
    const [externalCustomer, emailCustomer] = await Promise.all([
      lookup.externalId
        ? this.findCustomerByExternalId(projectId, lookup.externalId)
        : Promise.resolve(null),
      lookup.email
        ? this.findCustomerByEmail(projectId, lookup.email)
        : Promise.resolve(null),
    ]);

    if (
      externalCustomer &&
      emailCustomer &&
      externalCustomer.id !== emailCustomer.id
    ) {
      return {
        kind: "conflict",
        customerIds: [externalCustomer.id, emailCustomer.id],
      };
    }
    const customer = externalCustomer ?? emailCustomer;
    return customer
      ? { kind: "resolved", customerId: customer.id }
      : { kind: "none" };
  }

  async createCustomer(
    projectId: string,
    input: CustomerInput,
  ): Promise<CreateCustomerResult> {
    const resolution = await this.resolveCustomer(projectId, input);
    if (resolution.kind === "conflict") return resolution;
    if (resolution.kind === "resolved") {
      return { kind: "existing_customer", customerId: resolution.customerId };
    }

    const customerId = crypto.randomUUID();
    try {
      await this.db.insert(customers).values({
        id: customerId,
        projectId,
        externalId: normalizeExternalId(input.externalId),
        name: normalizeOptionalText(input.name),
        email: normalizeCustomerEmail(input.email),
        phone: normalizeOptionalText(input.phone),
        customFields: JSON.stringify(input.customFields),
        firstSeenAt: null,
        lastSeenAt: null,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrentResolution = await this.resolveCustomer(projectId, input);
      if (concurrentResolution.kind === "conflict") return concurrentResolution;
      if (concurrentResolution.kind === "resolved") {
        return {
          kind: "existing_customer",
          customerId: concurrentResolution.customerId,
        };
      }
      throw error;
    }
    const customer = await this.customerService.getCustomerDetail(
      projectId,
      customerId,
    );
    if (!customer) throw new Error("Created customer could not be loaded");
    return { kind: "created", customer };
  }

  async updateCustomer(
    projectId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<UpdateCustomerResult> {
    const existingCustomer = await this.getCustomerRow(projectId, customerId);
    if (!existingCustomer) return { kind: "not_found" };

    const conflictingOwner = await this.findInputConflict(
      projectId,
      customerId,
      input,
    );
    if (conflictingOwner) {
      return {
        kind: "conflict",
        customerIds: [customerId, conflictingOwner.id],
      };
    }

    const updates: Partial<CustomerRow> = {};
    if (input.externalId !== undefined) {
      updates.externalId = normalizeExternalId(input.externalId);
    }
    if (input.name !== undefined) updates.name = normalizeOptionalText(input.name);
    if (input.email !== undefined) {
      updates.email = normalizeCustomerEmail(input.email);
    }
    if (input.phone !== undefined) {
      updates.phone = normalizeOptionalText(input.phone);
    }
    if (input.customFields !== undefined) {
      updates.customFields = JSON.stringify(input.customFields);
    }

    if (Object.keys(updates).length > 0) {
      try {
        await this.db
          .update(customers)
          .set(updates)
          .where(
            and(eq(customers.projectId, projectId), eq(customers.id, customerId)),
          );
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const concurrentOwner = await this.findInputConflict(
          projectId,
          customerId,
          input,
        );
        if (concurrentOwner) {
          return {
            kind: "conflict",
            customerIds: [customerId, concurrentOwner.id],
          };
        }
        throw error;
      }
    }
    const customer = await this.customerService.getCustomerDetail(
      projectId,
      customerId,
    );
    return customer ? { kind: "updated", customer } : { kind: "not_found" };
  }

  async deleteCustomer(
    projectId: string,
    customerId: string,
  ): Promise<DeleteCustomerResult | null> {
    return this.customerService.deleteCustomer(projectId, customerId);
  }

  async findCustomerByVisitorId(
    projectId: string,
    visitorId: string,
  ): Promise<CustomerRow | null> {
    const rows = await this.db
      .select({ customer: customers })
      .from(customerVisitors)
      .innerJoin(
        customers,
        and(
          eq(customers.projectId, customerVisitors.projectId),
          eq(customers.id, customerVisitors.customerId),
        ),
      )
      .where(
        and(
          eq(customerVisitors.projectId, projectId),
          eq(customerVisitors.visitorId, visitorId.trim()),
        ),
      )
      .limit(1);
    return rows[0]?.customer ?? null;
  }

  async touchVisitorLastSeen(
    projectId: string,
    customerId: string,
    visitorId: string,
    occurredAt: Date,
  ): Promise<void> {
    const occurredAtSeconds = Math.floor(occurredAt.getTime() / 1000);
    await this.db
      .update(customers)
      .set({
        firstSeenAt: sql`CASE
          WHEN ${customers.firstSeenAt} IS NULL
            OR ${customers.firstSeenAt} > ${occurredAtSeconds}
          THEN ${occurredAtSeconds}
          ELSE ${customers.firstSeenAt}
        END`,
        lastSeenAt: sql`CASE
          WHEN ${customers.lastSeenAt} IS NULL
            OR ${customers.lastSeenAt} < ${occurredAtSeconds}
          THEN ${occurredAtSeconds}
          ELSE ${customers.lastSeenAt}
        END`,
      })
      .where(
        and(
          eq(customers.projectId, projectId),
          eq(customers.id, customerId),
          exists(
            this.db
              .select({ id: customerVisitors.id })
              .from(customerVisitors)
              .where(
                and(
                  eq(customerVisitors.projectId, projectId),
                  eq(customerVisitors.customerId, customerId),
                  eq(customerVisitors.visitorId, visitorId.trim()),
                ),
              ),
          ),
        ),
      );
  }

  private async attachVisitor(
    projectId: string,
    conversation: PublicConversationRecord,
    customer: CustomerRow,
    linkedBy: CustomerVisitorLinkSource,
    extraQueries: unknown[] = [],
  ): Promise<ConversationCustomerResult> {
    return this.attachVisitorId(
      projectId,
      conversation.visitorId,
      customer,
      linkedBy,
      extraQueries,
    );
  }

  private async attachVisitorId(
    projectId: string,
    visitorId: string,
    customer: CustomerRow,
    linkedBy: CustomerVisitorLinkSource,
    extraQueries: unknown[] = [],
  ): Promise<ConversationCustomerResult> {
    const visitor = await this.findVisitor(projectId, visitorId);
    if (visitor && visitor.customerId !== customer.id) {
      return {
        kind: "conflict",
        customerIds: [customer.id, visitor.customerId],
      };
    }

    const visitorConversations = await this.getVisitorConversations(
      projectId,
      visitorId,
    );
    const conflictingConversation = visitorConversations.find(
      (row) => row.customerId !== null && row.customerId !== customer.id,
    );
    if (conflictingConversation?.customerId) {
      return {
        kind: "conflict",
        customerIds: [customer.id, conflictingConversation.customerId],
      };
    }

    const changedConversationIds = visitorConversations
      .filter((row) => row.customerId !== customer.id)
      .map((row) => row.id);
    const firstSeenAt = visitorConversations.length
      ? earliestDate(
          visitorConversations.map((row) => new Date(row.createdAt)),
        )
      : null;
    const lastSeenAt = visitorConversations.length
      ? latestDate(
          visitorConversations.map((row) => new Date(row.lastActivityAt)),
        )
      : null;
    const queries: unknown[] = [...extraQueries];

    if (firstSeenAt && lastSeenAt) {
      const firstSeenAtSeconds = Math.floor(firstSeenAt.getTime() / 1000);
      const lastSeenAtSeconds = Math.floor(lastSeenAt.getTime() / 1000);
      queries.push(
        this.db
          .update(customers)
          .set({
            firstSeenAt: sql`CASE
              WHEN ${customers.firstSeenAt} IS NULL
                OR ${customers.firstSeenAt} > ${firstSeenAtSeconds}
              THEN ${firstSeenAtSeconds}
              ELSE ${customers.firstSeenAt}
            END`,
            lastSeenAt: sql`CASE
              WHEN ${customers.lastSeenAt} IS NULL
                OR ${customers.lastSeenAt} < ${lastSeenAtSeconds}
              THEN ${lastSeenAtSeconds}
              ELSE ${customers.lastSeenAt}
            END`,
          })
          .where(
            and(
              eq(customers.projectId, projectId),
              eq(customers.id, customer.id),
            ),
          ),
      );
    }
    if (!visitor) {
      queries.push(
        this.db.insert(customerVisitors).values({
          id: crypto.randomUUID(),
          projectId,
          customerId: customer.id,
          visitorId: visitorId.trim(),
          linkedBy,
        }),
      );
    }

    await this.executeBatch(queries);
    if (visitorConversations.length > 0) {
      await this.conversationStore.applyCustomerMutation({
        projectId,
        mutationId: crypto.randomUUID(),
        updates: visitorConversations.map((conversation) => ({
          conversationId: conversation.id,
          customerId: customer.id,
          ...(!conversation.visitorName && customer.name
            ? { visitorName: customer.name }
            : {}),
          ...(!conversation.visitorEmail && customer.email
            ? { visitorEmail: customer.email }
            : {}),
        })),
      });
    }
    const detail = await this.customerService.getCustomerDetail(
      projectId,
      customer.id,
    );
    if (!detail) return { kind: "not_found" };
    return {
      kind: "linked",
      customer: detail,
      conversationIds: changedConversationIds,
    };
  }

  async identifySignedVisitor(
    projectId: string,
    visitorId: string,
    payload: CustomerIdentityTokenPayload,
  ): Promise<SignedVisitorIdentifyResult> {
    return this.identifySignedVisitorOnce(projectId, visitorId, payload, true);
  }

  private async identifySignedVisitorOnce(
    projectId: string,
    visitorId: string,
    payload: CustomerIdentityTokenPayload,
    recoverUniqueConflict: boolean,
  ): Promise<SignedVisitorIdentifyResult> {
    if (payload.projectId !== projectId) return { kind: "not_found" };
    const resolution = await this.resolveCustomer(projectId, payload);
    if (resolution.kind === "conflict") return resolution;

    const visitor = await this.findVisitor(projectId, visitorId);
    if (
      resolution.kind === "resolved" &&
      visitor &&
      resolution.customerId !== visitor.customerId
    ) {
      return {
        kind: "conflict",
        customerIds: [resolution.customerId, visitor.customerId],
      };
    }
    if (resolution.kind === "none" && visitor) {
      return { kind: "conflict" };
    }

    const customerId =
      resolution.kind === "resolved"
        ? resolution.customerId
        : crypto.randomUUID();
    const existingCustomer = await this.getCustomerRow(projectId, customerId);
    const now = new Date();
    const customFields = {
      ...(existingCustomer ? parseCustomFields(existingCustomer.customFields) : {}),
      ...(payload.customFields ?? {}),
    };
    const finalExternalId =
      payload.externalId !== undefined
        ? normalizeExternalId(payload.externalId)
        : existingCustomer?.externalId ?? null;
    const finalName =
      payload.name !== undefined
        ? normalizeOptionalText(payload.name)
        : existingCustomer?.name ?? null;
    const finalEmail =
      payload.email !== undefined
        ? normalizeCustomerEmail(payload.email)
        : existingCustomer?.email ?? null;
    const finalPhone =
      payload.phone !== undefined
        ? normalizeOptionalText(payload.phone)
        : existingCustomer?.phone ?? null;
    const customerRow: CustomerRow =
      existingCustomer ?? {
        id: customerId,
        projectId,
        externalId: finalExternalId,
        name: finalName,
        email: finalEmail,
        phone: finalPhone,
        customFields: JSON.stringify(customFields),
        firstSeenAt: null,
        lastSeenAt: null,
        createdAt: now,
        updatedAt: now,
      };
    const profileValues = {
      externalId: finalExternalId,
      name: finalName,
      email: finalEmail,
      phone: finalPhone,
      customFields: JSON.stringify(customFields),
    };
    const profileQuery = existingCustomer
      ? this.db
          .update(customers)
          .set(profileValues)
          .where(
            and(eq(customers.projectId, projectId), eq(customers.id, customerId)),
          )
      : this.db.insert(customers).values({
          id: customerId,
          projectId,
          ...profileValues,
        });

    try {
      return await this.attachVisitorId(
        projectId,
        visitorId,
        { ...customerRow, ...profileValues },
        "signed_widget",
        [profileQuery],
      );
    } catch (error) {
      if (!recoverUniqueConflict || !isUniqueConstraintError(error)) throw error;
      return this.identifySignedVisitorOnce(
        projectId,
        visitorId,
        payload,
        false,
      );
    }
  }

  async mergeCustomers(
    projectId: string,
    targetCustomerId: string,
    sourceCustomerId: string,
  ): Promise<MergeCustomerResult> {
    if (targetCustomerId === sourceCustomerId) return { kind: "not_found" };
    const [target, source] = await Promise.all([
      this.getCustomerRow(projectId, targetCustomerId),
      this.getCustomerRow(projectId, sourceCustomerId),
    ]);
    if (!target || !source) return { kind: "not_found" };

    const sourceConversations = await this.conversationStore.listByCustomer(
      projectId,
      sourceCustomerId,
    );
    sourceConversations.sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
    const customFields = {
      ...parseCustomFields(source.customFields),
      ...parseCustomFields(target.customFields),
    };
    const firstSeenCandidates = [target.firstSeenAt, source.firstSeenAt].filter(
      (value): value is Date => value !== null,
    );
    const lastSeenCandidates = [target.lastSeenAt, source.lastSeenAt].filter(
      (value): value is Date => value !== null,
    );

    await this.executeBatch([
      this.db
        .update(customers)
        .set({ externalId: null, email: null })
        .where(
          and(
            eq(customers.projectId, projectId),
            eq(customers.id, sourceCustomerId),
          ),
        ),
      this.db
        .update(customers)
        .set({
          externalId: target.externalId ?? source.externalId,
          name: target.name?.trim() ? target.name : source.name,
          email: target.email?.trim() ? target.email : source.email,
          phone: target.phone?.trim() ? target.phone : source.phone,
          customFields: JSON.stringify(customFields),
          firstSeenAt: firstSeenCandidates.length
            ? earliestDate(firstSeenCandidates)
            : null,
          lastSeenAt: lastSeenCandidates.length
            ? latestDate(lastSeenCandidates)
            : null,
        })
        .where(
          and(
            eq(customers.projectId, projectId),
            eq(customers.id, targetCustomerId),
          ),
        ),
      this.db
        .update(customerVisitors)
        .set({ customerId: targetCustomerId })
        .where(
          and(
            eq(customerVisitors.projectId, projectId),
            eq(customerVisitors.customerId, sourceCustomerId),
          ),
        ),
      this.db
        .delete(customers)
        .where(
          and(
            eq(customers.projectId, projectId),
            eq(customers.id, sourceCustomerId),
          ),
        ),
    ]);
    if (sourceConversations.length > 0) {
      await this.conversationStore.applyCustomerMutation({
        projectId,
        mutationId: crypto.randomUUID(),
        updates: sourceConversations.map((conversation) => ({
          conversationId: conversation.id,
          customerId: targetCustomerId,
        })),
      });
    }
    return {
      kind: "merged",
      customerId: targetCustomerId,
      conversationIds: sourceConversations.map((conversation) => conversation.id),
    };
  }

  async linkConversation(
    projectId: string,
    conversationId: string,
    customerId: string,
  ): Promise<ConversationCustomerResult> {
    return this.linkConversationOnce(
      projectId,
      conversationId,
      customerId,
      true,
    );
  }

  private async linkConversationOnce(
    projectId: string,
    conversationId: string,
    customerId: string,
    recoverUniqueConflict: boolean,
  ): Promise<ConversationCustomerResult> {
    const [conversation, customer] = await Promise.all([
      this.getConversation(projectId, conversationId),
      this.getCustomerRow(projectId, customerId),
    ]);
    if (!conversation || !customer) return { kind: "not_found" };
    try {
      return await this.attachVisitor(
        projectId,
        conversation,
        customer,
        "dashboard",
      );
    } catch (error) {
      if (!recoverUniqueConflict || !isUniqueConstraintError(error)) throw error;
      return this.linkConversationOnce(
        projectId,
        conversationId,
        customerId,
        false,
      );
    }
  }

  async promoteConversation(
    projectId: string,
    conversationId: string,
    input: CustomerInput,
  ): Promise<ConversationCustomerResult> {
    return this.promoteConversationOnce(
      projectId,
      conversationId,
      input,
      true,
    );
  }

  private async promoteConversationOnce(
    projectId: string,
    conversationId: string,
    input: CustomerInput,
    recoverUniqueConflict: boolean,
  ): Promise<ConversationCustomerResult> {
    const conversation = await this.getConversation(projectId, conversationId);
    if (!conversation) return { kind: "not_found" };
    const resolution = await this.resolveCustomer(projectId, input);
    if (resolution.kind === "conflict") return resolution;

    const visitor = await this.findVisitor(projectId, conversation.visitorId);
    if (
      resolution.kind === "resolved" &&
      visitor &&
      resolution.customerId !== visitor.customerId
    ) {
      return {
        kind: "conflict",
        customerIds: [resolution.customerId, visitor.customerId],
      };
    }

    const customerId =
      resolution.kind === "resolved"
        ? resolution.customerId
        : visitor?.customerId ?? crypto.randomUUID();
    const existingCustomer = await this.getCustomerRow(projectId, customerId);
    const now = new Date();
    const customFields = {
      ...input.customFields,
      ...(existingCustomer ? parseCustomFields(existingCustomer.customFields) : {}),
    };
    const profileValues = {
      externalId:
        existingCustomer?.externalId ?? normalizeExternalId(input.externalId),
      name: existingCustomer?.name ?? normalizeOptionalText(input.name),
      email: existingCustomer?.email ?? normalizeCustomerEmail(input.email),
      phone: existingCustomer?.phone ?? normalizeOptionalText(input.phone),
      customFields: JSON.stringify(customFields),
    };
    const customerRow: CustomerRow =
      existingCustomer ?? {
        id: customerId,
        projectId,
        ...profileValues,
        firstSeenAt: null,
        lastSeenAt: null,
        createdAt: now,
        updatedAt: now,
      };
    const profileQuery = existingCustomer
      ? this.db
          .update(customers)
          .set(profileValues)
          .where(
            and(eq(customers.projectId, projectId), eq(customers.id, customerId)),
          )
      : this.db.insert(customers).values({
          id: customerId,
          projectId,
          ...profileValues,
        });

    try {
      return await this.attachVisitor(
        projectId,
        conversation,
        { ...customerRow, ...profileValues },
        "dashboard",
        [profileQuery],
      );
    } catch (error) {
      if (!recoverUniqueConflict || !isUniqueConstraintError(error)) throw error;
      return this.promoteConversationOnce(
        projectId,
        conversationId,
        input,
        false,
      );
    }
  }
}
