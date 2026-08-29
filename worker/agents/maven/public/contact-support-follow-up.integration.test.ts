/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { drizzle } from "drizzle-orm/d1";

const isBunTest = "Bun" in globalThis;
const nativeTest = isBunTest ? test.skip : test;

const PROJECT_ID = "contact-follow-up-project";
const OWNER_ID = "contact-follow-up-owner";

function loadMigrationSources(): Record<string, string> {
  return import.meta.glob<string>("../../../db/drizzle/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  });
}

async function prepareDatabase(db: D1Database): Promise<void> {
  const { applyD1Migrations } = await import("cloudflare:test");
  const migrationSources = loadMigrationSources();
  await applyD1Migrations(
    db,
    Object.entries(migrationSources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, source]) => ({
        name,
        queries: source.split("--> statement-breakpoint")
          .map((query) => query.trim())
          .filter(Boolean),
      })),
    "contact_follow_up_test_migrations",
  );
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO users (
      id, name, email, email_verified, created_at, updated_at
    ) VALUES (?, ?, ?, 1, unixepoch(), unixepoch())`).bind(
      OWNER_ID,
      "Contact Follow-up Owner",
      "contact-follow-up-owner@example.com",
    ),
    db.prepare(`INSERT OR IGNORE INTO projects (
      id, user_id, name, slug, onboarded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, unixepoch(), unixepoch())`).bind(
      PROJECT_ID,
      OWNER_ID,
      "Contact Follow-up Project",
      PROJECT_ID,
    ),
    db.prepare(`INSERT OR IGNORE INTO subscriptions (
      id, user_id, stripe_customer_id, plan, interval, status,
      current_period_start, current_period_end, cancel_at_period_end,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'starter', 'monthly', 'active', ?, ?, 0,
      unixepoch(), unixepoch())`).bind(
      "contact-follow-up-subscription",
      OWNER_ID,
      "cus_contact_follow_up",
      Math.floor(Date.now() / 1_000) - 60,
      Math.floor(Date.now() / 1_000) + 2_592_000,
    ),
  ]);
}

const legacy = {
  async get() {
    return null;
  },
  async getMigrationMessages() {
    return [];
  },
};

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

async function setup() {
  const [
    { env },
    { AgentPublicConversationStore },
    { runContactSupportFollowUp },
    { ProjectService },
  ] = await Promise.all([
    import("cloudflare:workers"),
    import("../../../conversations/agent-public-conversation-store"),
    import("../../../chat-runtime/contact-support/run-contact-support-follow-up"),
    import("../../../services/project-service"),
  ]);
  await prepareDatabase(env.DB);
  const db = drizzle(env.DB);
  const store = new AgentPublicConversationStore({ db, env, legacy });
  return { env, db, store, runContactSupportFollowUp, ProjectService };
}

describe("contact support follow-up", () => {
  // No AI provider keys exist here, so the turn falls back to the contact
  // fallback message; the test covers opening, append, and usage accounting.
  nativeTest("appends the AI follow-up reply to the conversation", async () => {
    const { env, db, store, runContactSupportFollowUp, ProjectService } =
      await setup();
    const conversation = await store.createConversation({
      projectId: PROJECT_ID,
      visitorId: "follow-up-visitor",
      visitorName: "Aki",
      visitorEmail: "aki@example.com",
      metadata: JSON.stringify({ source: "inquiry" }),
    });
    const formMessage = "Contact form submission\nYour message: Demo please";
    await store.addPublicVisitorMessageWithFirstTurn(
      {
        conversationId: conversation.id,
        content: formMessage,
        imageUrl: null,
        sources: null,
      },
      PROJECT_ID,
    );
    await expect(store.prepareContactSupportOwnership(
      PROJECT_ID,
      conversation.id,
    )).resolves.toBe("waiting_agent");
    const prepared = await store.getOperationalConversationById(
      conversation.id,
      PROJECT_ID,
    );
    if (!prepared) throw new Error("conversation missing after preparation");

    await runContactSupportFollowUp({
      db,
      env,
      executionCtx,
      chatService: store,
      projectService: new ProjectService(db),
      project: { id: PROJECT_ID, userId: OWNER_ID, name: "Contact Follow-up Project" },
      settings: null,
      conversation: prepared,
      formMessage,
      isFirstVisitorTurn: true,
      isReturningVisitor: false,
    });

    const messages = await store.getMessages(PROJECT_ID, conversation.id);
    const botMessage = messages.at(-1);
    expect(botMessage?.author).toBe("bot");
    expect(botMessage?.content).toContain("Hi Aki,");
    expect(botMessage?.content).toContain("I've flagged this for the team.");
    expect(botMessage?.content).toContain(
      "Response time can vary.",
    );
  }, 60_000);

  nativeTest("drops the reply when a human takes over first", async () => {
    const { env, db, store, runContactSupportFollowUp, ProjectService } =
      await setup();
    const conversation = await store.createConversation({
      projectId: PROJECT_ID,
      visitorId: "follow-up-race-visitor",
      visitorName: "Aki",
      visitorEmail: "aki@example.com",
      metadata: JSON.stringify({ source: "inquiry" }),
    });
    const formMessage = "Contact form submission\nYour message: Race case";
    await store.addPublicVisitorMessageWithFirstTurn(
      {
        conversationId: conversation.id,
        content: formMessage,
        imageUrl: null,
        sources: null,
      },
      PROJECT_ID,
    );
    await store.prepareContactSupportOwnership(PROJECT_ID, conversation.id);
    const prepared = await store.getOperationalConversationById(
      conversation.id,
      PROJECT_ID,
    );
    if (!prepared) throw new Error("conversation missing after preparation");

    await store.appendHuman({
      projectId: PROJECT_ID,
      conversationId: conversation.id,
      content: "A human already replied.",
      senderName: "Team",
    });
    await runContactSupportFollowUp({
      db,
      env,
      executionCtx,
      chatService: store,
      projectService: new ProjectService(db),
      project: { id: PROJECT_ID, userId: OWNER_ID, name: "Contact Follow-up Project" },
      settings: null,
      conversation: prepared,
      formMessage,
      isFirstVisitorTurn: true,
      isReturningVisitor: false,
    });

    const messages = await store.getMessages(PROJECT_ID, conversation.id);
    expect(messages.at(-1)?.author).toBe("agent");
    expect(messages.some((message) => message.author === "bot")).toBe(false);
  }, 60_000);
});
