import { and, eq, inArray } from "drizzle-orm";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { customerActivity, type CustomerActivityType } from "../db";

const GREETING_HIDE_TYPES = [
  "greeting_dismissed",
  "greeting_cta_click",
] as const satisfies readonly CustomerActivityType[];

function readGreetingId(metadata: string): string | null {
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const greetingId = (parsed as Record<string, unknown>).greetingId;
    return typeof greetingId === "string" ? greetingId : null;
  } catch {
    return null;
  }
}

export class CustomerActivityService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async record(input: {
    projectId: string;
    customerId: string;
    visitorId: string;
    type: CustomerActivityType;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.db.insert(customerActivity).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      customerId: input.customerId,
      visitorId: input.visitorId,
      type: input.type,
      metadata: JSON.stringify(input.metadata),
      createdAt: new Date(),
    });
  }

  /** A CTA click hides a card like a dismissal does. */
  async listDismissedGreetingIds(
    projectId: string,
    customerId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ metadata: customerActivity.metadata })
      .from(customerActivity)
      .where(
        and(
          eq(customerActivity.customerId, customerId),
          inArray(customerActivity.type, [...GREETING_HIDE_TYPES]),
          eq(customerActivity.projectId, projectId),
        ),
      );

    const greetingIds = new Set<string>();
    for (const row of rows) {
      const greetingId = readGreetingId(row.metadata);
      if (greetingId) greetingIds.add(greetingId);
    }
    return [...greetingIds];
  }
}
