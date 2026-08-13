import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AppEnv } from "../types";
import { AgentPublicConversationStore } from "./agent-public-conversation-store";
import { D1PublicConversationStore } from "./d1-public-conversation-store";
import type { PublicConversationStore } from "./public-conversation-store";

export interface PublicConversationStoreContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
}

export function createPublicConversationStore(
  context: PublicConversationStoreContext,
): PublicConversationStore {
  return context.env.PUBLIC_CONVERSATION_STORE === "agent"
    ? new AgentPublicConversationStore(context) as unknown as PublicConversationStore
    : new D1PublicConversationStore(context.db);
}
