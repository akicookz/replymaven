import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { conversations } from "../db";
import type {
  PublicConversationRecord,
} from "../../shared/maven-conversation";
import { mapD1ConversationRow } from "./legacy-conversation-reader";
import type {
  PublicConversationStore,
  PublicCustomerMutationInput,
  PublicCustomerMutationResult,
} from "./public-conversation-store";

// Test-only stand-in for the deleted D1 store: implements the conversation
// queries the customer services depend on, over the legacy sqlite tables the
// service tests create. Production code must never import this file.
export class LegacyConversationStoreFixture {
  constructor(private readonly db: DrizzleD1Database<Record<string, unknown>>) {}

  asStore(): PublicConversationStore {
    return this as unknown as PublicConversationStore;
  }

  async get(
    projectId: string,
    conversationId: string,
  ): Promise<PublicConversationRecord | null> {
    const rows = await this.db.select().from(conversations).where(and(
      eq(conversations.id, conversationId),
      eq(conversations.projectId, projectId),
    )).limit(1);
    return rows[0] ? mapD1ConversationRow(rows[0]) : null;
  }

  async listByCustomer(
    projectId: string,
    customerId: string,
  ): Promise<PublicConversationRecord[]> {
    const rows = await this.db.select().from(conversations).where(and(
      eq(conversations.projectId, projectId),
      eq(conversations.customerId, customerId),
    )).orderBy(desc(conversations.lastActivityAt));
    return rows.map(mapD1ConversationRow);
  }

  async listByVisitor(
    projectId: string,
    visitorId: string,
  ): Promise<PublicConversationRecord[]> {
    const rows = await this.db.select().from(conversations).where(and(
      eq(conversations.projectId, projectId),
      eq(conversations.visitorId, visitorId),
    )).orderBy(desc(conversations.lastActivityAt));
    return rows.map(mapD1ConversationRow);
  }

  async getConversationCountsByCustomer(
    projectId: string,
    customerIds: string[],
  ): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.db
      .select({ customerId: conversations.customerId, count: count() })
      .from(conversations)
      .where(and(
        eq(conversations.projectId, projectId),
        inArray(conversations.customerId, customerIds),
      ))
      .groupBy(conversations.customerId);
    return new Map(rows.flatMap((row) =>
      row.customerId ? [[row.customerId, row.count] as const] : []
    ));
  }

  async applyCustomerMutation(
    input: PublicCustomerMutationInput,
  ): Promise<PublicCustomerMutationResult> {
    const updatedIds: string[] = [];
    for (const update of input.updates) {
      const existing = await this.get(input.projectId, update.conversationId);
      if (!existing) continue;
      await this.db.update(conversations).set({
        customerId: update.customerId,
        ...(update.visitorName === undefined
          ? {}
          : { visitorName: update.visitorName }),
        ...(update.visitorEmail === undefined
          ? {}
          : { visitorEmail: update.visitorEmail }),
        updatedAt: new Date(),
      }).where(and(
        eq(conversations.id, update.conversationId),
        eq(conversations.projectId, input.projectId),
      ));
      updatedIds.push(update.conversationId);
    }
    return { status: "completed", updatedIds };
  }
}
