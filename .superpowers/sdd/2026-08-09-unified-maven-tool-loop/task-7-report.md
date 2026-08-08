# Task 7 Report: Cut the public widget over to the unified Maven loop

## Implementation

- Replaced the public handler's fast-path / routing / planner / compose branch with one `runMavenTurn` invocation for every allowed AI turn. The call uses trusted public context (`projectId`, `conversationId`, `customerId`, exact starting ownership, `actorUserId: null`) and the existing model runtime, prompt context, channel-authorized tools, guidelines, and public-only handoff dependencies.
- Added `streamPublicMavenTurn`, which consumes the Maven `fullStream` through the Task 6 whitelist mapper. It emits only visitor-safe text and generic tool status, strips control tokens across split chunks before browser emission, and returns bounded sources/activity-derived state to the existing persistence shell.
- Preserved the deterministic task-scope gate and relocated the non-model hard ownership/invocation gates to `routing/public-turn-gates.ts` before deleting the old fast-path module.
- Preserved guarded output persistence by relocating `persistGuardedAiOutput` to `post-turn/persist-guarded-ai-output.ts` before deleting the planner executor. Protocol v1 still withholds final text until guarded persistence; protocol v2 invalidates provisional text with an empty authoritative completion if ownership is lost.
- Kept `request_team_help` side effects solely inside the Task 5 tool. The handler callback only updates local delivery status and publishes realtime status; it does not claim ownership, create summaries, or notify Telegram/email again.
- Made `[RESOLVED]` close only when the authoritative post-stream permission is allowed and status is still `active`. A concurrent human takeover or newly accepted team request cannot be closed by that token.
- Threaded the caller's request `AbortSignal` through both public handler call sites into `runMavenTurn`.
- Removed planner-only prompt sections/options/types and the stale planner-history instruction.

## TDD evidence

### RED

The parity suite was written before the handler cutover.

```sh
bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
```

Initial result against the old handler:

```text
SyntaxError: Export named 'streamPublicMavenTurn' not found
0 pass
1 fail
```

After adding actual-handler tests with an injected runtime but before adapting the production handler, six gate/one-call tests failed because the handler ignored the injected runtime and constructed the real billing/Stripe path. This proved the tests exercised the real `handleWidgetMessageTurn` entry point rather than only the stream helper.

During review, the handler race assertions were strengthened. The final suite directly exercises zero Maven calls for missing/archived, closed, human-owned, and scope-blocked turns; exactly one call for an allowed turn; request abort propagation; takeover versus `[RESOLVED]`; and `request_team_help` versus `[RESOLVED]`.

### GREEN

Required public runtime command:

```sh
bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/chat-runtime/tools worker/chat-runtime/post-turn worker/chat-runtime/contact-support worker/chat-runtime/streaming
```

Result:

```text
84 pass
0 fail
275 expect() calls
```

Full backend/shared command:

```sh
bun test worker shared
```

Result:

```text
282 pass
0 fail
888 expect() calls
Ran 282 tests across 46 files.
```

The full run includes Task 6 provider-fallback coverage: pre-commit primary failures use the fallback Maven stream, while visible text or a committed tool prevents replay and duplicate tool side effects.

## Preserved public shell and parity evidence

- Request validation and the already-saved visitor-message contract remain outside this handler and unchanged. The handler still performs subscription/message-limit gates, operational conversation reload, exact ownership snapshot, visitor persistence/broadcast, linked-customer touch, Telegram forwarding for existing agent mode, and deterministic task-scope classification.
- Hard gates run before Maven construction: missing/archived and closed conversations return operational errors; spam remains muted; ordinary human-owned turns remain AI-silent. Direct handler tests assert zero `runMavenTurn` calls for each category.
- Allowed public turns use one optional per-call runtime seam with production defaults. Tests inject services through that invocation only; no mutable module-global test state exists.
- Greeting, knowledge/source, HTTP lookup, ordinary missing-information question, saved-contact and contact-required handoff outcomes, deterministic contact opening, split `[RESOLVED]`, stream failure, and ownership-loss completion behavior are covered by public parity tests.
- Browser frames are produced by `mapAgentEventsToSse`; tests prove tool inputs/results, reasoning, provider metadata, and unknown payloads never cross the SSE boundary.
- Sources returned by the unified loop are persisted with the guarded bot insert and capped at three in the completion envelope, preserving the prior public contract.
- A stream exception rejects before any persistence or success completion. Protocol v2 may already have provisional text, but it never receives a successful persisted completion; ownership loss produces an explicit empty authoritative completion.

## Deleted and relocated code

Deleted:

- `worker/chat-runtime/executor/run-planner-loop.ts`
- `worker/chat-runtime/executor/run-planner-loop.test.ts`
- `worker/chat-runtime/planner/plan-next-action.ts`
- `worker/chat-runtime/planner/plan-next-action.test.ts`
- `worker/chat-runtime/orchestration/run-agentic-pipeline.ts`
- `worker/chat-runtime/orchestration/prepare-turn-routing.ts`
- `worker/chat-runtime/routing/identify-fast-path.ts`
- `worker/chat-runtime/routing/identify-fast-path.test.ts`

Relocated:

- `persistGuardedAiOutput` to `worker/chat-runtime/post-turn/persist-guarded-ai-output.ts`, with dedicated protocol v1/v2 tests.
- `identifyHardGate` and `parseVisitorAiInvocation` to `worker/chat-runtime/routing/public-turn-gates.ts`, with closed/human-owned/invocation tests.

The following production proof returns no matches (ripgrep exit 1 is the expected no-match result):

```sh
rg -n "runPlannerLoop|planNextAction|prepareTurnRouting|runAgenticTurn|identifyFastPath" worker src
```

## Static and production-build verification

All commands completed with exit code 0 and no diagnostics unless noted:

```sh
bun ./node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit
bun ./node_modules/typescript/bin/tsc -b
bun ./node_modules/eslint/bin/eslint.js worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts worker/chat-runtime/prompt/build-support-system-prompt.ts worker/chat-runtime/prompt/sections.ts worker/chat-runtime/types.ts worker/chat-runtime/post-turn/persist-guarded-ai-output.test.ts worker/chat-runtime/post-turn/persist-guarded-ai-output.ts worker/chat-runtime/routing/public-turn-gates.test.ts worker/chat-runtime/routing/public-turn-gates.ts worker/index.ts
git diff --check
WRANGLER_LOG_PATH=/tmp/replmaven-task7-wrangler.log bun ./node_modules/vite/bin/vite.js build
```

The direct Vite build completed both production bundles: 2,184 SSR/Worker modules and 3,271 client modules transformed. It emitted only the existing advisory for chunks larger than 500 kB.

## Scope expansion

- `worker/index.ts`: both existing `handleWidgetMessageTurn` call sites now pass `c.req.raw.signal`. This is required to preserve caller abort behavior through the unified loop.
- `worker/chat-runtime/types.ts`: `WidgetMessageTurnContext` gained the optional `abortSignal`; planner-only types/options/telemetry were removed.
- Prompt files/tests were changed only to delete planner-only sections, options, and instructions whose consumers were removed.
- New post-turn and routing files/tests contain narrowly relocated shared behavior required before deleting the obsolete planner files.

## Self-review

- **Human takeover races:** authoritative permission is reloaded after generation and before resolve/persist. `[RESOLVED]` requires current `active` status; guarded insert requires the exact latest ownership snapshot. Handler tests prove takeover produces no bot insert and an empty `agent_replied` completion. `ChatService.saveChatState` reloads, ownership-merges, and CASes status/raw chat state, so a later stale AI save cannot downgrade `assist_until_agent` or `human_only` ownership.
- **Duplicate handoff effects:** `request_team_help` remains the sole durable handoff path. The handler's callback only broadcasts status; no handler post-processing repeats ownership claims, summaries, Telegram, or email. A direct race test proves a successful handoff followed by `[RESOLVED]` stays `waiting_agent` and does not close.
- **Partial streams:** the stream must finish before persistence. Split tokens are buffered/stripped before visitor emission. Errors reject before insert and before any success completion.
- **Sources/completion:** normalized Maven sources flow only to guarded persistence and the capped final envelope. Tool payloads remain model-internal.
- **One-call behavior:** real handler tests prove one injected `runMavenTurn` call for an allowed public message and zero for hard/scope gates. Provider fallback remains internal to that single Maven-turn boundary and retains Task 6's no-replay-after-commit protection.
- **Abort:** both HTTP callers supply the request signal; the allowed handler test proves the identical signal reaches Maven dependencies.

## Concerns

- No open Task 7 code concern. Independent review's final ownership-save concern was retracted after tracing `mergeChatStateForPersistence` and the status/raw-state CAS in `ChatService.saveChatState`.
- The production build retains the repository's existing large-chunk advisory; this task does not affect client chunking.
- No deploy or push was performed.

## Fix Round 1

### Changed scope

- Added an exact public-conversation external-action lease immediately around each HTTP execution. The lease CASes project, non-archived status, exact status, and raw chat state from `MavenTurnContext`; a takeover or close that linearizes first prevents the fetch. Sidechat HTTP remains independent of public conversation ownership, and an unchanged explicit human-only `@BotName` snapshot remains leaseable.
- Made `request_team_help` contact collection resumable without another model branch. A `contact_required` result durably stores `awaitingContactFields`; the next visitor turn parses only explicit email, a conservative short name, or explicit refusal and applies the result with an exact ownership CAS before Maven. The obsolete generic handler `saveChatState` calls were removed so they cannot erase tool-written pending state.
- Reserved `search_knowledge` and `request_team_help` at validation, service, and runtime-registry boundaries. Legacy HTTP/MCP collisions are omitted while the internal tool remains available.
- Restored HTTP execution auditing for actual fetch attempts and collected each audit row's ID privately. Successful bot persistence waitUntil-links only those exact IDs, for that conversation, while still unlinked. Audit failure cannot alter or retry an already-completed external request.
- Added `MavenStreamFailure` so post-commit provider failures, including failures during initial stream priming after tool `onStart`, are sanitized, suppress fallback replay, produce no successful completion or bot persistence, and cannot be converted into the contact-support fallback success path.
- Moved the `toolmsg` permit into the HTTP executor after authorization/ownership and URL/header/body construction, immediately before `fetch`. Internal tools, text-only turns, scope blocks, blocked URLs, construction failures, and denied ownership consume no permit.

### TDD evidence

The initial Fix Round 1 public/service tests were added before implementation:

```sh
bun test worker/validation.test.ts worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/services/chat-service.test.ts worker/services/tool-service.test.ts worker/chat-runtime/tools/internal/request-team-help.test.ts worker/chat-runtime/routing/pending-contact-reply.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
```

Initial result:

```text
128 pass
21 fail
1 module-load error
```

This RED covered all six official findings: ownership races, two-turn pending contact/no-stale-save behavior, reserved collisions, audit row/exact-ID linking, committed provider errors, and actual-HTTP-only rate limiting. The true two-turn handler integration then failed five assertions before the handler stopped replaying stale chat state.

Independent-review regressions were also demonstrated RED before their fixes:

```sh
bun test worker/chat-runtime/routing/pending-contact-reply.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/chat-runtime/tools/build-maven-tool-registry.test.ts
```

```text
55 pass
5 fail
```

Those five failures were the three short support phrases being accepted as names, a lost contact CAS continuing into Maven after takeover, and a blocked URL consuming an HTTP permit. The initial-prime regression was separately demonstrated against the unsanitized catch:

```sh
bun test worker/chat-runtime/orchestration/run-maven-turn.test.ts -t "sanitizes an initial prime failure"
```

```text
0 pass
1 fail
Expected: The response stream failed.
Received: provider secret during initial priming
```

The handler contact-fallback interaction was demonstrated RED:

```sh
bun test worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts -t "committed stream failure cannot"
```

```text
0 pass
1 fail
Expected bot inserts: 0
Received bot inserts: 1
```

The final independent-review parser edge was also pinned RED:

```sh
bun test worker/chat-runtime/routing/pending-contact-reply.test.ts -t "before an email"
```

```text
0 pass
3 fail
```

Before the fix, `please continue alice@example.com`, `reset password alice@example.com`, and `need more help alice@example.com` all saved the support phrase as a name. Non-prefixed names must now satisfy the capitalization evidence even when an email is present; bare `Alice`, `Name: alice`, and `My name is Alice Smith` remain accepted.

Final focused GREEN command:

```sh
bun test worker/validation.test.ts worker/services/chat-service.test.ts worker/services/tool-service.test.ts worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/chat-runtime/tools/internal/request-team-help.test.ts worker/chat-runtime/routing/pending-contact-reply.test.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts
```

```text
189 pass
0 fail
599 expect() calls
Ran 189 tests across 9 files.
```

Fresh full backend/shared GREEN after the last review fix:

```sh
bun test worker shared
```

```text
330 pass
0 fail
997 expect() calls
Ran 330 tests across 47 files.
```

### Static and build evidence

All commands completed with exit code 0 and no diagnostics, except the planner proof whose exit 1 is the expected no-match result:

```sh
bun ./node_modules/typescript/bin/tsc -p tsconfig.worker.json --noEmit
bun ./node_modules/typescript/bin/tsc -b --pretty false
bun ./node_modules/eslint/bin/eslint.js worker/chat-runtime/orchestration/handle-widget-message-turn.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/orchestration/run-maven-turn.test.ts worker/chat-runtime/orchestration/run-maven-turn.ts worker/chat-runtime/routing/pending-contact-reply.test.ts worker/chat-runtime/routing/pending-contact-reply.ts worker/chat-runtime/streaming/map-agent-events-to-sse.ts worker/chat-runtime/streaming/maven-stream-failure.ts worker/chat-runtime/tools/build-maven-tool-registry.test.ts worker/chat-runtime/tools/build-maven-tool-registry.ts worker/chat-runtime/tools/http-tool-executor.ts worker/chat-runtime/tools/internal/request-team-help.test.ts worker/chat-runtime/tools/internal/request-team-help.ts worker/services/chat-service.test.ts worker/services/chat-service.ts worker/services/tool-service.test.ts worker/services/tool-service.ts worker/validation.test.ts worker/validation.ts
git diff --check
rg -n "runPlannerLoop|planNextAction|prepareTurnRouting|runAgenticTurn|identifyFastPath" worker src
WRANGLER_LOG_PATH=/tmp/replmaven-task7-fix1-final-wrangler.log bun ./node_modules/vite/bin/vite.js build
```

The direct production build transformed 2,186 Worker/SSR modules and 3,271 client modules. It emitted only the repository's existing advisory for chunks larger than 500 kB.

### Safety review

- **Ownership linearization:** the public HTTP lease is acquired after runtime reauthorization and immediately before request preparation/rate/fetch. Exact takeover and close races perform zero fetches and zero audit inserts when the ownership change wins. Sidechat does not construct or read public ownership dependencies.
- **Rate order:** URL blocking and header/body construction happen before the permit; the permit is the final callback before `fetch`. Ownership loss, blocked URL, malformed headers, denial, greetings, knowledge, handoff, and scope blocking all prove zero permit or zero fetch/audit as applicable.
- **Pending contact durability:** `request_team_help` owns the pending-state write. The handler performs a narrow exact-CAS contact update and has no generic end-of-turn chat-state save. A lost CAS reloads the authoritative row and applies the human/closed hard gate with zero Maven call or provisional text. Full/partial/refusal two-turn paths are covered.
- **Audit privacy and attribution:** execution IDs are collected in a private turn result field and are absent from tool results, model inputs, safe activity, and browser frames. Linking uses an ID `IN` predicate plus exact conversation and `message_id IS NULL`, so an interrupted or concurrent turn cannot claim another turn's rows. The linkage promise is tracked with `waitUntil`.
- **External effects:** only actual fetch attempts produce audit rows. Audit insertion failure is swallowed after the result and cannot cause replay. A committed tool sets the retry guard before execution; later provider failures use a sanitized typed failure and never persist partial output or emit success completion.
- **Handoff ownership:** `request_team_help` remains summary-only and is still the sole handoff side-effect owner. Contact collection does not add a planner, classifier, or auxiliary model call, and the handler does not duplicate handoff post-processing.
- **Reserved tools:** runtime omission protects legacy rows independently of route validation and preserves the internal definition rather than taking down the bot.

### Independent review and concerns

The independent re-review traced the final implementation clean after the combined-email parser fix. No open Fix Round 1 code concern remains. The contact parser is intentionally conservative: lowercase names without a `Name:`/`My name is` style prefix remain pending rather than being inferred. The existing Vite large-chunk advisory remains unrelated. No deploy or push was performed.
