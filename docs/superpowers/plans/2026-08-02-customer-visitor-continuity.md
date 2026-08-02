# Customer and Visitor Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analytics-style customer identity graph with canonical
customers plus the minimum visitor-ID mapping needed to keep support threads
together.

**Architecture:** Store external ID and current trusted email directly on the
project-scoped customer. Use `customer_visitors` only to map opaque widget
visitor IDs to that customer, and continue storing the resolved customer UUID
on each conversation.

**Tech Stack:** Bun, TypeScript, Hono, Cloudflare Workers/D1, Drizzle ORM,
React 19, TanStack React Query, Zod, Web Crypto/HMAC-SHA256.

## Global Constraints

- Use Bun only.
- Scope every customer, visitor mapping, and conversation operation by
  `projectId`.
- Unsigned browser contact data remains conversation-only.
- Trusted resolution comes only from the authenticated dashboard or a valid
  signed token.
- Prefer `externalId`; allow normalized trusted email as a fallback.
- Conflicts fail without mutation and never auto-merge.
- Keep conversation status and auto-resolution out of continuity logic.
- Do not add per-visitor activity timestamps, email aliases, external-ID
  aliases, memory, interactions, or AI context.
- Use function declarations for named functions and React components.
- Follow red-green-refactor for production behavior changes.
- Do not commit, push, deploy, apply production migrations, or upload the
  widget without separate approval.

---

### Task 1: Narrow contracts, schema, and migration

**Files:**
- Modify: `shared/customer-types.ts`
- Modify: `worker/db/schema.ts`
- Modify: `worker/db/customer-schema.test.ts`
- Modify: `worker/db/customer-migration.test.ts`
- Replace: `worker/db/drizzle/0061_customer_identity.sql` with
  `worker/db/drizzle/0061_customer_continuity.sql`
- Modify: `worker/db/drizzle/meta/0061_snapshot.json`
- Modify: `worker/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces `CustomerVisitorDto` and `CustomerDetail.visitors`.
- Produces `customers.externalId`, `customerVisitors`, and
  `conversations.customerId`.

- [ ] **Step 1: Write failing schema and migration assertions**

```ts
expect(names).toContain("customer_visitors");
expect(names).not.toContain("customer_identities");
expect(customers.externalId).toBeDefined();
expect(customerVisitors.visitorId).toBeDefined();
```

- [ ] **Step 2: Run the tests and verify red**

```bash
bun test worker/db/customer-schema.test.ts worker/db/customer-migration.test.ts
```

Expected: FAIL because the current schema still exports
`customerIdentities` and the migration creates `customer_identities`.

- [ ] **Step 3: Implement the minimal schema and contract change**

```ts
export interface CustomerVisitorDto {
  id: string;
  visitorId: string;
  linkedBy: "dashboard" | "signed_widget";
  createdAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  visitors: CustomerVisitorDto[];
  conversations: CustomerConversationDto[];
}
```

Add nullable `external_id` to customers with unique project/external-ID and
project/email indexes. Create `customer_visitors` with a unique
`(project_id, visitor_id)` index and no activity columns.

- [ ] **Step 4: Run focused tests and verify green**

```bash
bun test worker/db/customer-schema.test.ts worker/db/customer-migration.test.ts
```

---

### Task 2: Resolve customers directly and map visitors only

**Files:**
- Modify: `worker/services/customer-service.ts`
- Modify: `worker/services/customer-service.test.ts`
- Modify: `worker/services/customer-identity-service.ts`
- Modify: `worker/services/customer-identity-service.test.ts`
- Modify: `worker/services/chat-service.test.ts`

**Interfaces:**
- `resolveCustomer(projectId, { externalId, email })` queries customer fields.
- `findCustomerByVisitorId(projectId, visitorId)` joins `customer_visitors` to
  customers.
- Promotion, linking, signed identify, merge, and delete retain their existing
  public result contracts.

- [ ] **Step 1: Write failing direct-resolution tests**

Assert that customer creation stores `external_id` and normalized email on the
customer, creates no visitor row, and rejects duplicates without mutation.

- [ ] **Step 2: Write failing continuity tests**

Assert exact visitor mapping, multi-device external-ID resolution, email
replacement without aliases, status-independent history attachment, and merge
movement of visitor rows.

- [ ] **Step 3: Run service tests and verify red**

```bash
bun test worker/services/customer-service.test.ts worker/services/customer-identity-service.test.ts worker/services/chat-service.test.ts
```

- [ ] **Step 4: Implement direct customer resolution and visitor mapping**

Replace identity-kind normalization and rows with direct customer lookups and
one helper that inserts or updates only `customer_visitors`. Keep all conflict
preflight ahead of the D1 batch.

- [ ] **Step 5: Run service tests and verify green**

```bash
bun test worker/services/customer-service.test.ts worker/services/customer-identity-service.test.ts worker/services/chat-service.test.ts
```

---

### Task 3: Remove identity-list UI and terminology

**Files:**
- Modify: `worker/routes/customer-handlers.test.ts`
- Modify: `worker/routes/customer-handlers.ts`
- Modify: `src/lib/customers.test.ts`
- Modify: `src/lib/customers.ts`
- Modify: `src/components/customers/CustomerFormDialog.tsx`
- Modify: `src/pages/CustomerDetail.tsx`
- Modify: `src/pages/Customers.tsx`
- Modify: `src/pages/WidgetInstallation.tsx`
- Modify: `src/lib/widget-installation-snippets.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Customer DTOs expose `externalId` and `visitors`, not `identities`.
- Signed widget route/token behavior remains unchanged externally.

- [ ] **Step 1: Update fixtures to require `externalId` and `visitors`**

```ts
const customer = {
  externalId: "account-123",
  visitors: [],
  conversations: [],
};
```

- [ ] **Step 2: Run route/frontend tests and verify red**

```bash
bun test worker/routes/customer-handlers.test.ts src/lib/customers.test.ts
```

- [ ] **Step 3: Implement visitor-only dashboard presentation**

Show external ID in the profile editor and replace the identity list with a
“Connected visitors” list containing visitor ID, link source, and linked date.
Remove identity aliases and per-identity activity copy from product docs.

- [ ] **Step 4: Run focused tests, TypeScript, and lint**

```bash
bun test worker/routes/customer-handlers.test.ts src/lib/customers.test.ts
./node_modules/.bin/tsc -b
bun ./node_modules/eslint/bin/eslint.js src/components/customers src/pages/CustomerDetail.tsx src/pages/Customers.tsx src/lib/customers.ts worker/routes worker/services/customer-service.ts
```

---

### Task 4: Full continuity verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run the full suite and compiler**

```bash
bun test
./node_modules/.bin/tsc -b
```

- [ ] **Step 2: Prove analytics identity storage is absent**

```bash
rg -n "customer_identities|customerIdentities|CustomerIdentityDto|first_seen_at.*visitor|last_seen_at.*visitor" shared src widget worker AGENTS.md
```

Expected: no runtime/schema/UI matches. Signed token/security names may retain
the word “identity” because they describe the identify operation, not stored
analytics identities.

- [ ] **Step 3: Lint and build both bundles**

```bash
bun run lint
bun ./node_modules/vite/bin/vite.js build
bun ./node_modules/vite/bin/vite.js build --config widget/vite.config.ts
```

- [ ] **Step 4: Check the worktree**

```bash
git diff --check
git status --short --branch
```

Leave all work unstaged on `codex/customer-identity-memory` and report that no
external mutation occurred.
