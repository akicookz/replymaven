/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { drizzle } from "drizzle-orm/d1";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

const legacy = {
  async get() {
    return null;
  },
  async getMigrationMessages() {
    return [];
  },
};

describe("contact form ownership preparation", () => {
  nativeTest("prepares ownership for a fresh contact form conversation", async () => {
    const [
      { env },
      { AgentPublicConversationStore },
    ] = await Promise.all([
      import("cloudflare:workers"),
      import("../../../conversations/agent-public-conversation-store"),
    ]);
    const store = new AgentPublicConversationStore({
      db: drizzle(env.DB),
      env,
      legacy,
    });

    // Same sequence as POST /api/widget/:projectSlug/inquiries.
    const conversation = await store.createConversation({
      projectId: "contact-form-project",
      visitorId: "contact-form-visitor",
      visitorName: "Aki",
      visitorEmail: "visitor@example.com",
      metadata: JSON.stringify({ source: "inquiry" }),
    });
    await store.addPublicVisitorMessageWithFirstTurn(
      {
        conversationId: conversation.id,
        content: "Contact form submission",
        imageUrl: null,
        sources: null,
      },
      conversation.projectId,
    );

    await expect(store.prepareContactSupportOwnership(
      conversation.projectId,
      conversation.id,
    )).resolves.toBe("waiting_agent");

    // Swapped arguments are how the route used to call this; the store must
    // refuse them instead of resolving a status for a nonexistent parent.
    await expect(store.prepareContactSupportOwnership(
      conversation.id,
      conversation.projectId,
    )).resolves.toBeNull();
  }, 30_000);
});
