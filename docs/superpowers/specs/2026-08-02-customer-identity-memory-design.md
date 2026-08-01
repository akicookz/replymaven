# Customer Identity and AI Memory

**Date:** 2026-08-02
**Status:** Approved design — pending user review and implementation plan

## Problem

ReplyMaven currently stores identity on individual conversations. Each
conversation owns a device-generated `visitorId`, optional `visitorName` and
`visitorEmail`, and free-form metadata. The widget's `identify()` method only
patches the active conversation. The AI receives the current conversation's
recent messages and contact details, but it cannot reliably connect a person
across conversations or devices.

This creates four product problems:

1. A dashboard user cannot create and manage a durable customer independently
   of a conversation.
2. A temporary visitor cannot be promoted into a durable customer with their
   earlier conversation history attached.
3. Returning customers appear as unrelated visitors when their browser or
   device changes.
4. The AI cannot use relevant customer history to improve support, retention,
   or contextual upgrade recommendations.

## Goals

1. Introduce a durable, project-scoped customer profile with core contact
   fields and typed custom fields.
2. Let dashboard users create customers, promote a visitor to a customer, and
   attach a visitor to an existing customer.
3. Link multiple device and application identities to one customer without
   rewriting historical conversations.
4. Provide a secure widget identification path that cannot unlock private
   history from a claimed email or customer ID alone.
5. Give the AI bounded, auditable customer memory rather than every historical
   raw message.
6. Let dashboard users inspect, correct, and delete generated customer memory.
7. Preserve current inbox, widget, retention, and public API behavior during a
   staged rollout.

## Success criteria

- A dashboard user can create a customer with an email and custom fields before
  that customer has a conversation.
- A dashboard user can promote the visitor in an existing conversation and all
  conversations from that same project/device identity become associated with
  the customer.
- A trusted external customer identity resolves to the same ReplyMaven customer
  across devices and conversations.
- Supplying an unsigned email or external ID never unlocks another customer's
  profile, memory, or conversation history.
- The AI can use relevant prior outcomes and customer fields while answering a
  returning customer, without loading unrelated raw transcripts.
- Customer merge, deletion, and widget logout/reset leave no dangling identity
  mappings.
- Every read and mutation remains scoped by `projectId`.

## Product semantics

### Visitor

A visitor is a temporary browser/device identity. The existing `visitorId`
remains the device identifier used by the widget, presence, bans, realtime
connections, and active-conversation lookup. A visitor does not automatically
become a customer merely by opening the widget or entering an email address.

### Customer

A customer is a durable person profile owned by one ReplyMaven project. It can
exist before or after a conversation. A customer may have multiple linked
identities and multiple conversations.

"Customer" is a dashboard/profile concept, not a new chat message role. The
existing `visitor` message role remains unchanged because it describes the
direction of a message, whether or not the sender has been identified.

### Research basis

The identity shape follows PostHog's documented model:

- anonymous device IDs are linked explicitly to a durable person on
  identification;
- one person may own several distinct IDs;
- historical activity retains its original distinct ID and resolves through a
  person mapping;
- durable attributes belong on the person profile rather than individual
  events.

References: [PostHog identity resolution](https://posthog.com/docs/product-analytics/identity-resolution),
[identifying users](https://posthog.com/docs/product-analytics/identify), and
[person properties](https://posthog.com/docs/product-analytics/person-properties).

ReplyMaven intentionally does not copy PostHog's client trust model. PostHog
uses identity primarily to join analytics. ReplyMaven identity controls whether
private support context can enter an AI turn, so durable linking requires a
dashboard action or a signed server-generated token.

### Identity

An identity is a project-scoped value that connects a visitor or an external
system identifier to one customer. Supported identity kinds are:

- `visitor_id`: ReplyMaven's browser/device UUID.
- `external_id`: the customer's stable ID in the site owner's application.
- `email`: a normalized email used as a fallback identity only when established
  through a trusted path.

The model follows PostHog's useful property: historical records retain the ID
under which they were created, while a separate mapping resolves those records
to a durable person. ReplyMaven adds a trust boundary because, unlike an
analytics timeline, support history may contain private information.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Canonical record | Internal `customers.id` UUID | External IDs and emails can change; internal references remain stable. |
| Preferred external identity | Stable application `external_id` | Safer than mutable or shared email addresses. |
| Email-only customers | Supported through dashboard/server-trusted paths | Covers businesses without application user IDs. |
| Public unsigned `identify()` | Contact snapshot only | Preserves compatibility without allowing history impersonation. |
| Trusted widget identity | Short-lived signed identity token | The complete identity payload is authenticated and cannot be altered in browser devtools. |
| Automatic email merging | No | Matching unverified emails can incorrectly combine people and expose history. |
| Existing data migration | Additive, no inferred customer backfill | Avoids treating historical claimed emails as trusted identities. |
| AI history | Rolling memory plus sourced interaction summaries | Bounded tokens, durable history, and dashboard auditability. |
| Raw historical transcripts | Current conversation only | Reduces privacy exposure and prompt size. |
| Customer deletion | Delete profile/identities/memory; unlink retained conversations | Conversation retention remains controlled by the existing conversation lifecycle. |

## Data model

### `customers`

```ts
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    customFields: text("custom_fields").notNull().default("{}"),
    aiFieldKeys: text("ai_field_keys").notNull().default("[]"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_customers_project").on(table.projectId),
    index("idx_customers_project_email_lower").on(
      table.projectId,
      sql`LOWER(${table.email})`,
    ),
    index("idx_customers_project_updated").on(
      table.projectId,
      table.updatedAt,
    ),
  ],
);
```

`customFields` accepts JSON primitive values (`string`, `number`, `boolean`, or
`null`). Validation limits it to 50 keys, 64 characters per key, 500 characters
per string value, and 16 KB total serialized size. Arrays and nested objects are
out of scope for v1 so prompt formatting and editing remain predictable.

`aiFieldKeys` is the allowlist of custom field keys that may enter the AI
prompt. Core fields and custom fields remain visible to dashboard users, but a
custom field is not sent to the AI unless the owner or trusted signed payload
marks it AI-visible. This supports useful fields such as `plan` and
`renewalDate` without automatically exposing internal or sensitive metadata.

### `customer_identities`

```ts
export const customerIdentities = sqliteTable(
  "customer_identities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["visitor_id", "external_id", "email"],
    }).notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    source: text("source", {
      enum: ["dashboard", "server_api", "signed_widget"],
    }).notNull(),
    trustedAt: integer("trusted_at", { mode: "timestamp" }).notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_customer_identities_project_kind_value").on(
      table.projectId,
      table.kind,
      table.normalizedValue,
    ),
    index("idx_customer_identities_customer").on(table.customerId),
  ],
);
```

Identity normalization rules:

- `visitor_id`: trim and retain exact case; accept only the existing UUID-like
  widget identifier constraints.
- `external_id`: trim and retain exact case. External IDs are case-sensitive.
- `email`: trim and lowercase. No fuzzy matching or provider-specific dot/plus
  normalization.

Only trusted sources create identity rows. Unsigned browser calls never reserve
an email or external ID, preventing identity squatting through the public API.
`trustedAt` means the project owner or their signed backend established the
association. It does not claim that ReplyMaven independently verified ownership
of an email inbox.

### Conversation link

Add a nullable `customerId` foreign key to `conversations`:

```ts
customerId: text("customer_id").references(() => customers.id, {
  onDelete: "set null",
}),
```

Add project/customer and project/customer/activity indexes for customer profile
timelines. `visitorName`, `visitorEmail`, `visitorId`, and conversation metadata
remain in place. The name and email are historical snapshots used by existing
inbox paths; they are not the source of truth for future customer edits.

Conversation creation first checks for a trusted `visitor_id` identity in the
same project. When found, the new conversation receives that `customerId`, and
missing name/email snapshots are populated from the customer. Linked customer
`lastSeenAt` is updated when the visitor sends a message; `firstSeenAt` is set
from the earliest linked conversation during promotion and otherwise at first
trusted identification.

### `customer_interactions`

Each customer conversation can have one durable, regeneratable summary:

```ts
export const customerInteractions = sqliteTable(
  "customer_interactions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    summary: text("summary").notNull(),
    topics: text("topics").notNull().default("[]"),
    outcome: text("outcome"),
    signals: text("signals").notNull().default("{}"),
    userEditedAt: integer("user_edited_at", { mode: "timestamp" }),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_customer_interactions_conversation").on(
      table.conversationId,
    ),
    index("idx_customer_interactions_customer_occurred").on(
      table.customerId,
      table.occurredAt,
    ),
  ],
);
```

`signals` may contain agent-facing, AI-generated indicators such as retention
risk or possible upgrade interest, each with a short evidence-based reason.
These labels never enter the visitor-facing prompt directly.

Interaction summaries survive normal conversation archival/purge because they
are the durable customer memory artifact. Their source link becomes null when a
conversation is purged. They remain until the customer or individual memory
entry is deleted.

### `customer_memory`

One row per customer stores the bounded roll-up used by the AI:

- `customerId` unique foreign key.
- `summary` capped at 4,000 characters.
- `sourceInteractionIds` JSON array.
- `sourceWatermark` timestamp of the newest incorporated interaction.
- `createdAt` and `updatedAt`.

The watermark lets the runtime detect a stale roll-up. If stale, the current
turn may still use recent interaction summaries and enqueue a refresh rather
than blocking the visitor response.

## Identity resolution service

Create a focused `CustomerIdentityService`; do not fold identity rules into
`ChatService`. Its public operations are:

```ts
createCustomer(projectId, input)
updateCustomer(projectId, customerId, input)
promoteConversation(projectId, conversationId, input)
linkConversation(projectId, conversationId, customerId)
identifySignedVisitor(projectId, visitorId, payload)
resolveCustomer(projectId, identities)
mergeCustomers(projectId, targetCustomerId, sourceCustomerId)
deleteCustomer(projectId, customerId)
```

### Resolution precedence

1. Resolve a trusted `external_id` when supplied.
2. Otherwise resolve a trusted normalized `email` identity.
3. Otherwise create a new customer.
4. Link the current `visitor_id` only after the customer is resolved.

If supplied trusted identities resolve to different customers, return a 409
identity conflict and mutate nothing. The dashboard directs the user to the two
profiles and offers an explicit merge. No latest-write-wins identity reassignment
is allowed.

### Promotion from a conversation

Dashboard promotion is trusted because it is session-authenticated and scoped
to a project the dashboard user may access.

Creating a customer from a conversation:

1. Load the operational or archived conversation within the project.
2. Validate the submitted core/custom fields.
3. Create or resolve the customer using the trusted external ID/email rules.
4. Link the conversation's `visitorId` identity to that customer.
5. Set `customerId` on every conversation in the same project with that exact
   `visitorId`.
6. Backfill missing customer name/email from the conversation, but explicit
   form values and existing trusted customer values win.
7. Populate missing name/email snapshots on linked conversations from the
   resolved customer, without rewriting non-null historical snapshots.
8. Enqueue interaction generation for linked, retained closed conversations so
   pre-promotion history can contribute to customer memory.
9. Return the customer plus all updated conversation IDs so the dashboard can
   update its caches.

Promotion never scans for other conversations by claimed email. An agent may
link those conversations manually or merge trusted customer profiles.
Choosing `Link customer` uses the same visitor-identity flow as creation: it
links all same-project conversations with that exact `visitorId`, not only the
conversation currently open in the inbox.

### Merge behavior

The selected target customer survives. The merge operation:

- preflights all identities and project ownership;
- moves source identities, conversations, and interaction summaries to target;
- keeps target core/custom values and only fills empty fields from source;
- deletes source memory and recomputes target memory;
- deletes the source customer after every move succeeds.

The source and target must belong to the same project. A failed preflight or
database batch leaves both profiles unchanged.

## Secure widget identification

### Signed token contract

The preferred widget API is:

```ts
window.ReplyMaven.identify({ token: signedCustomerToken });
```

The site owner's backend creates a short-lived HMAC-SHA256 token using a
project-specific customer identity secret. The token is:

```text
base64url(JSON payload).base64url(HMAC_SHA256(secret, payloadSegment))
```

Payload v1:

```ts
interface CustomerIdentityTokenPayload {
  v: 1;
  projectId: string;
  externalId?: string;
  email?: string;
  name?: string;
  phone?: string;
  customFields?: Record<string, string | number | boolean | null>;
  aiFieldKeys?: string[];
  iat: number;
  exp: number;
}
```

At least one of `externalId` or `email` is required. Tokens default to a
15-minute lifetime and may not exceed one hour. The Worker verifies the
signature with `crypto.subtle`, validates project/expiry/shape, and rejects the
entire payload when invalid. The API response is only an acknowledgment; it
does not return customer fields, memory, identities, or previous conversations.

The project identity secret is generated server-side, encrypted at rest using
the existing encryption service, shown only when created/rotated, and never
included in widget configuration. Rotating it invalidates newly presented old
tokens; already-established identity links remain.

Add an encrypted `customerIdentitySecret` setting to `project_settings`. The
dashboard shows only whether a secret exists plus create/rotate controls; the
plaintext is returned once from the create/rotate response.

### Backward-compatible unsigned identify

The current API remains accepted:

```ts
window.ReplyMaven.identify({
  name: "Sam",
  email: "sam@example.com",
  metadata: { source: "pricing-page" },
});
```

It continues to update the current conversation's name, email, and metadata.
It does not create a customer, create identities, set `customerId`, or enable
cross-conversation AI memory. This is a claimed contact snapshot only.

### Reset/logout

Add `window.ReplyMaven.reset()` as a client-side operation. It:

- closes the widget and realtime connection;
- clears visitor contact data, custom metadata, page context, and active
  conversation state;
- rotates `rm_visitor_id` to a fresh UUID;
- clears local seen/dismissed markers that are scoped to the previous visitor;
- restarts the widget as an anonymous visitor.

No server unlink occurs: historical identity links must remain attached to
their customer's earlier activity. Rotating the device ID prevents future
activity on a shared browser from resolving to that customer.

## Dashboard experience

### Customers navigation and list

Add a `Customers` item to the project navigation and routes:

- `/app/customers`
- `/app/customers/:customerId`

The list supports pagination and search by customer name, normalized email, or
external identity. Each row shows display name, email, selected high-value
custom fields, conversation count, and last seen time. Custom-field filtering,
segments, and cohorts are out of scope for v1.

The page includes a create-customer dialog. Email is required when no external
ID is supplied; at least one stable identity is always required. Custom fields
are edited as typed key/value rows with an explicit "Available to AI" toggle.

### Customer profile

The profile contains:

- editable name, email, phone, and custom fields;
- linked identities with source and first/last seen timestamps (read-only in
  v1; identity corrections use merge or customer deletion);
- all linked conversations in reverse chronological order;
- customer memory and individual interaction summaries;
- agent-facing retention/upgrade signals labelled as AI-generated;
- actions to link a conversation, merge another customer, delete a memory
  entry, regenerate memory, or delete the customer.

Generated summaries always link to their source conversation when it still
exists. Users correct or delete an interaction summary and then regenerate the
rolling memory. The roll-up itself is generated, not a second independently
editable source of truth.

### Inbox integration

The conversation header displays either `Visitor` or `Customer`. Identified
customers link to their customer profile. Anonymous conversations offer:

- `Create customer` — prefilled from the conversation snapshot;
- `Link customer` — searchable customer picker.

Linking or promotion updates React Query list/detail caches for every returned
conversation ID. The inbox layout uses spacing and background contrast rather
than row-separator borders, following the repository UI convention.

## Dashboard API

Session-authenticated, project-scoped endpoints:

```text
GET    /api/projects/:id/customers
POST   /api/projects/:id/customers
GET    /api/projects/:id/customers/:customerId
PATCH  /api/projects/:id/customers/:customerId
DELETE /api/projects/:id/customers/:customerId

POST   /api/projects/:id/customers/:targetCustomerId/merge
POST   /api/projects/:id/conversations/:conversationId/customer

POST   /api/projects/:id/customers/:customerId/memory/regenerate
PATCH  /api/projects/:id/customers/:customerId/interactions/:interactionId
DELETE /api/projects/:id/customers/:customerId/interactions/:interactionId

POST   /api/projects/:id/customer-identity-secret/rotate
```

The conversation/customer endpoint accepts a discriminated body:

```ts
type ConversationCustomerInput =
  | { action: "create"; customer: CreateCustomerInput }
  | { action: "link"; customerId: string };
```

Server-to-server customer CRUD may later be exposed through the existing
project API-key surface, but it is not required for the first dashboard/widget
release.

## Public widget API

```text
POST /api/widget/:projectSlug/identify
```

Body:

```ts
{
  visitorId: string;
  conversationId?: string;
  token: string;
}
```

The route is rate-limited, verifies the signed payload before database reads,
checks any supplied conversation belongs to the project and visitor, resolves
the customer, links the visitor identity, and attaches all matching
project/visitor conversations. It returns:

```ts
{ identified: true }
```

The existing public conversation PATCH remains the unsigned compatibility path.

## AI memory lifecycle

### Interaction generation

When a linked customer conversation closes, enqueue a non-blocking interaction
summary using `executionCtx.waitUntil`. Reopening and closing the conversation
again upserts and regenerates the same interaction row.

The summarizer receives only that conversation and extracts:

- the customer's actual request or goal;
- relevant product/account context explicitly provided;
- troubleshooting or actions already attempted;
- the outcome and unresolved next step;
- durable preferences the customer explicitly stated;
- evidence-based retention or upgrade signals for agents.

It must exclude passwords, access tokens, payment credentials, authentication
codes, full payment details, speculative demographics, medical information,
and unrelated personal details. It treats transcript content as data, never as
instructions.

Summary failure never affects closing the conversation. It is logged without
PII and can be retried from the customer profile.

### Rolling memory generation

After an interaction upsert/delete/merge, regenerate the customer's rolling
memory from the current trusted profile and recent interaction summaries. The
roll-up:

- is capped at 4,000 characters;
- preserves durable facts and recurring issues;
- prefers newer explicit facts when history conflicts;
- removes facts no longer present in any retained source;
- contains no sales/risk scoring labels shown to the visitor;
- records the source interaction IDs and watermark.

The operation is idempotent. Concurrent updates are made safe by comparing the
computed source watermark before persistence; a stale writer does not overwrite
a memory derived from newer interaction data.

When a dashboard user corrects an interaction, the service sets
`userEditedAt`. Automatic regeneration of that conversation's interaction does
not overwrite a user-edited summary unless the user explicitly requests a
source refresh.

### Prompt injection

For an identified customer, the support prompt gains a bounded
`<customer-context>` section containing:

1. core customer fields;
2. custom fields whose keys are in `aiFieldKeys`;
3. the rolling memory;
4. up to three recent interaction summaries.

The current conversation still supplies the only raw message history. Customer
context is escaped, length-limited, and described as untrusted factual context,
not instructions.

Prompt rules require the bot to:

- use history only when relevant to the current request;
- avoid announcing that it has a stored profile or secretly remembers the
  customer;
- never reveal internal retention/upgrade labels or agent notes;
- treat generated memory as fallible and current tool/account evidence as
  higher priority;
- recommend an upgrade only when the customer's stated need matches documented
  plan capabilities;
- never invent pricing, eligibility, discounts, plan features, or account
  state;
- prioritize solving the support problem over making a sale.

Retention and upgrade signals are primarily agent-facing. Visitor-facing
recommendations are grounded in the same knowledge base/guideline/tool evidence
rules as every other support answer.

## Customer deletion and privacy

Deleting a customer:

1. deletes customer identities, interaction summaries, and rolling memory;
2. sets `conversations.customerId` to null through the foreign key;
3. leaves conversation snapshots/messages governed by the existing archive and
   purge lifecycle;
4. clears customer caches and broadcasts affected conversation updates.

The confirmation UI explicitly explains that deleting the profile does not
immediately erase retained support conversations. A separate
"delete customer and all conversations" privacy workflow is out of scope and
should be designed alongside broader data-subject deletion requirements.

Deleting one interaction removes it from future AI context and regenerates the
rolling memory. Editing customer fields or `aiFieldKeys` affects the next AI
turn immediately.

## Existing-data migration

The migration is additive:

1. Create the four customer tables.
2. Add nullable `conversations.customer_id` and indexes.
3. Do not create customers from existing conversation emails or metadata.
4. Do not rewrite `visitorId`, `visitorName`, `visitorEmail`, or metadata.

Existing conversations become associated lazily through dashboard promotion,
manual linking, or trusted signed identification. Promotion attaches every
same-project conversation sharing the exact visitor ID, so earlier anonymous
history is recovered without email inference.

## Error handling

- Invalid/expired signature: generic 401; no indication whether the referenced
  customer exists.
- Identity conflict: 409 with dashboard-safe customer IDs only on authenticated
  endpoints; generic conflict response on public endpoints.
- Duplicate dashboard create: return the existing matching trusted identity and
  ask the user to open/link it rather than silently mutating it.
- Customer not found or wrong project: 404 to avoid tenant enumeration.
- Customer memory generation failure: non-blocking, logged, retryable.
- Malformed custom fields: 400 with field-level validation errors.
- Merge preflight failure: no partial moves.
- Deleted customer during an AI turn: the turn proceeds without customer
  context and persistence guards prevent writing memory back to a deleted row.

## Observability

Add structured, PII-free events for:

- customer created/updated/deleted;
- conversation promoted/linked/unlinked;
- signed identification accepted/rejected/conflicted;
- customers merged;
- interaction summary generated/failed;
- rolling memory regenerated/skipped-as-stale/failed;
- AI turns with customer context present and context character counts.

Logs include project/customer/conversation IDs and reason codes, never emails,
names, token payloads, custom field values, or generated memory.

## Testing

### Service and database tests

- Every customer and identity operation enforces project scope.
- Identity normalization and unique indexes behave per kind.
- Promotion links all and only exact project/visitor conversations.
- Claimed conversation email never creates an identity.
- Conflicting trusted identities return 409 without mutation.
- Merge moves identities/conversations/interactions and recomputes memory.
- Customer deletion cascades profile memory and unlinks conversations.
- Concurrent memory writers cannot overwrite a newer watermark.

### Token tests

- Valid signature, project, expiry, and payload succeed.
- Altered payload/signature, wrong project, expired token, excessive lifetime,
  and missing stable identity fail.
- Signed custom fields cannot be modified after token generation.
- Public success and error responses expose no customer data.

### Route tests

- Dashboard create/list/detail/edit/promote/link/merge/delete flows.
- Public identify attaches only the supplied visitor's project conversations.
- Archived retained conversations can be attached but purging conversations
  cannot recreate deleted customer data.
- Unsigned legacy identify remains conversation-local.

### AI tests

- Anonymous and unverified visitors receive no customer context.
- Identified customers receive only AI-allowlisted fields, rolling memory, and
  capped interaction summaries.
- Customer context cannot override system instructions.
- Internal retention/upgrade labels are absent from visitor-facing prompts.
- Deleted interaction/customer memory disappears from subsequent prompts.
- Upgrade answers remain subject to existing evidence grounding.

### Frontend/widget verification

- Create customer manually and from an anonymous conversation.
- Link a conversation to an existing customer and open the profile timeline.
- Merge duplicates and verify both histories remain accessible.
- Signed identification on two devices resolves one customer.
- Unsigned email cannot unlock customer history.
- `ReplyMaven.reset()` on a shared browser produces a new anonymous visitor.
- Customer fields and memory edits affect the next AI turn.

## Rollout order

1. Add schema and backend services behind customer-context disabled defaults.
2. Deploy dashboard customer CRUD and manual promotion/linking.
3. Add customer profile memory UI while generation remains opt-in/internal.
4. Add identity secret management, signed widget identify, and widget reset.
5. Enable interaction generation and inspect summaries on test projects.
6. Enable customer prompt context after privacy and grounding verification.
7. Document signed identification and legacy unsigned behavior.

Each stage is backward compatible. The widget remains a separate build/upload.
Production migration, Worker deployment, and widget upload require explicit
user approval under the repository deployment rules.

## Out of scope

- Product analytics events, funnels, cohorts, or session replay.
- Company/account/group profiles that contain multiple customers.
- CRM pipelines, lead scoring, campaigns, or autonomous outbound messages.
- Automatic email verification or magic-link login in the widget.
- Automatic merging based on unverified email, name, IP, fingerprint, or fuzzy
  matching.
- Splitting one established identity graph into multiple customers or
  individually deleting linked identities.
- Vector embeddings or semantic search over all customer transcripts.
- Custom-field filters, segments, formulas, or field-definition administration.
- A complete GDPR/CCPA data-subject deletion workflow across all project data.
- Visitor-visible access to their ReplyMaven customer profile or memory.

## Implementation boundaries

- Customer profile/identity logic belongs in dedicated customer services, not
  in `ChatService` or widget route handlers.
- AI memory generation and prompt assembly are separate units with explicit
  typed inputs and character budgets.
- Route handlers perform auth/validation and delegate business rules.
- Frontend customer pages use TanStack Query and existing shadcn components.
- Named functions/components use function declarations and all backend code
  remains Cloudflare Worker compatible.
- All migrations are generated through the existing Bun/Drizzle workflow.
