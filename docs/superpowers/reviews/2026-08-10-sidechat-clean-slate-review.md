# Sidechat Clean-Slate Review

**Date:** 2026-08-10  
**Reviewed range:** `6708b76a198971a78cc3fd8d330d11ffb66abc83..f924cec`  
**Result:** Clean baseline for a future, separately designed SDK implementation

## Outcome

The custom private Sidechat runtime has been removed. There is no Sidechat HTTP runtime, background turn runner, D1 message channel, run/lease/revision lifecycle, private realtime protocol, React Query cache, optimistic private transcript, or recovery state machine left in the application.

The retained Sidechat code is limited to:

1. a disconnected presentation shell with local open/close and draft state; and
2. the previously approved project tool-audience policy, whose `sidechat` audience is dormant because there is no private turn caller.

No Agents SDK architecture, Agent Durable Object, `AIChatAgent`, `useAgentChat`, SDK migration, MCP connection, approval runtime, deployment, push, or remote migration was introduced.

## Deleted runtime inventory

### Runtime and routes

- Deleted `run-sidechat-turn.ts` and its tests.
- Deleted Sidechat route handlers and route tests.
- Removed the three authenticated custom routes for history, message submission, and retry from `worker/index.ts`.
- Kept one isolated mounted-worker regression proving all three retired routes return `404`.
- Deleted the private support-prompt branch, private role mapping, reply-draft artifact lifecycle, and `present_reply_draft` tool.
- Narrowed `runMavenTurn` to a public-only context and required the existing public execution dependencies.
- Removed the non-public HTTP execution bypass; the remaining HTTP path always uses the public conversation ownership lease and rate-limit permit.

### Persistence and coordination

- Deleted migrations `0063_internal_sidechat_channel.sql` and `0064_sidechat_coordination_revision.sql`.
- Deleted snapshots `0063_snapshot.json` and `0064_snapshot.json` and removed their journal entries.
- Removed Sidechat status, run ID, lease expiry, updated time, and revision from `conversations`.
- Removed message channel, kind, metadata, and the private-channel index from `messages`.
- Deleted Sidechat CRUD, pagination, claim, retry, lease, settlement, expiry, atomic completion, status snapshot, and polling methods from `ChatService`.
- Restored public-only message reads, writes, billing counts, dashboard totals, retention behavior, and email lookup shapes.

### Realtime and client orchestration

- Removed all private WebSocket events, cursors, sanitizers, broadcasts, replay, and status recovery.
- Restored the shared public resume contract to `{ type: "resume", lastMessageId }`.
- Removed Sidechat React Query keys, HTTP requests, optimistic rows, reconciliation, retries, run correlation, polling recovery, and ephemeral stream stores.
- Removed persisted Sidechat fields from conversation and message client types.

### Stale architecture documents

Deleted the superseded private-Sidechat design, internal-channel plan, generic MCP read/write plans, unified-loop plan, and unified-loop task reports. Git history remains the archive. The clean-slate design and implementation plan remain authoritative.

## Retained presentation inventory

| File | Classification |
| --- | --- |
| `src/components/inbox/ChatThread.tsx` | Shared transcript presentation perspective only. |
| `src/components/inbox/Composer.tsx` | Public Start/Open Sidechat entry plus a disabled controlled private-composer presentation mode. |
| `src/components/inbox/Composer.test.tsx` | Presentation, accessibility, focus, and attachment-continuity contracts. |
| `src/components/inbox/FocusSidechatLayout.tsx` | Responsive presentation layout only. |
| `src/components/inbox/FocusView.tsx` | Controlled pane integration only. |
| `src/components/inbox/MessageBubble.tsx` | Shared bubble perspective/action rendering only. |
| `src/components/inbox/ReadingHeader.tsx` | Constrained-layout presentation behavior. |
| `src/components/inbox/ReadingPane.tsx` | Controlled open/close presentation wiring only. |
| `src/components/inbox/SidechatPane.tsx` | Disconnected shell; no fetch, mutation, WebSocket, cache, or generated messages. Submission is disabled and labeled unavailable. |
| `src/components/inbox/SidechatPane.test.tsx` | Presentation-only shell and disabled-state tests. |
| `src/components/inbox/SidechatStatusDot.tsx` | Isolated status-dot visual primitive; no live state source. |
| `src/lib/inbox/sidechat.ts` | Pure presentation helpers for perspective, layout, keyboard intent, and local state. |
| `src/lib/inbox/sidechat.test.ts` | Pure presentation helper tests. |
| `src/pages/Conversations.tsx` | Local pane-open and per-conversation draft state only; no Sidechat network or persistence code. |

The application supplies no private messages or synthetic runtime status to this shell. Opening it performs no Sidechat request. Add-to-reply remains a controlled component contract but is not populated by a fake agent response.

## Retained tool-policy inventory

| File | Classification |
| --- | --- |
| `worker/db/drizzle/0062_maven_tool_audiences.sql` | Persisted project tool audience/access policy. |
| `worker/db/schema.ts` | `tools.allowedChannels` and `tools.access`; no Sidechat conversation state. |
| `worker/validation.ts` | Validates `public | sidechat` tool audiences and `read | write` access. |
| `worker/services/tool-service.ts` and tests | Stores, parses, filters, and fingerprints the dormant audience policy. |
| `worker/routes/tool-handlers.test.ts` | Dashboard policy boundary tests. |
| `worker/chat-runtime/tools/tool-capability.ts` and tests | Channel authorization primitive; no private turn scheduler or persistence. |
| `worker/chat-runtime/tools/build-maven-tool-registry.test.ts` | Proves filtering/collision behavior for a future authorized caller; production `runMavenTurn` is public-only. |
| `worker/chat-runtime/tools/internal/search-knowledge.ts` and tests | Declares knowledge search usable by both policy audiences; only the public runtime currently calls it. |
| `worker/chat-runtime/tools/internal/request-team-help.test.ts` | Confirms the handoff tool remains public-only. |
| `src/pages/Tools.tsx` and tests | Project configuration UI for audience/access policy. |

These primitives do not execute a private turn by themselves. There is no Sidechat route, runner, scheduler, model prompt, provider stream, or private data source connected to them.

## Retired-route sentinel

`worker/routes/removed-sidechat-routes.integration.test.ts` and its isolated mounted-worker fixture are the only retained references to the old HTTP paths. They assert that history, message, and retry endpoints remain absent and return `404`; they do not implement compatibility handlers.

## Exact residue sweeps

The following lifecycle-symbol sweep returned no matches (ripgrep exit `1`, expected for an empty result):

```bash
rg -n \
  'runSidechatTurn|sidechatRunId|sidechatLeaseExpiresAt|sidechatRevision|SidechatCoordinationSnapshot|sidechat:(message|delta|activity|status)|present_reply_draft|/sidechat/(messages|retry)|sidechat_status|sidechat_run_id|sidechat_lease_expires_at|sidechat_revision|message_metadata|idx_messages_conversation_channel_created' \
  worker src shared docs .superpowers \
  --glob '!docs/superpowers/specs/2026-08-10-sidechat-runtime-clean-slate-design.md' \
  --glob '!docs/superpowers/plans/2026-08-10-sidechat-runtime-clean-slate.md' \
  --glob '!docs/superpowers/reviews/2026-08-10-sidechat-clean-slate-review.md' \
  --glob '!worker/routes/removed-sidechat-routes.mounted.fixture.test.ts'
```

The approved design, execution plan, this review record, and the mounted negative-route fixture are excluded because they intentionally name removed concepts. The broad case-insensitive sweep returned only the presentation files, dormant tool-policy files, and retired-route sentinel classified above. It returned no match in backend Sidechat persistence, routes, realtime delivery, private prompt/runtime, or client cache/orchestration code.

The inline Compose sweep also returned no matches:

```bash
rg -n 'compose-draft|composeAgentDraft|onCompose|composing' worker src
```

## D1 and migration result

- Repository migration SQL, snapshots, and journal end at `0062_maven_tool_audiences` for this feature sequence.
- `0063` and `0064` SQL/snapshot/journal entries are absent.
- A read-only inspection of the current local Miniflare D1 file found the latest applied migration is `0060_concerned_typhoid_mary.sql`.
- Local `conversations` has no Sidechat status/run/lease/revision columns.
- Local `messages` has no channel/kind/metadata columns.
- No local or remote migration command was run; no local D1 row or file was deleted.

## Verification

| Check | Result |
| --- | --- |
| Complete `bun test` with loopback permission | **468 pass, 1 intentional fixture skip, 0 fail; 1,418 assertions across 67 files** |
| Retired mounted routes | **1 pass, 0 fail** |
| Request-signal integration outside socket-restricted sandbox | **2 pass, 0 fail** |
| `./node_modules/.bin/tsc -b --pretty false` | **Pass** |
| ESLint over every existing changed `.ts`/`.tsx` file in the reviewed range | **Pass** |
| Direct Vite Worker SSR + client production build under Node 23.9 | **Pass** |
| `git diff --check` | **Pass** |
| Exact lifecycle-symbol sweep | **No matches** |
| Inline Compose sweep | **No matches** |

The production build retains the existing large-client-chunk advisory; it is unrelated to this cleanup.

## Full-source lint baseline

`eslint src worker shared widget` continues to report three pre-existing errors and eight warnings outside the changed cleanup surface:

- `worker/auth.ts`: existing explicit `any`;
- `worker/chat-runtime/llm/support-prompt-builders.ts`: existing control-character regex;
- `worker/chat-runtime/planner/query-deduplication.ts`: existing lexical declaration in a case block;
- eight existing React Fast Refresh warnings in shared UI files.

Running ESLint against `.` additionally enters an unrelated local `.worktrees/customer-identity-memory/dist` tree and reports generated-bundle/plugin noise. That output is not a source-quality signal for this branch; the source-scoped and changed-file results above are the relevant checks.

## Public-path review

- No file under `widget/` changed.
- `handle-widget-message-turn.ts`, Telegram handling, and the MCP server were not changed.
- The public widget remains on the existing Hono/SSE path.
- Public ownership compare-and-set, external-action lease, rate limiting, abort propagation, guarded persistence, audit linkage, handoff, and broadcast behavior remain covered by the full suite.
- The only bridge removed from `worker/index.ts` is the three private custom routes. Existing dashboard and widget routes remain mounted.
- Provider credentials, tool contracts, customer records, project settings, and existing project tool policies were not mutated.
- Unrelated untracked files were not staged or modified.

## Conclusion

The repository is clean of the custom Sidechat runtime. What remains is visibly and structurally separated: presentation-only UI, dormant tool-audience policy, and a negative route sentinel. This is a safe baseline for a new SDK architecture review; it is not an SDK implementation and must not be deployed as a completed Sidechat feature.
