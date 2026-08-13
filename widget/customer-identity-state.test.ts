import { describe, expect, test } from "bun:test";
import {
  isSignedIdentityInput,
  planCustomerIdentityReset,
  WidgetIdentitySessionGuard,
} from "./customer-identity-state";

describe("customer identity reset state", () => {
  test("rotates visitor identity and clears visitor-scoped state while preserving config", () => {
    const config = { widget: { primaryColor: "#123456" }, projectName: "Acme" };
    const plan = planCustomerIdentityReset({
      projectSlug: "acme-support",
      currentVisitorId: "v_old",
      nextUuid: "00000000-0000-4000-8000-000000000001",
      state: {
        config,
        conversationId: "conversation-1",
        conversationStatus: "active",
        visitorInfo: { name: "Sam", email: "sam@example.com" },
        customMetadata: { account: "account-1" },
        pageContext: { page: "Pricing" },
        messages: [{ id: "message-1" }],
        renderedMessageIds: ["message-1"],
        newestResponseId: "message-1",
        agentConnected: true,
        agentSessionExpiresAt: 2_000,
        heartbeat: true,
        messageDraft: "private draft",
        inlineDraft: "inline private draft",
        formDrafts: ["Sam", "sam@example.com"],
        pendingAttachment: true,
        inputDisabled: true,
      },
    });

    expect(plan.nextState).toEqual({
      config,
      visitorId: "v_00000000-0000-4000-8000-000000000001",
      conversationId: null,
      conversationStatus: null,
      visitorInfo: {},
      customMetadata: {},
      pageContext: {},
      messages: [],
      renderedMessageIds: [],
      newestResponseId: null,
      agentConnected: false,
      agentSessionExpiresAt: 0,
      heartbeat: false,
      messageDraft: "",
      inlineDraft: "",
      formDrafts: [],
      pendingAttachment: false,
      inputDisabled: false,
    });
    expect(plan.storageKeysToRemove).toEqual([
      "rm_acme-support_conversation_id",
      "rm_acme-support_last_seen_response_id",
      "rm_acme-support_dismissed_intro_id",
      "rm_acme-support_greetings_dismissed",
      "rm_acme-support_v_old_last_seen_response_id",
      "rm_acme-support_v_old_dismissed_intro_id",
    ]);
    expect(plan.nextState.config).toBe(config);
  });

  test("invalidates and aborts work captured before an account reset", () => {
    const sessions = new WidgetIdentitySessionGuard();
    const previous = sessions.capture();

    sessions.rotate();
    const current = sessions.capture();

    expect(previous.signal.aborted).toBe(true);
    expect(sessions.isCurrent(previous)).toBe(false);
    expect(current.signal.aborted).toBe(false);
    expect(sessions.isCurrent(current)).toBe(true);
  });

  test("runs signed identify requests in invocation order", async () => {
    const sessions = new WidgetIdentitySessionGuard() as WidgetIdentitySessionGuard & {
      enqueueSignedIdentify(task: () => Promise<void>): Promise<void>;
    };
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = sessions.enqueueSignedIdentify(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = sessions.enqueueSignedIdentify(async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await Promise.resolve();

    expect(order).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("continues the signed identify queue after a rejected request", async () => {
    const sessions = new WidgetIdentitySessionGuard() as WidgetIdentitySessionGuard & {
      enqueueSignedIdentify(task: () => Promise<void>): Promise<void>;
    };
    let secondRan = false;

    const first = sessions.enqueueSignedIdentify(async () => {
      throw new Error("rejected identify");
    });
    const second = sessions.enqueueSignedIdentify(async () => {
      secondRan = true;
    });

    await expect(first).rejects.toThrow("rejected identify");
    await second;
    expect(secondRan).toBe(true);
  });
});

describe("signed identify discriminator", () => {
  test("accepts only a token-only object with a nonempty token", () => {
    expect(isSignedIdentityInput({ token: "payload.signature" })).toBe(true);
    expect(isSignedIdentityInput({ token: "" })).toBe(false);
    expect(
      isSignedIdentityInput({ token: "payload.signature", email: "sam@example.com" }),
    ).toBe(false);
    expect(isSignedIdentityInput({ name: "Sam" })).toBe(false);
    expect(isSignedIdentityInput(null)).toBe(false);
  });
});
