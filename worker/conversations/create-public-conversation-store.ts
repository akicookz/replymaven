import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { AppEnv } from "../types";
import { AgentPublicConversationStore } from "./agent-public-conversation-store";
import type { PublicConversationStore } from "./public-conversation-store";

export interface PublicConversationStoreContext {
  db: DrizzleD1Database<Record<string, unknown>>;
  env: AppEnv;
}

export function createPublicConversationStore(
  context: PublicConversationStoreContext,
): PublicConversationStore {
  return new AgentPublicConversationStore(context);
}
