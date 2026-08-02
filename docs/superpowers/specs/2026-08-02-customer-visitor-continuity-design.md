# Customer and Visitor Continuity

**Date:** 2026-08-02
**Status:** Approved

## Problem

ReplyMaven needs one durable customer profile to own all of that customer's
support threads. It does not need an analytics identity graph, identity event
history, or per-identifier activity tracking.

An anonymous widget installation still assigns a device-local `visitorId`.
After the site or a dashboard user identifies that visitor as a customer,
ReplyMaven must attach the visitor's past and future threads to that customer.

## Goals

1. Store canonical project-scoped customers with external ID, email, profile,
   and primitive custom fields.
2. Map one or more anonymous widget visitor IDs to a customer.
3. Attach all same-project threads for a mapped visitor ID to the customer,
   regardless of conversation status or archive state.
4. Resolve several devices to one customer through a trusted signed external
   ID, with trusted email as a fallback.
5. Keep unsigned visitor contact data conversation-scoped.

## Non-goals

- Analytics identities, events, cohorts, funnels, or session replay.
- Multiple external-ID aliases or historical email aliases.
- First-seen or last-seen timestamps per visitor mapping.
- Device profiling beyond the existing opaque widget visitor ID.
- Customer memory, interaction summaries, AI context, retention signals, or
  upgrade scoring.
- Fuzzy matching or automatic merges.

## Data model

### `customers`

Each project-scoped customer contains:

- `id`: internal UUID.
- `projectId`: tenant boundary.
- `externalId`: nullable stable ID from the site owner's application.
- `email`: nullable current normalized trusted email.
- `name`, `phone`, and primitive `customFields`.
- customer-level `firstSeenAt` and `lastSeenAt`, derived from linked
  conversation activity only.
- `createdAt` and `updatedAt`.

`(projectId, externalId)` and `(projectId, email)` are unique when the value is
present. External IDs remain case-sensitive. Emails are trimmed and lowercased.
Changing either field replaces the current identifier; old aliases are not
retained.

Customer-level activity bounds are updated atomically. The first linked
conversation or visitor message initializes both bounds, and concurrent device
activity can widen but never narrow the recorded range.

### `customer_visitors`

This is a continuity lookup table, not an identity history:

- `id`: internal UUID.
- `projectId` and `customerId`.
- `visitorId`: the existing opaque widget visitor ID.
- `linkedBy`: `dashboard` or `signed_widget`.
- `createdAt`.

`(projectId, visitorId)` is unique. There are no per-visitor first/last-seen,
trusted-at, email, external ID, or analytics fields.

### `conversations.customerId`

Every linked conversation stores the canonical customer UUID directly. The
existing `visitorId`, `visitorName`, and `visitorEmail` remain thread snapshots.
Deleting a customer sets `customerId` to null while retaining the support
thread.

## Resolution behavior

### Dashboard creation

A dashboard customer requires `externalId` or email. Creation checks the two
unique customer fields in the current project. A duplicate or cross-field
conflict returns 409 without mutation.

Database uniqueness remains authoritative under concurrency. If two creates,
updates, promotions, links, or signed identifies pass preflight together, the
losing request re-resolves the committed rows and returns the normal existing
customer or conflict result instead of leaking a database error.

### Promotion and linking

Promoting a conversation or linking it to an existing customer creates one
`customer_visitors` row for the conversation's visitor ID, then attaches every
same-project conversation with that exact visitor ID. Conversation status and
auto-resolution never participate.

### Signed widget identification

The site backend signs a short-lived project-scoped payload containing
`externalId` or email plus optional profile fields. ReplyMaven resolves the
customer directly from `customers.externalId` or `customers.email`, then adds
the current visitor ID to `customer_visitors` and backfills that visitor's
threads. A second device with the same external ID adds another visitor row to
the same customer.

Signed identify calls from one widget are serialized in invocation order and
return an awaitable promise. Rejections are surfaced to the site integration,
and `reset()` cancels queued work from the previous visitor generation.

If external ID and email resolve to different customers, or the visitor ID is
already mapped elsewhere, the operation fails without mutation. External ID is
preferred whenever available.

An already-mapped visitor may be enriched only when at least one supplied
external ID or email resolves to that same customer. If neither canonical
field resolves, the request conflicts instead of relabeling the mapped
customer. This also protects shared browsers when a site forgets to call
`reset()` during an account switch.

### Unsigned contact data

Unsigned widget name, email, phone, and metadata update only the current
conversation snapshot. They never resolve or create a customer.

### Logout

`ReplyMaven.reset()` aborts in-flight widget work, clears conversation and draft
state, and rotates the anonymous visitor ID. Existing customer/visitor mappings
remain as historical continuity links.

## Dashboard

The customer detail page shows:

1. current profile fields, including the stable external ID;
2. connected visitor IDs with link source and linked date;
3. every linked support thread in reverse chronological order;
4. merge and delete actions.

The UI uses “Connected visitors” rather than “Identities.”

Customer mutations also publish a project-scoped realtime event. Open customer
lists, customer details, and inbox pages invalidate only that project's
customer cache, including profile-only signed identifies that changed no
conversation.

## Migration

The unshipped `0061` migration is rewritten before release:

1. Create `customers` with direct external ID and email uniqueness.
2. Create `customer_visitors`.
3. Add nullable `conversations.customer_id` and indexes.
4. Add the encrypted signing secret setting.
5. Do not infer customers from existing conversation snapshots.

No production migration has been applied, so no compatibility migration from
`customer_identities` is needed.

## Testing

- Schema and migration tests prove `customer_visitors` exists and
  `customer_identities` does not.
- Service tests cover direct external ID/email resolution, conflicts, email
  replacement without aliases, multi-device continuity, status-independent
  history linking, concurrent uniqueness recovery, atomic activity bounds,
  merge, delete, and project isolation.
- Route, widget, frontend, TypeScript, lint, and production-build checks remain
  green.
