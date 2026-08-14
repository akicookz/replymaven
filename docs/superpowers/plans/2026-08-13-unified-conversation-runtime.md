# Unified Conversation Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make public visitor conversations and private Sidechats use the same `MavenChatAgent` runtime, with Agent SQLite authoritative for conversation messages/state and D1 limited to the rest of the product.

**Architecture:** One `MavenProjectAgent` per project owns the child registry, shared project tools/MCP, and an indexed conversation directory. Each public transcript (`pub_<conversationId>`) and private Sidechat (`sc_<conversationId>`) is an isolated child instance of one `MavenChatAgent` class. The migration first puts every legacy caller behind a neutral store, then introduces Agent-backed storage, cuts clients and external writers over in one release, and finally removes D1 conversations/messages and `ConversationDO`.

**Tech Stack:** Bun, TypeScript, Hono, Cloudflare Workers, Agents SDK `0.20.1`, `@cloudflare/ai-chat` `0.10.1`, AI SDK `6.x`, Durable Object SQLite, D1/Drizzle, React 19, TanStack Query, vanilla widget IIFE, `bun:test` for unit/contract tests, and Vitest with `@cloudflare/vitest-pool-workers` for `worker/agents/**/*.integration.test.ts`.

## Global Constraints

- Keep `agents` pinned to `0.20.1`, `@cloudflare/ai-chat` pinned to `0.10.1`, and preserve `patches/agents@0.20.1.patch` until a separately reviewed dependency upgrade.
- Use Bun for every package, build, migration, and test command.
- Keep `MavenProjectAgent` as the only top-level Agent binding; public and private chats are sub-agents and require no new Durable Object binding.
- Use function declarations for named functions and React components; arrows remain limited to inline callbacks.
- Do not place public and private transcripts in the same Agent instance.
- Do not create a knowledge-search Agent; `search_knowledge` remains a tool in the current model loop.
- Do not adopt the experimental Sessions API.
- Do not silently truncate public transcripts; bound model context separately from persisted history.
- Never accept the public/Sidechat channel from an untrusted request body; derive it from the child-name prefix and signed claims.
- The public child is authoritative for operational conversation state and messages. The parent directory is a query model; D1 projections exist only during migration.
- Preserve current billing limits, customer continuity, Telegram handoff, delivery/read receipts, uploads, email, MCP, archive retention, and dashboard behavior.
- Do not deploy, apply remote D1 migrations, upload the widget, or change production runtime flags without explicit user approval.
- Follow the real-browser verification rule in `AGENTS.md` for widget and dashboard interaction behavior.

---

### Task 1: Introduce storage-neutral conversation contracts

**Files:**
- Create: `shared/maven-conversation.ts`
- Create: `worker/conversations/public-conversation-store.ts`
- Create: `worker/conversations/d1-public-conversation-store.ts`
- Create: `worker/conversations/create-public-conversation-store.ts`
- Create: `worker/conversations/public-conversation-store.test.ts`
- Modify: `worker/services/chat-service.ts:1-2490`
- Modify: `worker/types.ts:1-95`

**Interfaces:**
- Consumes: Existing `ConversationRow`, `MessageRow`, and `ChatService` behavior.
- Produces: `PublicConversationRecord`, `PublicMessageRecord`, `PublicConversationStore`, `D1PublicConversationStore`, and `createPublicConversationStore()` used by every subsequent task.

- [ ] **Step 1: Define the shared, storage-neutral records and child-name helpers**

Add the exact public types below to `shared/maven-conversation.ts`; include all existing conversation fields rather than leaking Drizzle row types through the new boundary.

```typescript
export type PublicConversationStatus =
  | "active"
  | "waiting_agent"
  | "agent_replied"
  | "closed";

export type PublicMessageAuthor = "visitor" | "bot" | "agent" | "system";

export interface PublicSourceReference {
  title: string;
  url: string | null;
  type: "webpage" | "pdf" | "faq";
}

export interface PublicMessageMetadata {
  v: 1;
  channel: "public";
  projectId: string;
  conversationId: string;
  author: PublicMessageAuthor;
  senderName: string | null;
  senderAvatar: string | null;
  userId: string | null;
  imageUrls: string[];
  sources: PublicSourceReference[];
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  emailedAt: number | null;
  systemKind: string | null;
}

export interface PublicMessageRecord {
  id: string;
  conversationId: string;
  author: PublicMessageAuthor;
  content: string;
  imageUrls: string[];
  sources: PublicSourceReference[];
  senderName: string | null;
  senderAvatar: string | null;
  userId: string | null;
  systemKind: string | null;
  createdAt: number;
  deliveredAt: number | null;
  readAt: number | null;
  emailedAt: number | null;
}

export interface PublicConversationRecord {
  id: string;
  projectId: string;
  customerId: string | null;
  visitorId: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: PublicConversationStatus;
  closeReason: "resolved" | "ended" | "spam" | "bot_resolved" | null;
  telegramThreadId: string | null;
  metadata: Record<string, unknown>;
  chatState: Record<string, unknown>;
  lastActivityAt: number;
  visitorLastSeenAt: number | null;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  snoozedUntil: number | null;
  archivedAt: number | null;
  purgeStartedAt: number | null;
  externalActionStartedAt: number | null;
  priority: "low" | "medium" | "high";
  assigneeId: string | null;
  createdAt: number;
  updatedAt: number;
  ownershipRevision: number;
}

export function toPublicChildName(conversationId: string): `pub_${string}` {
  return `pub_${conversationId}`;
}

export function toSidechatChildName(conversationId: string): `sc_${string}` {
  return `sc_${conversationId}`;
}

export function parseMavenChildName(name: string): {
  kind: "public" | "sidechat";
  conversationId: string;
} {
  if (name.startsWith("pub_") && name.length > 4) {
    return { kind: "public", conversationId: name.slice(4) };
  }
  if (name.startsWith("sc_") && name.length > 3) {
    return { kind: "sidechat", conversationId: name.slice(3) };
  }
  throw new Error("Invalid Maven child name");
}
```

- [ ] **Step 2: Write failing contract and conversion tests**

Test timestamp normalization, JSON fallback, image/source conversion, child-name rejection, and preservation of every status/ownership field. Include a round-trip test that maps a representative D1 row to `PublicConversationRecord` and a representative D1 message to `PublicMessageRecord`.

Run:

```bash
bun test worker/conversations/public-conversation-store.test.ts
```

Expected: FAIL because the store and conversion functions do not exist.

- [ ] **Step 3: Define the store boundary**

Add this interface to `worker/conversations/public-conversation-store.ts` and split large request objects into named interfaces in the same file:

```typescript
export interface PublicConversationStore {
  create(input: CreatePublicConversationInput): Promise<PublicConversationRecord>;
  get(projectId: string, conversationId: string): Promise<PublicConversationRecord | null>;
  getActiveByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getLastByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord | null>;
  getRecentByVisitorEmail(projectId: string, email: string): Promise<PublicConversationRecord | null>;
  list(query: PublicConversationListQuery): Promise<PublicConversationListResult>;
  listUpdates(query: PublicConversationUpdatesQuery): Promise<PublicConversationRecord[]>;
  listNeedsReview(projectId: string, since: number): Promise<PublicConversationRecord[]>;
  listAgentMode(projectId: string): Promise<PublicConversationRecord[]>;
  listByCustomer(projectId: string, customerId: string): Promise<PublicConversationRecord[]>;
  listByVisitor(projectId: string, visitorId: string): Promise<PublicConversationRecord[]>;
  getInboxCounts(projectId: string): Promise<PublicInboxCounts>;
  getMessages(projectId: string, conversationId: string): Promise<PublicMessageRecord[]>;
  getRecentMessages(projectId: string, conversationId: string, limit: number): Promise<PublicMessageRecord[]>;
  getMessagesBefore(input: PublicMessagesBeforeInput): Promise<PublicMessagePage>;
  getMessagesSince(projectId: string, conversationId: string, since: number): Promise<PublicMessageRecord[]>;
  getMessage(projectId: string, conversationId: string, messageId: string): Promise<PublicMessageRecord | null>;
  hasVisitorMessages(projectId: string, conversationId: string): Promise<boolean>;
  getLatestEmailedHumanMessage(projectId: string, conversationId: string): Promise<PublicMessageRecord | null>;
  appendVisitor(input: AppendPublicVisitorInput): Promise<AppendVisitorResult>;
  appendHuman(input: AppendPublicHumanInput): Promise<PublicMessageRecord>;
  appendSystem(input: AppendPublicSystemInput): Promise<PublicMessageRecord>;
  deleteHumanMessage(projectId: string, conversationId: string, messageId: string): Promise<DeletePublicMessageResult>;
  applyAction(input: PublicConversationActionInput): Promise<PublicConversationRecord | null>;
  transitionOwnership(input: PublicOwnershipTransitionInput): Promise<PublicOwnershipTransitionResult>;
  claimTeamRequest(input: PublicTeamRequestClaimInput): Promise<PublicTeamRequestClaimResult>;
  completeTeamRequestSummary(input: PublicTeamRequestSummaryInput): Promise<boolean>;
  acquireExternalAction(input: PublicExternalActionLeaseInput): Promise<PublicExternalActionLease | null>;
  releaseExternalAction(input: PublicExternalActionLease): Promise<void>;
  markDelivery(input: PublicDeliveryUpdateInput): Promise<string[]>;
  markEmailed(input: PublicEmailUpdateInput): Promise<boolean>;
  updatePresence(input: PublicPresenceUpdateInput): Promise<PublicChatChildState | null>;
  updateContact(input: PublicContactUpdateInput): Promise<PublicConversationRecord | null>;
  updateCustomer(input: PublicCustomerLinkInput): Promise<PublicConversationRecord | null>;
}
```

`PublicExternalActionLease` contains an opaque lease ID and captured ownership revision. Callers acquire it before Telegram/HTTP side effects and release it in `finally`; do not put callback functions in the store interface because the Agent implementation crosses an RPC boundary.

- [ ] **Step 4: Implement `D1PublicConversationStore` as a behavior-preserving adapter**

Delegate to existing `ChatService` methods and map results through one conversion module. Do not copy SQL out of `ChatService` in this task. `createPublicConversationStore()` must return the D1 adapter while `PUBLIC_CONVERSATION_STORE` is absent or equals `legacy`.

Add to `AppEnv`:

```typescript
PUBLIC_CONVERSATION_STORE?: "legacy" | "agent";
```

Add the non-production default to `wrangler.jsonc`:

```json
"PUBLIC_CONVERSATION_STORE": "legacy"
```

- [ ] **Step 5: Run the new contract tests and the complete existing backend suite**

```bash
bun test worker/conversations/public-conversation-store.test.ts
bun test
bun run test:agents
```

Expected: PASS with no response-shape changes.

- [ ] **Step 6: Commit the neutral boundary**

```bash
git add shared/maven-conversation.ts worker/conversations worker/services/chat-service.ts worker/types.ts wrangler.jsonc
git commit -m "refactor: add public conversation storage boundary"
```

---

### Task 2: Route all legacy readers and writers through the boundary

**Files:**
- Modify: `worker/index.ts:698-1795, 4036-4165, 6519-7335, 7808-7858`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:319-1485`
- Modify: `worker/agents/sidechat/sidechat-context.ts:1-100`
- Modify: `worker/mcp-server.ts:450-510, 1010-1065`
- Modify: `worker/services/customer-service.ts:120-420`
- Modify: `worker/services/customer-identity-service.ts:180-735`
- Modify: `worker/services/dashboard-service.ts:1-165`
- Modify: `worker/services/conversation-retention-service.ts:1-310`
- Modify: `worker/services/billing-service.ts:960-1055`
- Create: `worker/conversations/public-conversation-boundary.test.ts`

**Interfaces:**
- Consumes: `PublicConversationStore` from Task 1.
- Produces: A repository in which `ChatService` is reachable only inside `D1PublicConversationStore` and migration code; this is the cutover safety barrier.

- [ ] **Step 1: Write a failing boundary test**

Create a source-boundary test that enumerates production TypeScript files and fails when they import `conversations`, `messages`, `ConversationRow`, `MessageRow`, or instantiate `ChatService`, except for this explicit allowlist:

```typescript
const LEGACY_ALLOWLIST = new Set([
  "worker/db/schema.ts",
  "worker/db/index.ts",
  "worker/conversations/d1-public-conversation-store.ts",
  "worker/services/chat-service.ts",
  "worker/migrations/conversation-runtime-backfill.ts",
]);
```

Use Vite's eager raw import support so this runs in the Workers test pool without Node filesystem APIs:

```typescript
const productionSources = import.meta.glob<string>(
  ["/worker/**/*.ts", "/shared/**/*.ts"],
  { eager: true, import: "default", query: "?raw" },
);
```

Exclude test files, generated bindings, Drizzle migration history, and the explicit allowlist. Match direct table imports/usages and `new ChatService(`, not comments or the table declarations themselves. The test must print every violating path so the migration cannot silently leave a D1 writer behind.

Run:

```bash
bun test worker/conversations/public-conversation-boundary.test.ts
```

Expected: FAIL with the current direct consumers.

- [ ] **Step 2: Add one per-request store factory in Hono routes**

Instantiate the store with the request's D1 handle and environment, then pass it into extracted route handlers and runtime contexts. Keep all existing endpoint paths and response DTOs unchanged.

```typescript
const conversationStore = createPublicConversationStore({
  db: c.get("db"),
  env: c.env,
});
```

- [ ] **Step 3: Replace direct conversation/message access in services**

Inject `PublicConversationStore` into Sidechat context, MCP, customer, customer identity, dashboard statistics, billing log, and retention code. Keep customer, subscription, resource, tool-definition, and project-setting queries in D1.

- [ ] **Step 4: Replace Drizzle row types at module boundaries**

Change chat-runtime and realtime interfaces from `ConversationRow`/`MessageRow` to the shared records. Preserve the current public JSON shape with explicit adapter functions instead of relying on `Date` serialization.

- [ ] **Step 5: Run boundary and regression tests**

```bash
bun test worker/conversations/public-conversation-boundary.test.ts
bun test
bun run test:agents
bun run build
```

Expected: PASS. The application still runs entirely on D1 because the factory defaults to `legacy`.

- [ ] **Step 6: Commit the behavior-preserving reroute**

```bash
git add worker shared src
git commit -m "refactor: route conversation access through store"
```

---

### Task 3: Add the project Agent conversation directory

**Files:**
- Create: `worker/agents/maven/conversation-directory.ts`
- Create: `worker/agents/maven/conversation-directory.test.ts`
- Create: `worker/agents/maven/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/maven-project-agent.ts:1-1207`
- Modify: `worker/agents/sidechat/maven-project-agent.test.ts`
- Modify: `worker/agents/sidechat/agent-smoke.integration.test.ts`
- Modify: `shared/sidechat-agent.ts:1-75`
- Modify: `worker/index.ts:150-155`

**Interfaces:**
- Consumes: `PublicConversationRecord` and existing Sidechat summary methods.
- Produces: `ConversationDirectory`, `MavenConversationSummary`, `MavenProjectAgent.listConversations()`, `getInboxCounts()`, `upsertConversationSummary()`, and `reconcileConversationSummary()`.

- [ ] **Step 1: Write failing directory tests**

Cover:

- cursor ordering by `lastActivityAt DESC, conversationId DESC`;
- filters for needs-you, all, snoozed, resolved, archived, and flagged, plus
  newest/oldest/priority sort order;
- ASCII case-insensitive visitor-name/email search matching existing behavior;
- idempotent revision updates;
- rejection of an older child summary revision;
- inbox counts and Sidechat status;
- pagination without duplicates when two rows share a timestamp;
- Telegram-thread lookup, metadata value filtering, and bot-message sorting.

Run:

```bash
bun test worker/agents/maven/conversation-directory.test.ts
```

Expected: FAIL because the directory does not exist.

- [ ] **Step 2: Implement the parent SQLite schema**

Create the schema synchronously through the Agent SQL template:

```sql
CREATE TABLE IF NOT EXISTS conversation_directory (
  conversation_id TEXT PRIMARY KEY,
  public_child_name TEXT NOT NULL UNIQUE,
  sidechat_child_name TEXT,
  sidechat_status TEXT,
  customer_id TEXT,
  visitor_id TEXT NOT NULL,
  visitor_name TEXT,
  visitor_email TEXT,
  telegram_thread_id TEXT,
  status TEXT NOT NULL,
  close_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL,
  assignee_id TEXT,
  snoozed_until INTEGER,
  archived_at INTEGER,
  purge_started_at INTEGER,
  visitor_last_seen_at INTEGER,
  visitor_presence TEXT NOT NULL DEFAULT 'active',
  visitor_last_online_at INTEGER,
  last_message_id TEXT,
  last_message_author TEXT,
  last_message_preview TEXT,
  last_activity_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  bot_message_count INTEGER NOT NULL DEFAULT 0,
  child_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_activity
  ON conversation_directory(last_activity_at DESC, conversation_id DESC);
CREATE INDEX IF NOT EXISTS idx_directory_status_activity
  ON conversation_directory(status, last_activity_at DESC, conversation_id DESC);
CREATE INDEX IF NOT EXISTS idx_directory_customer_activity
  ON conversation_directory(customer_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_directory_visitor_activity
  ON conversation_directory(visitor_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_directory_telegram_thread
  ON conversation_directory(telegram_thread_id);
CREATE INDEX IF NOT EXISTS idx_directory_created
  ON conversation_directory(created_at DESC, conversation_id DESC);
```

- [ ] **Step 3: Move `MavenProjectAgent` to the common Maven directory**

Create the common file with the same exported class name so the existing `MAVEN_PROJECT_AGENT` binding and migration stay valid. Leave a temporary re-export at the old path:

```typescript
export { MavenProjectAgent } from "../maven/maven-project-agent";
```

Replace the unbounded `MavenProjectState.sidechats` record with directory SQL methods. Preserve current Sidechat session, MCP, tool-policy, cleanup, and `onBeforeSubAgent` behavior.

- [ ] **Step 4: Add paginated RPC methods and summary broadcasts**

Implement:

```typescript
async listConversations(
  query: MavenConversationListQuery,
): Promise<MavenConversationListResult>;

async getInboxCounts(): Promise<MavenInboxCounts>;

async upsertConversationSummary(
  summary: MavenConversationSummary,
): Promise<{ applied: boolean; revision: number }>;
```

Broadcast only the changed summary and counts, never the whole directory state.

- [ ] **Step 5: Run parent and Sidechat regression tests**

```bash
bun test worker/agents/maven/conversation-directory.test.ts worker/agents/sidechat/maven-project-agent.test.ts
bun run test:agents -- worker/agents/sidechat/agent-smoke.integration.test.ts
```

Expected: PASS with existing Sidechat child names and sessions unchanged.

- [ ] **Step 6: Commit the project directory**

```bash
git add worker/agents shared/sidechat-agent.ts worker/index.ts
git commit -m "feat: add project agent conversation directory"
```

---

### Task 4: Generalize `MavenChatAgent` and add public child storage

**Files:**
- Create: `worker/agents/maven/maven-chat-agent.ts`
- Create: `worker/agents/maven/public/public-conversation-state.ts`
- Create: `worker/agents/maven/public/public-message.ts`
- Create: `worker/agents/maven/public/public-child.integration.test.ts`
- Modify: `worker/agents/sidechat/maven-chat-agent.ts:1-442`
- Modify: `worker/agents/sidechat/maven-chat-agent.integration.test.ts`
- Modify: `worker/agents/sidechat/private-tool-payload.ts`
- Modify: `worker/agents/maven/maven-project-agent.ts`
- Modify: `worker/index.ts:150-155`

**Interfaces:**
- Consumes: Parent directory and existing Sidechat policy.
- Produces: One common `MavenChatAgent`, `PublicConversationStateStore`, public UI-message conversion, idempotent legacy import, and internal public transcript/state RPC.

- [ ] **Step 1: Write failing public-child integration tests**

Use the Workers Agent test pool to prove:

- `pub_a` and `sc_a` are separate child instances with isolated SQLite;
- a public legacy import persists state and UI messages exactly once;
- a repeated import with the same checksum is a no-op;
- a conflicting import after an Agent-native write returns `conflict`;
- public transcripts are not capped at Sidechat's 200-message limit;
- private Sidechat sanitization still removes private tool payloads;
- `getPublicSnapshot()` cannot be called on an `sc_` child;
- the child's published Agent state contains only the safe widget projection
  (`status`, presence timestamps, and revision), never metadata, chat state,
  Telegram IDs, customer IDs, or internal tool state.

Run:

```bash
bun run test:agents -- worker/agents/maven/public/public-child.integration.test.ts
```

Expected: FAIL because public children are unsupported.

- [ ] **Step 2: Add the public operational-state table**

Store one row with the fields from `PublicConversationRecord`, plus `revision`, `legacyChecksum`, `runtimeVersion`, `retentionScheduleId`, and `autoCloseScheduleId`. Initialize it only through `createPublicConversation()` or `importLegacyPublicConversation()`.

```sql
CREATE TABLE IF NOT EXISTS public_conversation_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  conversation_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  visitor_id TEXT NOT NULL,
  visitor_name TEXT,
  visitor_email TEXT,
  status TEXT NOT NULL,
  close_reason TEXT,
  telegram_thread_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  chat_state_json TEXT NOT NULL DEFAULT '{}',
  last_activity_at INTEGER NOT NULL,
  visitor_last_seen_at INTEGER,
  visitor_presence TEXT NOT NULL DEFAULT 'active',
  visitor_last_online_at INTEGER,
  snoozed_until INTEGER,
  archived_at INTEGER,
  purge_started_at INTEGER,
  external_action_started_at INTEGER,
  external_action_lease_id TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ownership_revision INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  legacy_checksum TEXT,
  runtime_version INTEGER NOT NULL DEFAULT 1,
  retention_schedule_id TEXT,
  auto_close_schedule_id TEXT
);
```

The mutation primitive must serialize state and message changes inside the child and return a summary carrying the new monotonically increasing revision:

```typescript
interface PublicMutationResult<T> {
  value: T;
  summary: MavenConversationSummary;
}
```

- [ ] **Step 3: Implement UI-message conversion and sanitization**

Persist public authorship and operational fields in `PublicMessageMetadata`. Convert visitor messages to AI SDK `user`, bot/human messages to `assistant` with distinct `author`, and system timeline events to `system`. Preserve image URLs and sources in native parts plus metadata. Reject metadata whose `conversationId` does not match the child.

- [ ] **Step 4: Move the common class and dispatch by trusted child name**

The common class must keep the SDK lifecycle and delegate channel policy:

```typescript
export class MavenChatAgent extends AIChatAgent<AppEnv> {
  messageConcurrency = "queue" as const;
  chatRecovery = true;
  waitForMcpConnections = false;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.maxPersistedMessages =
      parseMavenChildName(this.name).kind === "sidechat" ? 200 : undefined;
  }
}
```

Move the existing Sidechat `onChatMessage` and `onChatResponse` bodies into focused Sidechat functions without changing their behavior. Leave a temporary re-export at the old file path.

- [ ] **Step 5: Add internal public RPC methods**

Implement non-browser-callable methods for `getPublicSnapshot`, `getPublicMessages`, `importLegacyPublicConversation`, `createPublicConversation`, `appendHumanMessage`, `appendSystemMessage`, `deleteHumanMessage`, `applyConversationAction`, `markDelivery`, `updateContact`, `updateCustomer`, and `getAttachmentManifest`.

Every successful mutation must await `parent.upsertConversationSummary(summary)`. On failure, queue an idempotent retry carrying the same child revision.

- [ ] **Step 6: Run public and private child tests**

```bash
bun test worker/agents/sidechat/sidechat-privacy.test.ts
bun run test:agents -- worker/agents/maven/public/public-child.integration.test.ts worker/agents/sidechat/maven-chat-agent.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the common child runtime**

```bash
git add worker/agents worker/index.ts
git commit -m "feat: generalize Maven chat agent for public children"
```

---

### Task 5: Add public Agent authentication, sessions, and store adapter

**Files:**
- Create: `shared/public-chat-agent.ts`
- Create: `worker/agents/maven/public/public-agent-auth.ts`
- Create: `worker/agents/maven/public/public-agent-auth.test.ts`
- Create: `worker/agents/maven/public/public-chat-protocol-guard.ts`
- Create: `worker/agents/maven/public/public-chat-protocol-guard.test.ts`
- Create: `worker/conversations/agent-public-conversation-store.ts`
- Create: `worker/agents/maven/public/agent-public-conversation-store.integration.test.ts`
- Create: `worker/routes/public-agent-handlers.ts`
- Create: `worker/routes/public-agent-handlers.test.ts`
- Modify: `worker/agents/sidechat/agent-auth.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts`
- Modify: `worker/agents/maven/maven-project-agent.ts`
- Modify: `worker/conversations/create-public-conversation-store.ts`
- Modify: `worker/index.ts:630-690, 698-1150, 2760-2940`

**Interfaces:**
- Consumes: Common parent/child classes and `PublicConversationStore`.
- Produces: exact public widget/dashboard claims, an untrusted-client protocol guard, session endpoints, parent routing gates, and `AgentPublicConversationStore` selected by the runtime flag.

- [ ] **Step 1: Define and test exact signed claims**

```typescript
export interface PublicChatChildClaims {
  v: 1;
  aud: "replymaven-public-chat";
  scope: "child";
  actor: "visitor" | "dashboard";
  projectId: string;
  parentName: string;
  conversationId: string;
  childName: `pub_${string}`;
  visitorId: string | null;
  canSubmitVisitor: boolean;
  canRead: boolean;
  iat: number;
  exp: number;
}

export interface PublicChatChildState {
  status: PublicConversationStatus;
  visitorPresence: "active" | "background";
  visitorLastOnlineAt: number | null;
  archived: boolean;
  revision: number;
}

export interface PublicChatSessionResponse {
  host: string;
  parentAgent: "MavenProjectAgent";
  parentName: string;
  childAgent: "MavenChatAgent";
  childName: `pub_${string}`;
  token: string;
  expiresAt: number;
}
```

Use `SIDECHAT_TOKEN_SECRET` with the distinct `aud` value for cryptographic domain separation. Tests must reject expired, cross-project, wrong-child, wrong-visitor, Sidechat-audience, and body-only claims. Export only the safe `PublicChatChildState` through Agent state; detailed operational state stays in the child SQLite row and internal RPC.

- [ ] **Step 2: Extend parent and child access gates**

`onBeforeSubAgent` must verify the complete sub-agent path before forwarding. `onConnect` must set only the verified claim in connection state. A dashboard claim cannot submit a visitor AI turn; a visitor claim cannot call dashboard mutations.

Mark dashboard child connections read-only for Agent state/RPC purposes. Public human replies continue through authenticated Hono routes and internal child RPC.

- [ ] **Step 3: Guard the SDK chat protocol for untrusted visitors**

After `super()` installs `AIChatAgent`'s message handler, wrap that handler only for `pub_` children. Parse frames with `parseProtocolMessage` from `agents/chat` and `MessageType` from `@cloudflare/ai-chat/types`; do not hand-maintain wire literals.

Allow SDK resume acknowledgements/probes and cancellation. Reject direct `CF_AGENT_CHAT_MESSAGES`, clear, regenerate, client-tool result, and client-tool approval frames. For a submit request, require:

- the connection has a verified visitor claim for this exact child;
- the submitted messages are a structural clone of a suffix of the authoritative server messages, in the same order, and at least as long as the newest-200 window the client is served; the server serves and rebuilds that same window, so the wire payload does not grow with transcript length;
- there is exactly one additional `user` message with a new ID;
- it contains only bounded text and approved image/file parts;
- it contains no client metadata, assistant/system role, tool part, source part, or client tool schema;
- the request body contains only the validated page-context and attachment fields.

On rejection, send one terminal SDK chat response for the request ID with `error: true`, mutate nothing, and keep/close the connection according to whether the failure is recoverable. Tests must submit raw malicious frames for transcript deletion, prior-message edit, forged human/bot message, foreign conversation metadata, duplicate ID, oversized content, clear, and client tool output; each must leave the child checksum unchanged. A valid full-prefix-plus-one-user frame must still flow through native SDK persistence.

- [ ] **Step 4: Add session endpoints**

Implement:

```text
POST /api/widget/:projectSlug/conversations/:id/agent-session
POST /api/projects/:projectId/conversations/:conversationId/agent-session
```

The widget endpoint verifies project slug, exact conversation ID, exact visitor ID, non-archived state, and ban state before returning parent/child names plus a short-lived token. The dashboard endpoint uses Better Auth, effective project ownership, and team permissions.

Return `host` as the API request origin. The cross-domain widget passes it to `useAgent`; the dashboard may use the same value or same-origin default. Never derive the Agent host from the embedding page origin.

- [ ] **Step 5: Implement `AgentPublicConversationStore`**

Resolve the parent with `getAgentByName(env.MAVEN_PROJECT_AGENT, projectId)`, then the public child with `getSubAgentByName(parent, MavenChatAgent, toPublicChildName(conversationId))`. Map every store method to one parent or child RPC; list/count methods go only to the parent.

When a child is absent and legacy data exists, call `importLegacyPublicConversation()` with a deterministic SHA-256 checksum over the normalized state and ordered messages. Do not import again after the child reports an Agent-native revision.

- [ ] **Step 6: Make runtime selection explicit**

```typescript
export function createPublicConversationStore(
  context: PublicConversationStoreContext,
): PublicConversationStore {
  return context.env.PUBLIC_CONVERSATION_STORE === "agent"
    ? new AgentPublicConversationStore(context)
    : new D1PublicConversationStore(context.db);
}
```

Keep `wrangler.jsonc` set to `legacy`.

- [ ] **Step 7: Run auth, protocol, route, adapter, and existing Sidechat tests**

```bash
bun test worker/agents/maven/public/public-agent-auth.test.ts worker/agents/maven/public/public-chat-protocol-guard.test.ts worker/routes/public-agent-handlers.test.ts worker/agents/sidechat/agent-auth.test.ts
bun run test:agents -- worker/agents/maven/public/agent-public-conversation-store.integration.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the dormant Agent adapter**

```bash
git add shared/public-chat-agent.ts worker
git commit -m "feat: add authenticated public Agent sessions"
```

---

### Task 6: Port the visitor AI turn into `MavenChatAgent`

**Files:**
- Create: `worker/agents/maven/public/public-turn.ts`
- Create: `worker/agents/maven/public/public-turn.test.ts`
- Create: `worker/agents/maven/public/public-post-turn.ts`
- Create: `worker/agents/maven/public/public-human-mode.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts`
- Modify: `worker/chat-runtime/orchestration/run-maven-turn.ts:1-240`
- Modify: `worker/chat-runtime/orchestration/normalize-history.ts`
- Modify: `worker/chat-runtime/post-turn/escalation.ts`
- Modify: `worker/chat-runtime/tools/internal/request-team-help.ts`
- Modify: `worker/chat-runtime/routing/public-turn-gates.ts`
- Modify: `worker/services/billing-service.ts`
- Modify: `worker/services/billing-service.test.ts`
- Modify: `worker/db/schema.ts`
- Create: `worker/db/drizzle/0063_idempotent_message_usage_credits.sql`
- Reference during parity work: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:360-1485`

**Interfaces:**
- Consumes: Native `this.messages`, public operational state, existing prompt/retrieval/tool modules, D1 billing/settings/resources.
- Produces: The public branch of common `MavenChatAgent.onChatMessage()` and `onChatResponse()` with no D1 message writes.

- [ ] **Step 1: Convert the legacy orchestration tests into parity fixtures**

For subscription failure, message limit, ban, archive, closed reopen, muted mode, human ownership, first visitor message, AI response, handoff request, contact acceptance, model fallback, RAG sources, HTTP tools, and Telegram forwarding, define the same input/expected outcome against both the legacy handler and the new public-turn function.

Run:

```bash
bun test worker/agents/maven/public/public-turn.test.ts
```

Expected: FAIL because the public turn does not exist.

- [ ] **Step 2: Adapt `runMavenTurn` to storage-neutral transcript input**

Replace `MessageRow` dependencies with `PublicMessageRecord` or normalized AI SDK messages. Keep `search_knowledge`, `request_team_help`, HTTP tools, scope classification, model fallback, prompt sections, and tool step limits unchanged.

- [ ] **Step 3: Implement pre-turn gates in the child**

The ordered gates are:

1. verify request/connection claims;
2. replace the accepted new `user` message's absent client metadata with
   server-owned `PublicMessageMetadata` and persist that normalized message;
3. load authoritative child state;
4. reject archived/banned/unavailable conversations;
5. validate subscription and D1 usage ledger;
6. apply reopen semantics for a visitor message to a closed conversation;
7. if human-owned or muted, persist/forward without model execution;
8. load project settings, guidelines, tools, compiled FAQ, and customer context;
9. run the existing Maven tool loop against `this.messages`.

The SDK has already persisted the submitted visitor message before `onChatMessage`; do not append it a second time.

- [ ] **Step 4: Implement the AI/human race policy**

Human takeover is one child RPC that calls `abortAllRequests("Human takeover")`, advances `ownershipRevision`, removes an assistant partial created solely by the aborted turn when it has not been delivered, persists the human response, and returns the new summary. `onChatResponse` must compare its captured ownership revision before applying escalation or resolved-state side effects.

- [ ] **Step 5: Implement post-turn updates**

After SDK persistence, increment the D1 usage ledger exactly once using the persisted assistant message ID, extract that message, apply handoff/resolution/contact markers, update operational state, notify Telegram when required, and publish one parent summary revision. Do not rewrite the assistant message through a second store.

Add the steady-state D1 billing table `message_usage_credits(message_id PRIMARY KEY, user_id, period_start, created_at)` and an `AFTER INSERT` SQLite trigger that upserts/increments the existing `usage` aggregate. `BillingService.incrementMessageUsageOnce(messageId, userId, subscription)` performs `INSERT OR IGNORE`; the primary key and trigger make recovery/retry atomic and idempotent. Test two concurrent calls, a recovery replay, a new message, and period rollover.

```sql
CREATE TABLE message_usage_credits (
  message_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_message_usage_credits_user_period
  ON message_usage_credits(user_id, period_start);
CREATE TRIGGER message_usage_credits_increment
AFTER INSERT ON message_usage_credits
BEGIN
  INSERT INTO usage (
    id, user_id, period_start, messages_used,
    alerted_80, alerted_100, created_at
  ) VALUES (
    'usage_' || NEW.message_id,
    NEW.user_id, NEW.period_start, 1, 0, 0, unixepoch()
  )
  ON CONFLICT(user_id, period_start)
  DO UPDATE SET messages_used = messages_used + 1;
END;
```

Replace the current lazy list/read auto-close with a child schedule whenever activity changes and `autoCloseMinutes` is enabled. The callback closes only when the captured activity revision is still current and the conversation remains open; reopening or new activity cancels/replaces the old schedule. Cover schedule replacement, stale callback no-op, and settings-disabled behavior in `public-turn.test.ts`.

- [ ] **Step 6: Run parity and native recovery tests**

```bash
bun run db:migrate:dev
bun test worker/agents/maven/public/public-turn.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/post-turn/escalation.test.ts worker/services/billing-service.test.ts
bun run test:agents -- worker/agents/maven/public/public-child.integration.test.ts
```

Expected: PASS, including recovery and human-takeover cases.

- [ ] **Step 7: Commit the public turn**

```bash
git add worker/agents/maven/public worker/agents/maven/maven-chat-agent.ts worker/chat-runtime worker/services/billing-service.ts worker/services/billing-service.test.ts worker/db
git commit -m "feat: run visitor turns in Maven chat agent"
```

---

### Task 7: Move operational writers and external channels to child RPC

**Files:**
- Modify: `worker/index.ts:908-1148, 1505-1795, 6653-7335`
- Modify: `worker/services/telegram-service.ts`
- Modify: `worker/services/tool-service.ts:180-340`
- Modify: `worker/mcp-server.ts:450-510`
- Modify: `worker/routes/public-agent-handlers.ts`
- Modify: `worker/conversations/agent-public-conversation-store.ts`
- Create: `worker/agents/maven/public/public-operations.integration.test.ts`
- Modify: `shared/ws-events.ts`

**Interfaces:**
- Consumes: Public child mutation RPC from Tasks 4-6.
- Produces: Agent-backed human replies, Telegram messages, close/reopen/archive/snooze/priority/assignment, delivery/read/email markers, deletion, uploads, and MCP reads.

- [ ] **Step 1: Write failing operational integration tests**

Prove that each operation mutates child state/messages once, increments the child revision once, updates the safe child-state projection and parent summary, and returns the existing API response shape. Add race tests for simultaneous AI completion and human reply, repeated Telegram webhook delivery, repeated delete, archive during an HTTP tool lease, delivery/read updates received out of order, and banning a visitor with multiple open conversations.

- [ ] **Step 2: Route dashboard and Telegram human messages through `appendHuman()`**

Remove direct message inserts from route and Telegram handlers. Preserve sender identity, avatar, image URLs, thread replies, email behavior, and idempotency keys in `PublicMessageMetadata`.

- [ ] **Step 3: Route conversation actions through `applyAction()`**

Move close, reopen, snooze, priority, assignment, archive, unarchive, spam, contact snapshot, and human handback into serialized child mutations. Bulk endpoints call the parent once; the parent dispatches bounded child RPC batches of 25 and returns exact updated/skipped IDs.

The visitor-ban flow keeps the ban record in D1, resolves matching open conversations through parent indexes, and closes each matching child as spam through the same bounded parent dispatch. Closing a conversation must still trigger the existing post-close canned-response draft policy through an idempotent side effect keyed by conversation ID and close revision.

When `autoCloseMinutes` changes, the settings route asks the parent to reconcile schedules for open children in bounded batches. Disabling auto-close cancels them; enabling or changing it schedules from each directory row's latest activity without waiting for a dashboard read.

- [ ] **Step 4: Move presence, receipts, deletion, uploads, and email markers**

Route widget heartbeat/background changes to the child and publish only the safe presence state. Validate upload ownership by calling `store.get()`. Persist attachment URLs in the public child. Make delivery/read/email updates idempotent and monotonic. Delete only human-authored agent messages and preserve existing already-deleted semantics.

- [ ] **Step 5: Move MCP and tool audit linkage**

Read transcripts through `getMessages()`. Keep tool definitions and execution audit rows in D1, but treat `conversationId` and `messageId` as external identifiers. Tool execution completion updates the associated UI-message tool part through child RPC.

- [ ] **Step 6: Run operation and channel tests**

```bash
bun test worker/services/telegram-service.test.ts worker/routes/public-agent-handlers.test.ts worker/realtime/broadcast.test.ts
bun run test:agents -- worker/agents/maven/public/public-operations.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit operational cutover support**

```bash
git add worker shared/ws-events.ts
git commit -m "refactor: route conversation operations through agents"
```

---

### Task 8: Move dashboard list, detail, and realtime to Agents

**Files:**
- Create: `src/hooks/use-conversation-directory-agent.ts`
- Create: `src/hooks/use-public-chat-agent.ts`
- Create: `src/hooks/use-public-chat-agent.test.tsx`
- Create: `src/lib/inbox/public-message-adapter.ts`
- Create: `src/lib/inbox/public-message-adapter.test.ts`
- Modify: `src/pages/Conversations.tsx:400-2105`
- Modify: `src/lib/use-conversation-ws.ts:1-280`
- Modify: `src/components/inbox/MessageList.tsx`
- Modify: `worker/index.ts:6519-6828`
- Modify: `worker/routes/public-agent-handlers.ts`

**Interfaces:**
- Consumes: Parent directory list/count RPC, dashboard child session, native public UI messages.
- Produces: One parent inbox connection and one selected-child chat connection with existing dashboard DTO/UI behavior.

- [ ] **Step 1: Write failing message-adapter and hook tests**

Cover visitor/bot/human/system rendering, sources, images, delivery/read/email fields, optimistic human reply replacement, transcript replacement after reconnect, parent summary updates, cursor pagination, and session expiry refresh.

Run:

```bash
bun test src/lib/inbox/public-message-adapter.test.ts src/hooks/use-public-chat-agent.test.tsx
```

Expected: FAIL because the public hooks do not exist.

- [ ] **Step 2: Change the list endpoint to one parent query**

After D1 authorization, make one `parent.getDashboardConversationPage()` RPC that returns the filtered page and inbox counts together. Apply legacy offsets directly in the parent's indexed SQLite query (`LIMIT … OFFSET …`), including offsets above the 100-row RPC page cap; do not traverse multiple parent cursors for one HTTP request. Collect customer and assignee IDs from the returned page, batch-load those D1 profiles, and merge them into the response. Do not contact child Agents from the list endpoint.

- [ ] **Step 3: Connect the inbox to the project parent**

Reuse the authenticated parent session pattern from Sidechat summaries. Apply `conversation-summary` and `inbox-counts` events directly to the TanStack Query cache. Keep HTTP pagination as the recovery/baseline path.

- [ ] **Step 4: Connect the selected conversation through `useAgentChat`**

Build connection options with:

```typescript
{
  host: session.host,
  agent: "MavenProjectAgent",
  name: projectId,
  sub: [{ agent: "MavenChatAgent", name: `pub_${conversationId}` }],
  query: { token },
  queryDeps: [token],
}
```

Render native messages through `public-message-adapter.ts`. Keep human reply actions on authenticated Hono routes so browser-callable child methods do not bypass team permissions.

Set `syncMessagesToServer: false`; dashboard `setMessages` is a local view update only and the dashboard connection never submits native visitor turns.

- [ ] **Step 5: Remove dashboard dependence on `ConversationDO`**

Replace `useConversationWs` message/status handling with native chat synchronization and parent summary events. Preserve customer-update invalidation through a project-parent custom event.

- [ ] **Step 6: Run unit, Agent, and production builds**

```bash
bun test src/lib/inbox/public-message-adapter.test.ts src/hooks/use-public-chat-agent.test.tsx src/hooks/use-sidechat-agent.test.tsx
bun run lint
bun run build
```

Expected: PASS.

- [ ] **Step 7: Verify the authenticated dashboard in the real browser**

Run `bun run dev`, open the conversations route, and verify list pagination/filter/search, selection, transcript loading, human reply, takeover during an AI stream, close/reopen, snooze, assignment, image message, delivery/read markers, Sidechat, reconnect, and mobile layout. Capture screenshots for desktop and mobile evidence.

- [ ] **Step 8: Commit dashboard Agent clients**

```bash
git add src worker/index.ts worker/routes
git commit -m "feat: use agents for dashboard conversations"
```

---

### Task 9: Replace the widget SSE/polling client with native Agent chat

**Files:**
- Create: `widget/agent-chat-bridge.tsx`
- Create: `widget/public-message-adapter.ts`
- Create: `widget/agent-chat-bridge.test.tsx`
- Modify: `widget/index.ts:1-7065`
- Modify: `widget/vite.config.ts`
- Modify: `worker/index.ts:813-1150`
- Modify: `worker/routes/public-agent-handlers.ts`

**Interfaces:**
- Consumes: Widget child session, `useAgent`, `useAgentChat`, and public UI messages.
- Produces: A headless native-chat bridge with an imperative controller for the existing widget DOM and no public POST/SSE/polling dependency.

- [ ] **Step 1: Write failing bridge tests**

Mock the public return contracts of `useAgent` and `useAgentChat`, not Cloudflare's wire frames. Cover session establishment, bridge rerender on token refresh, native initial message replacement, streaming status, recovery status, human-mode empty completion, server-pushed human reply, safe conversation-state update, message deletion, identity reset, stop/cancel, terminal connection error, listener cleanup, and unmount. The Workers public-child integration tests remain responsible for the real protocol.

Run:

```bash
bun test widget/agent-chat-bridge.test.tsx
```

Expected: FAIL because the client does not exist.

- [ ] **Step 2: Build a headless native-chat bridge**

Mount a headless component with `createRoot` from `react-dom/client`, `useAgent` from `agents/react`, and `useAgentChat` from `@cloudflare/ai-chat/react`. The bridge renders no visible UI; it forwards native messages/status/error/recovery state to the existing DOM controller and exposes `sendMessage()` and `stop()`. Set `syncMessagesToServer: false` so client-side view updates cannot emit direct transcript-replacement frames. Do not instantiate only `WebSocketChatTransport`: the complete hook also owns initial-message sync, server-pushed messages, resumption, recovery, and multi-client deduplication. Do not copy or parse Cloudflare's internal wire frames.

Pass `session.host` to `useAgent` so nested HTTP message loading and WebSocket routing target ReplyMaven rather than the embedding site's origin.

Expose this interface:

```typescript
export interface WidgetChatActivity {
  status: "submitted" | "streaming" | "ready" | "error";
  isServerStreaming: boolean;
  isRecovering: boolean;
  error: Error | undefined;
}

export interface WidgetAgentChatClient {
  connect(session: PublicChatSessionResponse): void;
  disconnect(): void;
  send(input: WidgetPublicSendInput): Promise<void>;
  stop(): void;
  messages(): PublicMessageRecord[];
  onMessages(listener: (messages: PublicMessageRecord[]) => void): () => void;
  onActivity(listener: (activity: WidgetChatActivity) => void): () => void;
  onConversationState(listener: (state: PublicChatChildState) => void): () => void;
}
```

Implement `connect()` by rendering/updating the headless bridge with the signed session. Implement `disconnect()` by unmounting it. Token refresh rerenders with the new token in both `queryDeps` and the chat body, matching the existing Sidechat hook pattern.

- [ ] **Step 3: Replace the widget transport while preserving rendering**

Remove custom SSE parsing, `conversationHistoryBuffer`, message polling, the legacy `/ws` connection, and duplicate stream guards. Keep DOM message rendering, quick actions/topics, image upload, page context, notifications, unread badge, presence, delivery/read reporting, inquiry/contact UI, `identify()`, and `reset()`.

Send page context and image URLs in the native request body; the server validates and persists them in the submitted UI message metadata.

- [ ] **Step 4: Add bundle and protocol gates**

```bash
bun run widget:build
test "$(gzip -c dist-widget/widget-embed.js | wc -c | tr -d ' ')" -le 100000
```

Expected: widget build succeeds and gzip size remains at or below 100,000 bytes. Record the before/after raw and gzip bytes in the commit message body.

- [ ] **Step 5: Run widget tests and build**

```bash
bun test widget/agent-chat-bridge.test.tsx
bun run widget:build
bun run build
```

Expected: PASS.

- [ ] **Step 6: Verify the real embedded widget**

Run `bun run dev` and `bun run widget:watch`, then exercise `/test-widget.html`: new conversation, history restoration, streaming, reload mid-stream, human handoff, Telegram reply, closed conversation reopen, background notification, identity reset, image upload, multiple tabs, offline/reconnect, and narrow mobile viewport. Confirm there is no request to the legacy POST-message, GET-message, or conversation WebSocket routes.

- [ ] **Step 7: Commit the native widget client**

```bash
git add widget public/widget-embed.js worker
git commit -m "feat: use native Agent chat in widget"
```

---

### Task 10: Move cross-system queries, analytics, customer linkage, and retention

**Files:**
- Modify: `worker/agents/maven/maven-project-agent.ts`
- Modify: `worker/agents/sidechat/sidechat-context.ts`
- Modify: `worker/services/customer-service.ts`
- Modify: `worker/services/customer-identity-service.ts`
- Modify: `worker/services/dashboard-service.ts`
- Modify: `worker/services/billing-service.ts`
- Modify: `worker/services/conversation-retention-service.ts`
- Modify: `worker/mcp-server.ts`
- Modify: `worker/index.ts:3300-3405, 4036-4165, 7808-7858`
- Create: `worker/agents/maven/project-conversation-queries.integration.test.ts`
- Modify: `worker/services/conversation-retention-service.test.ts`

**Interfaces:**
- Consumes: Parent directory query APIs and child transcript/state RPC.
- Produces: Zero steady-state D1 conversation/message reads outside the legacy adapter and migration verifier.

- [x] **Step 1: Write failing cross-system tests**

Cover customer conversation count/detail, promote/link visitor, merge customers, delete customer, multi-project dashboard stats, billing usage-log filtering, Sidechat public context, MCP transcript reads, archive scheduling, unarchive cancellation, retention deletion of public/Sidechat children plus conversation-scoped R2 objects, and project deletion through the existing `destroyProjectData()` cleanup.

- [x] **Step 2: Add project-level query RPCs**

Implement `listByCustomer`, `listByVisitor`, `getProjectStats`, `getUsageLog`, `extractMetadataKeys`, and `reconcileDirectory` against parent SQL. For multi-project pages, Hono fetches the user's project IDs from D1, calls those parents with bounded concurrency of five, and combines results.

- [x] **Step 3: Move Sidechat public context to the sibling child**

Resolve `pub_<conversationId>` under the same parent and call `getPublicContextSnapshot({ newestMessages: 40 })`. Remove Sidechat's D1 `MessageRow`/`ConversationRow` dependency and preserve its current 40-message bound and archive checks.

- [x] **Step 4: Move customer linkage operations**

Keep customer profiles and `customer_visitors` in D1. After the D1 identity transaction succeeds, call idempotent parent/child updates keyed by a mutation ID. A failed Agent update must be retried through the parent queue; repeated mutation IDs return the original result.

- [x] **Step 5: Move dashboard statistics and billing logs**

Keep the D1 `usage` counter for limits and invoices. Replace conversation/message table scans with project-parent aggregates. Preserve response fields, date bounds, status filters, metadata filtering, and bot-message counts.

- [x] **Step 6: Move retention to Agent schedules**

On archive, schedule the parent's `purgeConversation` callback at `archivedAt + 60 days` with `{ idempotent: true }` and persist the schedule ID in child state/directory. On unarchive, cancel it. Purge obtains the child attachment manifest, removes conversation-scoped R2 keys, calls the SDK's idempotent `deleteSubAgent(MavenChatAgent, childName)` for both children, and removes the directory row. Preserve `destroyProjectData()` so project deletion enumerates and deletes every public/private child before destroying the parent. Keep the existing cron only as a reconciliation sweep until legacy removal.

- [x] **Step 7: Run cross-system tests and the boundary test**

```bash
bun test worker/services/conversation-retention-service.test.ts worker/conversations/public-conversation-boundary.test.ts
bun run test:agents -- worker/agents/maven/project-conversation-queries.integration.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit the remaining consumer migration**

```bash
git add worker
git commit -m "refactor: move conversation consumers to agents"
```

---

### Task 11: Backfill and one-shot cutover

> **Scope revision (2026-08-14):** Only two production projects carry paying
> traffic (LovablehTML and replymaven), and the release process is
> test-locally-then-deploy — no staged production flip, no rollback window.
> The per-project cutover gate, the D1 compatibility projection, the
> projection outbox, and the seven-day stabilization phase were removed.
>
> **Second revision (same day):** the dual runtime itself was removed. The
> `PUBLIC_CONVERSATION_STORE` flag, the D1 store, the directory mirror,
> `ChatService`, `ConversationDO`, the widget SSE/polling routes, and the
> legacy dashboard WebSockets are deleted; the Agent runtime is
> unconditional. What survives of Task 12 is only the destructive final
> step: dropping the frozen D1 `conversations`/`messages` tables (and the
> checkpoint table, backfill tooling, and `legacy-conversation-reader.ts`
> with them) once the production backfill has been verified.

**Files:**
- Create: `worker/migrations/conversation-runtime-backfill.ts`
- Create: `worker/migrations/conversation-runtime-backfill.test.ts`
- Create: `worker/routes/conversation-runtime-admin.ts`
- Create: `worker/routes/conversation-runtime-admin.test.ts`
- Create: `worker/conversations/legacy-conversation-reader.ts`
- Modify: `worker/conversations/agent-public-conversation-store.ts`
- Modify: `worker/agents/maven/maven-project-agent.ts`
- Modify: `worker/agents/maven/maven-chat-agent.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Consumes: Complete D1 and Agent store implementations.
- Produces: Resumable directory backfill, lazy transcript import, and a parity verification report.

- [x] **Step 1: Keep the run stateless**

There is no checkpoint table. The backfill and verify admin endpoints take an optional `cursor` in the request body and return `{ complete, nextCursor, counts }`; the operator passes the cursor back until `complete`. Reruns are idempotent because the parent directory upserts summaries by revision, so a failed run restarts from the beginning at worst. The only D1 migration the runtime needs is `0063` (billing).

Tests must propagate a failed parent reconcile without advancing the cursor, avoid duplicate parent rows, reject a transcript checksum mismatch, and report directory IDs present on only one side.

- [x] **Step 2: Implement bounded directory backfill**

Read 100 legacy conversations ordered by `(project_id, id)`, map them to summaries, and call one parent batch RPC per project. Persist the next cursor only after every parent confirms the batch. Reruns update rows by revision rather than creating duplicates. The batch size exists for Workers request limits, not fleet orchestration; the two production projects complete in a handful of calls.

- [x] **Step 3: Mirror directory mutations while legacy remains authoritative**

After each successful D1 mutation, re-read the latest D1 row and send its normalized summary plus `(updatedAtMs, summaryChecksum)` to the parent. Keep legacy and Agent child revisions in separate source epochs. Because D1 timestamps can collide within one second, allow a same-timestamp checksum correction. The dashboard continues reading D1 while the flag is `legacy`, so the directory is not exposed as authoritative early. The mirror only matters while the flag is `legacy`; after the cutover deploy no legacy writes exist.

- [x] **Step 4: Implement lazy transcript import**

On first Agent access, import the ordered D1 transcript, including system rows, and state with a checksum. After import succeeds, every mutation is Agent-authoritative. There is no reverse projection into D1: the legacy tables freeze at their pre-cutover contents and remain only as the import source and parity baseline until Task 12 drops them.

- [x] **Step 5: Add protected admin operations**

Expose existing-admin-only handlers for `backfill` and `verify`. Both accept `{ cursor?, limit? }` and return counts and opaque cursors, never message content, tokens, or secrets.

- [x] **Step 6: Verify parity as a report, not a gate**

For each batch compare conversation IDs, operational fields, message count, latest message ID, and SHA-256 transcript checksum, and return the counts in the response. Parity is clean when every batch of a full walk reports `mismatchCount: 0`. The report is operator information for the cutover deploy and the final Task 12 evidence; nothing stores or reads it.

- [x] **Step 7: Run migration and full regression tests locally**

```bash
bun run db:migrate:dev
bun test worker/migrations/conversation-runtime-backfill.test.ts worker/routes/conversation-runtime-admin.test.ts
bun test
bun run test:agents
bun run lint
bun run build
bun run widget:build
```

Expected: PASS with `PUBLIC_CONVERSATION_STORE=legacy` and again locally with `PUBLIC_CONVERSATION_STORE=agent`.

- [x] **Step 8: Commit migration tooling without deploying**

```bash
git add worker wrangler.jsonc
git commit -m "feat: add conversation runtime migration tooling"
```

- [ ] **Step 9: Cut over in one release**

Each step is manual and ordered:

1. apply `0063_idempotent_message_usage_credits.sql` to production D1 (`bun run db:migrate:prod`);
2. push to `main` — the worker auto-deploys, and that deploy IS the cutover: the Agent runtime is unconditional and the deploy also applies the `v3-delete-conversation-do` Durable Object deletion;
3. run the backfill admin endpoint for the two production projects, passing each response's `nextCursor` back until `complete` — legacy writes have stopped, so the run cannot go stale;
4. run verify the same way and confirm every batch reports `mismatchCount: 0` for both projects;
5. run `bun run widget:deploy` to upload the Agent widget.

The Agent widget speaks no legacy transport, so the widget upload must stay strictly after the worker deploy. Between steps 2 and 3 the dashboard inbox may be incomplete — conversations appear as they are backfilled or touched; visitor transcripts are unaffected because per-conversation import is lazy. There is no rollback: the old worker cannot be redeployed after `v3-delete-conversation-do`, so recovery means restoring D1 from backup.

---

### Task 12: Remove the legacy runtime and D1 conversation storage

> **Scope revision (2026-08-14):** the code-deletion half of this task was
> pulled forward and shipped with Task 11 — legacy routes, `ConversationDO`
> (including the `v3-delete-conversation-do` Wrangler migration), the
> directory mirror, `ChatService`, the D1 store (replaced by the read-only
> `legacy-conversation-reader.ts`), the dashboard/customer legacy
> WebSockets, and the runtime flag are already gone. What remains here is
> the destructive final cleanup after the production backfill is verified.

**Files:**
- Delete: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts`
- Delete: `worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts`
- Delete: `worker/chat-runtime/streaming/create-widget-sse-response.ts`
- Delete: `worker/chat-runtime/streaming/create-widget-sse-response.test.ts`
- Delete: `worker/chat-runtime/streaming/map-agent-events-to-sse.ts`
- Delete: `worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts`
- Delete: `worker/durable-objects/conversation-do.ts`
- Delete: `worker/realtime/broadcast.ts`
- Delete: `worker/realtime/broadcast.test.ts`
- Delete: `worker/realtime/upgrade.ts`
- Delete: `src/lib/use-conversation-ws.ts`
- Delete: `src/lib/use-conversation-ws.test.ts`
- Delete: `shared/ws-events.ts`
- Delete: `worker/services/chat-service.ts`
- Delete: `worker/conversations/d1-public-conversation-store.ts`
- Delete: `worker/migrations/conversation-runtime-backfill.ts`
- Delete: `worker/migrations/conversation-runtime-backfill.test.ts`
- Delete: `worker/routes/conversation-runtime-admin.ts`
- Delete: `worker/routes/conversation-runtime-admin.test.ts`
- Create: `worker/routes/conversation-runtime-integrity.ts`
- Modify: `worker/db/schema.ts:442-566, 645-668, 1050-1070`
- Create: `worker/db/drizzle/0064_remove_legacy_conversation_storage.sql`
- Modify: `worker/index.ts`
- Modify: `worker/types.ts`
- Modify: `wrangler.jsonc:60-78`
- Modify: `worker-configuration.d.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Verified Agent-authoritative production state after the one-shot cutover.
- Produces: One conversation runtime, no D1 conversations/messages, no `ConversationDO`, no public SSE/polling endpoints.

- [x] **Step 1: Strengthen the source-boundary deletion test**

Make the test require zero production imports of D1 `conversations`, D1 `messages`, `ChatService`, `CONVERSATION_DO`, legacy broadcast helpers, and custom public SSE modules. Allow only the historical migration reader (`legacy-conversation-reader.ts`) and its test fixture until their removal in this task.

- [ ] **Step 2: Remove foreign keys that point at conversations**

Keep `tool_executions.conversation_id` and `visitor_bans.banned_from_conversation_id` as nullable text columns with indexes, but remove their foreign keys. Then remove `messages` and `conversations` from `worker/db/schema.ts` and Drizzle exports.

Generate `0064_remove_legacy_conversation_storage.sql` and inspect it to ensure it preserves tool-execution and visitor-ban rows before dropping the legacy tables.

- [x] **Step 3: Remove legacy routes and runtime code**

Delete public POST-message SSE, GET-message polling, legacy conversation WebSocket, dashboard conversation WebSocket, customer-project WebSocket, old broadcast helpers, and the legacy store implementation. Keep the new Agent-session routes and any stable REST endpoints that now delegate to the Agent store.

- [x] **Step 4: Remove `ConversationDO` safely**

Delete its binding and export. Add this new Wrangler migration after the existing tags:

```json
{
  "tag": "v3-delete-conversation-do",
  "deleted_classes": ["ConversationDO"]
}
```

Regenerate `worker-configuration.d.ts` with:

```bash
bun run cf-typegen
```

- [ ] **Step 5: Remove migration-only projection/checkpoint code**

Build the final counts/checksums-only parity-report key at export time:

```typescript
const parityReportKey =
  `_migration-reports/conversation-runtime/final-${Date.now()}.json`;
```

Write it to `UPLOADS` and record the resulting R2 key in the release evidence. Then delete the backfill/verify service and admin handlers. Keep a read-only Agent integrity endpoint for operational diagnostics. `0064_remove_legacy_conversation_storage.sql` drops only the two legacy tables; there is no checkpoint table.

- [x] **Step 6: Update repository documentation**

Update `AGENTS.md` to state:

- public and Sidechat transcripts live in child Agent SQLite;
- D1 has no conversation/message tables;
- `MavenProjectAgent` serves the dashboard directory;
- `MavenChatAgent` is the shared public/private runtime;
- widget and dashboard use native Agent chat;
- retention deletes child Agents and scoped R2 attachments.

- [ ] **Step 7: Run final static, unit, integration, build, and bundle verification**

```bash
rg -n "CONVERSATION_DO|ConversationDO|handleWidgetMessageTurn|createWidgetSseResponse|from\(messages\)|from\(conversations\)" worker src widget shared wrangler.jsonc
bun test
bun run test:agents
bun run lint
bun run build
bun run widget:build
test "$(gzip -c dist-widget/widget-embed.js | wc -c | tr -d ' ')" -le 100000
```

Expected: `rg` returns no production matches; all commands pass.

- [ ] **Step 8: Re-run real dashboard and widget verification**

Repeat the Task 8 and Task 9 real-browser matrices with the legacy runtime physically absent. Verify new and imported conversations, public/Sidechat isolation, human takeover, Telegram, customer linking, billing-limit enforcement, MCP transcript access, archive/unarchive, and retention scheduling.

- [ ] **Step 9: Commit legacy removal**

```bash
git add -A
git commit -m "refactor: remove legacy conversation runtime"
```

- [ ] **Step 10: Stop for final destructive-production approvals**

Request separate explicit approval before applying `0064_remove_legacy_conversation_storage.sql`, deploying the Wrangler `deleted_classes` migration, or uploading the final widget. Report that the D1 table drop and Durable Object class deletion are destructive and only recoverable from backups/exports.

---

## Release sequence and rollback boundaries

1. **Cutover release:** Tasks 1-11 plus the legacy-runtime deletion ship together in one deploy (Task 11 Step 9). The Agent runtime is unconditional, `ConversationDO` is deleted by the same deploy, and Agent SQLite becomes authoritative. Recovery afterwards means restoring D1 from backup, not redeploying.
2. **Cleanup release:** Task 12's remaining steps drop the frozen D1 conversation tables, the checkpoint table, and the migration reader/backfill tooling once the production backfill has been verified. After this point recovery requires an explicit Agent transcript export.

## Final acceptance checklist

- [ ] Both `pub_` and `sc_` children execute through the same exported `MavenChatAgent` class.
- [ ] Public and private transcripts cannot be read through each other's claims or RPC methods.
- [ ] One dashboard list request performs one project-parent directory query and zero child fan-out.
- [ ] Every public message/state mutation is serialized by its public child.
- [ ] The model sees bounded context without deleting stored public history.
- [ ] Human takeover aborts or quarantines the active AI turn before persisting the human reply.
- [ ] Widget reload resumes the native Agent stream without duplicate messages.
- [ ] Telegram, MCP, dashboard, customer, billing-log, statistics, upload, email, and retention paths use Agent conversation APIs.
- [ ] D1 retains product/business data but no conversation or message tables.
- [ ] No steady-state compatibility projection or dual message write remains.
- [ ] `ConversationDO`, custom public SSE, polling, and legacy realtime code are removed.
- [ ] Full tests, lint, dashboard build, widget build, bundle budget, and real-browser matrices pass.
