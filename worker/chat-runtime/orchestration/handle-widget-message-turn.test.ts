import { describe, expect, test } from "bun:test";
import { touchLinkedCustomerAfterVisitorMessage } from "./handle-widget-message-turn";

describe("touchLinkedCustomerAfterVisitorMessage", () => {
  test("touches linked visitor activity and absorbs service failures", async () => {
    const calls: unknown[][] = [];
    const errors: unknown[] = [];
    const occurredAt = new Date("2026-08-02T12:00:00.000Z");

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      occurredAt,
      identityService: {
        async touchVisitorLastSeen(...args: unknown[]) {
          calls.push(args);
          throw new Error("temporary D1 failure");
        },
      },
      logFailure(error) {
        errors.push(error);
      },
    });

    expect(calls).toEqual([
      ["project-1", "customer-1", "visitor-1", occurredAt],
    ]);
    expect(errors).toHaveLength(1);
  });

  test("does nothing for an anonymous conversation", async () => {
    let touched = false;

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: null,
      visitorId: "visitor-1",
      occurredAt: new Date(),
      identityService: {
        async touchVisitorLastSeen() {
          touched = true;
        },
      },
      logFailure() {},
    });

    expect(touched).toBe(false);
  });

  test("publishes the linked customer after a successful activity touch", async () => {
    const published: string[] = [];

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-1",
      customerId: "customer-1",
      visitorId: "visitor-1",
      occurredAt: new Date("2026-08-02T12:00:00.000Z"),
      identityService: {
        async touchVisitorLastSeen() {},
      },
      logFailure() {},
      onTouched(customerId) {
        published.push(customerId);
      },
    });

    expect(published).toEqual(["customer-1"]);
  });

  test("uses an inbound email message timestamp before publishing its customer", async () => {
    const touches: unknown[][] = [];
    const published: string[] = [];
    const occurredAt = new Date("2026-08-02T13:45:00.000Z");

    await touchLinkedCustomerAfterVisitorMessage({
      projectId: "project-email",
      customerId: "customer-email",
      visitorId: "visitor-email",
      occurredAt,
      identityService: {
        async touchVisitorLastSeen(...args: unknown[]) {
          touches.push(args);
        },
      },
      logFailure() {},
      onTouched(customerId) {
        published.push(customerId);
      },
    });

    expect(touches).toEqual([
      ["project-email", "customer-email", "visitor-email", occurredAt],
    ]);
    expect(published).toEqual(["customer-email"]);
  });
});
