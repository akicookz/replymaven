# Remove Legacy Chat Routing Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy planner-first chat runtime mode so the deterministic fast-path (short-circuit) routing shipped in `f7bdb81` is the only mode, removing the `CHAT_FAST_PATH_MODE` rollout flag entirely.

**Architecture:** The chat runtime currently has two modes selected by the `CHAT_FAST_PATH_MODE` env var: the legacy mode (`off`, plus `shadow` which logs the fast-path candidate but never acts on it) routes every turn through `prepareTurnRouting` and the full planner loop, while the current mode (`on`, live in production) short-circuits scope-blocked, small-talk, and authoritative-FAQ turns before any model call. This plan makes the short-circuit routing unconditional: `identifyFastPath` runs on every turn, the candidate/selected split collapses into one decision, and the flag, its parser, its env plumbing, and its telemetry fields are deleted. No behavior changes in production, which already runs `on`.

**Tech Stack:** Bun · Hono on Cloudflare Workers · TypeScript · `bun:test`

## Global Constraints

- Per CLAUDE.md: never commit or push unless the user explicitly asks, each time — so tasks end at "verify green", with no commit steps. Never co-author commits.
- Bun only (never npm/yarn): `bun test`, `bunx tsc -b`, `bun run lint`.
- `bun test` baseline (pre-existing, not caused by this change): 7 "(LLM integration)" failures needing API keys; `bun run lint` has ~16 pre-existing problems. Judge success against that baseline.
- `wrangler dev` binds production D1 (`remote: true`) — do not smoke-test mutating widget routes locally.
- Push to main auto-deploys the worker. This change needs no D1 migration and no `widget:deploy` (widget code is untouched).

## Out of Scope

- The SSE `streamProtocolVersion` 1/2 dual protocol (added in the same commit) stays — v1 is compatibility for cached old widget bundles and is a separate removal decision.
- The in-loop small-talk detection in `worker/chat-runtime/executor/run-planner-loop.ts:801-809` stays — it is NOT dead code under always-on fast path. The pre-flight fast path is suppressed when guidelines or agent-handback instructions exist (`hasPriorityInstructions`) and when legacy contact flows resume; the in-loop check still catches small talk there.
- `identifyHardGate`, `identifyFastPath`, and the `HardGateDecision` type all stay — they are the current mode.

---

### Task 1: Make fast-path routing unconditional in the turn handler

The handler currently computes `fastPathCandidate` (skipped when mode is `off`) and then gates `fastPathDecision` on mode `on`. Collapse both into a single unconditional `fastPathDecision`, and drop the now-meaningless `fastPathMode`/`fastPathCandidate` telemetry fields (candidate ≡ selected once shadow mode is gone).

**Files:**
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:39-43,351-388,425-431`
- Modify: `worker/chat-runtime/types.ts:519-520`

**Interfaces:**
- Consumes: `identifyFastPath` from `../routing/identify-fast-path` (unchanged signature).
- Produces: `TurnTelemetry` without `fastPathMode`/`fastPathCandidate` (keeps `fastPathSelected?: FastPathKind | null`). Task 2 relies on `parseFastPathMode` having zero remaining call sites after this task.

- [x] **Step 1: Drop `parseFastPathMode` from the handler import**

In `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` (lines 39–43), change:

```ts
import {
  identifyFastPath,
  identifyHardGate,
  parseFastPathMode,
} from "../routing/identify-fast-path";
```

to:

```ts
import {
  identifyFastPath,
  identifyHardGate,
} from "../routing/identify-fast-path";
```

- [x] **Step 2: Replace the mode-gated candidate/decision pair with one unconditional decision**

In the same file (lines 351–371), change:

```ts
  const fastPathMode = parseFastPathMode(context.env.CHAT_FAST_PATH_MODE);
  const conversationMetadata = parseConversationMetadata(conversation.metadata);
  const agentHandbackInstructions =
    typeof conversationMetadata.agentHandbackInstructions === "string"
      ? conversationMetadata.agentHandbackInstructions
      : null;
  const fastPathCandidate =
    fastPathMode === "off"
      ? null
      : identifyFastPath({
          message: context.payload.content,
          scopeDecision,
          faqMatch,
          hasPendingWorkflow:
            chatState.awaitingHandoffConfirmation ||
            chatState.awaitingContactFields.length > 0,
          hasImage: Boolean(context.payload.imageUrl),
          hasPriorityInstructions:
            enabledGuidelines.length > 0 || Boolean(agentHandbackInstructions),
        });
  const fastPathDecision = fastPathMode === "on" ? fastPathCandidate : null;
```

to:

```ts
  const conversationMetadata = parseConversationMetadata(conversation.metadata);
  const agentHandbackInstructions =
    typeof conversationMetadata.agentHandbackInstructions === "string"
      ? conversationMetadata.agentHandbackInstructions
      : null;
  const fastPathDecision = identifyFastPath({
    message: context.payload.content,
    scopeDecision,
    faqMatch,
    hasPendingWorkflow:
      chatState.awaitingHandoffConfirmation ||
      chatState.awaitingContactFields.length > 0,
    hasImage: Boolean(context.payload.imageUrl),
    hasPriorityInstructions:
      enabledGuidelines.length > 0 || Boolean(agentHandbackInstructions),
  });
```

- [x] **Step 3: Trim the `fast_path_evaluated` log to the surviving fields**

In the same file (lines 376–388), change:

```ts
  logInfo(
    "widget_turn.fast_path_evaluated",
    buildWidgetTurnLogContext(context, turnId, {
      mode: fastPathMode,
      candidate: fastPathCandidate?.kind ?? null,
      selected: fastPathDecision?.kind ?? null,
      reason: fastPathCandidate?.reason ?? null,
      faqScore: faqMatch?.score ?? null,
      faqPrecision: faqMatch?.precision ?? null,
      faqRecall: faqMatch?.recall ?? null,
      faqMargin: faqMatch?.margin ?? null,
    }),
  );
```

to:

```ts
  logInfo(
    "widget_turn.fast_path_evaluated",
    buildWidgetTurnLogContext(context, turnId, {
      selected: fastPathDecision?.kind ?? null,
      reason: fastPathDecision?.reason ?? null,
      faqScore: faqMatch?.score ?? null,
      faqPrecision: faqMatch?.precision ?? null,
      faqRecall: faqMatch?.recall ?? null,
      faqMargin: faqMatch?.margin ?? null,
    }),
  );
```

- [x] **Step 4: Trim the telemetry initializer**

In the same file (lines 425–431, inside `createWidgetSseResponse`), change:

```ts
    const telemetry: TurnTelemetry = {
      startedAt,
      routeStartedAt: startedAt,
      fastPathMode,
      fastPathCandidate: fastPathCandidate?.kind ?? null,
      fastPathSelected: fastPathDecision?.kind ?? null,
    };
```

to:

```ts
    const telemetry: TurnTelemetry = {
      startedAt,
      routeStartedAt: startedAt,
      fastPathSelected: fastPathDecision?.kind ?? null,
    };
```

- [x] **Step 5: Remove the dead `TurnTelemetry` fields**

In `worker/chat-runtime/types.ts` (lines 519–520), delete these two lines, keeping `fastPathSelected`:

```ts
  fastPathMode?: "off" | "shadow" | "on";
  fastPathCandidate?: FastPathKind | null;
```

- [x] **Step 6: Typecheck and run the chat-runtime tests**

Run: `bunx tsc -b`
Expected: exit 0, no new errors.

Run: `bun test worker/chat-runtime`
Expected: same pass/fail count as `main` — only the 7 pre-existing "(LLM integration)" environmental failures; no new failures.

---

### Task 2: Delete the mode parser and its tests

`parseFastPathMode` and the `FastPathMode` type now have zero call sites (Task 1 removed the only consumer).

**Files:**
- Modify: `worker/chat-runtime/routing/identify-fast-path.ts:15,18-22`
- Test: `worker/chat-runtime/routing/identify-fast-path.test.ts:1-6,134-143`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the guarantee that no call sites remain.
- Produces: `identify-fast-path.ts` exporting only `identifyFastPath`, `identifyHardGate`, and `HardGateDecision`.

- [x] **Step 1: Delete the parser test block**

In `worker/chat-runtime/routing/identify-fast-path.test.ts`, delete lines 134–143:

```ts
test.each([
  ["off", "off"],
  ["shadow", "shadow"],
  ["on", "on"],
  ["ON", "on"],
  [undefined, "shadow"],
  ["unexpected", "shadow"],
] as const)("parses fast-path mode %s", (input, expected) => {
  expect(parseFastPathMode(input)).toBe(expected);
});
```

and change the import (lines 1–6) from:

```ts
import { describe, expect, test } from "bun:test";
import {
  identifyFastPath,
  identifyHardGate,
  parseFastPathMode,
} from "./identify-fast-path";
```

to:

```ts
import { describe, expect, test } from "bun:test";
import {
  identifyFastPath,
  identifyHardGate,
} from "./identify-fast-path";
```

- [x] **Step 2: Delete the parser and its type**

In `worker/chat-runtime/routing/identify-fast-path.ts`, delete line 15 and lines 18–22 (keep `HardGateDecision` on line 16 — `identifyHardGate` still returns it):

```ts
export type FastPathMode = "off" | "shadow" | "on";
```

```ts
export function parseFastPathMode(value: string | undefined): FastPathMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "on") return normalized;
  return "shadow";
}
```

- [x] **Step 3: Run the routing tests and typecheck**

Run: `bun test worker/chat-runtime/routing/identify-fast-path.test.ts`
Expected: PASS — all remaining tests green (the six `parses fast-path mode` cases are gone).

Run: `bunx tsc -b`
Expected: exit 0.

---

### Task 3: Remove the `CHAT_FAST_PATH_MODE` env plumbing

Nothing reads the env var anymore; strip it from env typing and config.

**Files:**
- Modify: `worker/types.ts:43`
- Modify: `worker-configuration.d.ts:33`
- Modify: `wrangler.jsonc:95`
- Modify: `.dev.vars:18` (local file, not in git)

**Interfaces:**
- Consumes: Tasks 1–2 (zero references to `CHAT_FAST_PATH_MODE` in code).
- Produces: `Env`/`AppEnv` without the flag; deploys no longer carry the var.

- [x] **Step 1: Remove the flag from `AppEnv`**

In `worker/types.ts`, delete line 43:

```ts
  CHAT_FAST_PATH_MODE: string;
```

- [x] **Step 2: Remove the flag from the generated worker env types**

In `worker-configuration.d.ts`, delete line 33 (same one-line edit the flag arrived with; do not run `bun run cf-typegen`, which would rewrite unrelated parts of the file):

```ts
  CHAT_FAST_PATH_MODE: string;
```

- [x] **Step 3: Remove the var from wrangler config and local dev vars**

In `wrangler.jsonc`, delete line 95:

```jsonc
    "CHAT_FAST_PATH_MODE": "on",
```

In `.dev.vars`, delete line 18:

```
CHAT_FAST_PATH_MODE=on
```

- [x] **Step 4: Verify no references remain, then full verify**

Run: `grep -rn "CHAT_FAST_PATH_MODE\|parseFastPathMode\|FastPathMode\|fastPathMode\|fastPathCandidate" worker widget src wrangler.jsonc worker-configuration.d.ts .dev.vars`
Expected: no matches (mentions inside `docs/` are fine and excluded here).

Run: `bunx tsc -b`
Expected: exit 0.

Run: `bun test`
Expected: only the 7 pre-existing "(LLM integration)" environmental failures — identical to the `main` baseline.

Run: `bun run lint`
Expected: no new problems beyond the ~16 pre-existing ones.

---

## Deployment Notes

- Single ordinary deploy: push to main auto-deploys the worker. `wrangler deploy` replaces the vars set wholesale, so the removed var disappears with the same deploy that ships the code no longer reading it — no ordering hazard.
- No D1 migration, no `widget:deploy`, no secret changes.
- Observability: the `widget_turn.fast_path_evaluated` log loses its `mode` and `candidate` fields and `widget_turn.completed`-adjacent telemetry loses `fastPathMode`/`fastPathCandidate`. Any log queries filtering on those fields should switch to `selected`. Shadow-mode A/B observability is gone by design — that was the rollout mechanism, and the rollout is complete.
- Rollback: revert the commit; production behavior under the flag-present revision is identical (`on` was already live).
