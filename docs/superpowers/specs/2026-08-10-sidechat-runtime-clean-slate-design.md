# Sidechat Runtime Clean-Slate Design

**Date:** 2026-08-10  
**Status:** Approved for implementation planning  
**Scope:** Remove the custom private Sidechat runtime while preserving its presentation layer, the public Maven runtime, and project tool-audience configuration.

## 1. Outcome

ReplyMaven will return to a clean baseline before adopting Cloudflare `AIChatAgent` for private Sidechat. The cleanup removes the custom D1, ChatService, HTTP-route, ConversationDO, React Query, WebSocket, lease, recovery, and execution implementation built for Sidechat.

The cleanup is not the SDK implementation. It leaves no transitional backend, compatibility route, fake persistence, or alternate Compose flow. The retained Sidechat UI is presentation-only until a later, separately reviewed SDK plan connects it.

## 2. Retained boundaries

The following remain:

- The existing public visitor Maven runtime and its public conversation behavior.
- Migration `0062_maven_tool_audiences.sql`, project tool audience/access settings, and server-side channel authorization primitives. The `sidechat` audience remains a dormant capability until the SDK adapter supplies a private runtime.
- Sidechat presentation components: the pane, responsive conversation-plus-pane layout, shared `ChatThread`, `MessageBubble`, and `Composer` primitives, Start/Open Sidechat entry presentation, compact status presentation, and Add-to-reply UI contract.
- General visual and accessibility fixes made while building the Sidechat UI when they are independent of the removed runtime.
- Public cancellation, handoff, tool-execution, and unified Maven fixes that predate or are independent of the custom Sidechat runtime.

Retained UI components must consume ordinary controlled props. They must not import persistence, network, lease, run, replay, or coordination state.

## 3. Removed runtime

The cleanup removes all of the following:

- D1 migrations `0063_internal_sidechat_channel.sql` and `0064_sidechat_coordination_revision.sql`, their snapshots, and their journal entries. These migrations have not been applied remotely.
- The Sidechat fields on `conversations`: status, run ID, lease expiry, updated time, and revision.
- The custom `messages` channel, kind, and metadata fields introduced for private Sidechat persistence, including their index.
- Sidechat message CRUD, pagination, claim, lease, retry, expiry, settlement, atomic completion, coordination snapshot, and recovery methods from `ChatService`.
- Sidechat HTTP routes, validation contracts, route handlers, and background-turn scheduling.
- `runSidechatTurn` and every Sidechat-only branch added to the existing Maven runtime, prompt builder, role mapper, artifact lifecycle, and internal reply-draft tool.
- Sidechat broadcast events, ConversationDO replay/routing, private cursors, and status recovery.
- Sidechat React Query caches, optimistic-message reconciliation, run correlation, polling recovery, WebSocket reducers, and coordination state machines.
- Tests and fixtures whose only purpose is to validate the removed runtime.

No removed runtime symbol may remain behind a feature flag, unused export, compatibility wrapper, or commented block.

## 4. Presentation-only interim state

The retained UI may maintain only ephemeral view state required to demonstrate the shell, such as open/closed state and a local draft value. It must not create messages, synthesize statuses, imitate acceptance, or call any Sidechat endpoint.

Until the SDK runtime is implemented:

- The Sidechat entry remains visually available so layout work is preserved.
- Opening it may display the presentation shell, but message submission is disabled and clearly non-operational.
- There is no fallback to the deleted inline Compose endpoint.
- Add-to-reply remains a controlled component behavior that can be exercised by component tests; it is not populated by a fake agent response.
- No Sidechat data is written to D1, sent through the public widget path, or broadcast through `ConversationDO`.

This interim state is a development baseline and must not be deployed as a completed Sidechat feature.

## 5. Data and migration safety

Remote D1 has not received migrations `0063` or `0064`, so the migration history returns to `0062` by deleting the two unapplied SQL files and snapshots and removing only their journal records.

The cleanup must verify the local database state before claiming success. It must not run a production migration, deploy, push, or delete unrelated local D1 data.

The `0062` tool-audience schema remains authoritative. No provider credentials, tool contracts, public messages, customer records, or existing project configuration are modified.

## 6. Verification and rescan

The cleanup is complete only when all of the following hold:

1. Repository search finds no custom Sidechat lifecycle symbols, including Sidechat runs, leases, revisions, coordination snapshots, runtime routes, runtime broadcasts, or `runSidechatTurn`.
2. D1 schema, generated snapshots, and migration journal end at `0062` for this feature sequence.
3. The public visitor Maven, widget, Telegram handoff, public tools, and dashboard conversation tests pass.
4. Tool audience/access tests still prove public versus Sidechat capability filtering without requiring an active Sidechat runtime.
5. Sidechat presentation component tests pass without network, database, WebSocket, or run-state dependencies.
6. TypeScript, changed-file lint, migration consistency checks, and the production build pass.
7. A final manual diff review classifies every remaining `sidechat` reference as either presentation or dormant tool-policy configuration.
8. The review records any unrelated pre-existing failures separately and does not hide new cleanup regressions behind them.

## 7. Explicitly out of scope

- Adding `AIChatAgent`, `useAgentChat`, an Agent Durable Object binding, or Agent SDK migrations.
- Designing or implementing MCP connections, approvals, durable fibers, or private tool execution.
- Migrating the public visitor conversation to the Agents SDK.
- Deploying, pushing, or applying remote migrations.
- Reintroducing inline Compose.

The SDK architecture will be designed only after this cleanup is verified and the resulting repository has been rescanned.
