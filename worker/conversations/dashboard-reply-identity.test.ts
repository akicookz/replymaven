import { describe, expect, test } from "bun:test";
import { dashboardReplyIdentity } from "./dashboard-reply-identity";

describe("dashboardReplyIdentity", () => {
  test("uses the raw request id as the message id and prefixes only the stored key", () => {
    const requestId = "8f1c2e3a-4b5d-6789-abcd-ef0123456789";

    expect(dashboardReplyIdentity({
      projectId: "project-1",
      conversationId: "conversation-1",
      userId: "user-1",
      requestId,
    })).toEqual({
      id: requestId,
      idempotencyKey:
        "dashboard:project-1:conversation-1:user-1:8f1c2e3a-4b5d-6789-abcd-ef0123456789",
    });
  });

  test("returns no ids when the dashboard omitted the header", () => {
    expect(dashboardReplyIdentity({
      projectId: "project-1",
      conversationId: "conversation-1",
      userId: "user-1",
      requestId: "   ",
    })).toEqual({ idempotencyKey: null });
  });
});
