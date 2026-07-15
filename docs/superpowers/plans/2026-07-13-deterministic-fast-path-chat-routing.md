# Deterministic Fast-Path Chat Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route agent-mode, muted, scope-blocked, pure small-talk, and authoritative FAQ turns before any auxiliary/planner work while preserving ReplyMaven's voice, evidence precedence, persistence, and one-message widget contract.

**Architecture:** Introduce a pure deterministic router that consumes explicit conversation state plus locally computed scope, small-talk, and FAQ signals. Split the widget handler into a minimal preflight wave and an AI-only preparation wave, run fast paths before `prepareTurnRouting`, and keep ambiguous messages on the existing planner path. Roll out behavior behind `CHAT_FAST_PATH_MODE=shadow|on|off`; shadow mode records the decision without changing the response.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1/Drizzle, Cloudflare KV, AI SDK v6, SSE, standalone TypeScript widget, Bun test runner.

---

## Scope

This plan implements the deterministic-routing slice of the chat-loop audit end to end. It includes the correctness bugs that directly affect those routes: unconditional agent-mode silence, page-context scope leakage, unsafe FAQ matching, retrieved FAQ evidence preservation, and duplicate resolution messages.

The following independent changes require separate Superpowers plans after this one is stable:

- Replacing the multi-step planner loop with a one-planner/one-composer executor.
- Persisted rolling summaries for history older than the canonical recent window.
- Per-conversation request serialization through `CONVERSATION_DO`.
- General prompt compaction beyond the evidence changes needed here.

## Runtime invariants

1. `waiting_agent` and `agent_replied` always bypass AI, regardless of the last team-message role.
2. Spam-muted conversations persist and broadcast the visitor message, then stop.
3. Fast-path selection performs no network, D1, KV, retrieval, or model calls.
4. A fast path is chosen only when the entire visitor message satisfies a narrow rule.
5. Ambiguity returns `null` and preserves the planner path.
6. Automatic `currentPageUrl` and `pageTitle` never make unrelated text in-scope.
7. Authoritative FAQ matching requires bidirectional coverage and a winner margin; containment alone is insufficient.
8. The server emits one terminal SSE event and the widget never invents a bot message.
9. Fast-path activation is reversible by changing one environment variable.

## Target model-call budget

| Route | Auxiliary | Planner | Retrieval | Composer/renderer |
|---|---:|---:|---:|---:|
| `agent_mode` / `muted` | 0 | 0 | 0 | 0 |
| `scope_blocked` | 0 | 0 | 0 | 0 |
| `small_talk` | 0 | 0 | 0 | 1 |
| `authoritative_faq` | 0 | 0 | 0 | 1 |
| `planner` | unchanged by this plan | existing | existing | existing |

## File map

| File | Responsibility |
|---|---|
| `worker/chat-runtime/routing/identify-fast-path.ts` | **New.** Pure route decision from local signals. |
| `worker/chat-runtime/routing/identify-fast-path.test.ts` | **New.** Positive, negative, and precedence tests. |
| `worker/chat-runtime/llm/create-language-model.ts` | Count primary and fallback model attempts by stage. |
| `worker/chat-runtime/llm/create-language-model.test.ts` | Model-attempt telemetry tests. |
| `worker/chat-runtime/prompt/build-compiled-faq-context.ts` | Bidirectional FAQ ranker and authoritative-match metadata. |
| `worker/chat-runtime/prompt/build-compiled-faq-context.test.ts` | FAQ containment, ambiguity, exact-match, and margin regressions. |
| `worker/chat-runtime/workflows/classify-task-scope.ts` | Stop treating page-context presence as a support signal. |
| `worker/chat-runtime/workflows/classify-task-scope.test.ts` | **New.** Scope/page-context regressions. |
| `worker/chat-runtime/orchestration/prepare-turn-routing.ts` | Accept precomputed FAQ data; avoid duplicate ranking. |
| `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` | Two-wave preflight, hard gates, shadow/active routing, route telemetry. |
| `worker/chat-runtime/orchestration/normalize-history.ts` | Keep canonical recent history model-visible and free of system rows. |
| `worker/chat-runtime/orchestration/normalize-history.test.ts` | History-role regression test. |
| `worker/chat-runtime/executor/run-planner-loop.ts` | Execute an injected fast-path decision before contact extraction/planning. |
| `worker/chat-runtime/executor/run-planner-loop.test.ts` | **New.** Pure executor-boundary and evidence-merge tests. |
| `worker/chat-runtime/orchestration/run-agentic-pipeline.ts` | Carry the fast-path decision into the executor. |
| `worker/chat-runtime/types.ts` | Shared fast-path and telemetry types plus environment setting. |
| `worker/types.ts` | Worker environment typing for rollout mode. |
| `worker/chat-runtime/streaming/map-agent-events-to-sse.ts` | Typed single completion event helper. |
| `worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts` | Completion event serialization tests. |
| `worker/validation.ts` | Optional stream protocol version for backwards-compatible rollout. |
| `worker/index.ts` | Carry stream protocol version from validated body into the runtime. |
| `widget/index.ts` | Consume the single completion event and remove synthetic resolution copy. |
| `wrangler.jsonc` | Default `CHAT_FAST_PATH_MODE` to `shadow`. |
| `worker-configuration.d.ts` | Regenerated Cloudflare environment types. |

## Global constraints

- Use Bun only.
- Use function declarations for named functions; arrows remain limited to inline callbacks.
- No Node-only APIs.
- Do not deploy, commit, or push without the user's explicit approval.
- Use `apply_patch` for source edits.
- Run tests without provider keys so unit tests cannot make live Gemini/OpenAI requests.
- `wrangler dev` is not a verification step because this repository can bind remote production resources.

---

### Task 1: Replace containment-biased FAQ matching

**Files:**
- Modify: `worker/chat-runtime/prompt/build-compiled-faq-context.ts:144-205`
- Modify: `worker/chat-runtime/prompt/build-compiled-faq-context.test.ts:86-131`

- [ ] **Step 1: Replace the false-positive expectation with failing safety tests**

Replace the current test that expects the long permissions question to score `1` and add ambiguity coverage:

```typescript
test("does not treat a short contained FAQ as authoritative", () => {
  const match = findBestFaqMatch(
    resources,
    "Can I invite a team member, restrict them to one domain, and what will it cost?",
  );

  expect(match).not.toBeNull();
  expect(match?.authoritative).toBe(false);
  expect(match?.precision).toBeLessThan(0.8);
});

test("marks an exact normalized FAQ question authoritative", () => {
  const match = findBestFaqMatch(
    resources,
    "  HOW CAN I INVITE A TEAM MEMBER?! ",
  );

  expect(match).toMatchObject({
    question: "How can I invite a team member?",
    authoritative: true,
    matchKind: "exact",
    score: 1,
  });
});

test("rejects an otherwise strong match when the runner-up is too close", () => {
  const ambiguousResources = [
    {
      title: "Team FAQ",
      content: JSON.stringify([
        { question: "How do I invite a team member?", answer: "Open Team." },
        { question: "How do I remove a team member?", answer: "Open Team." },
      ]),
    },
  ];

  const match = findBestFaqMatch(ambiguousResources, "How do I manage a team member?");
  expect(match?.authoritative).toBe(false);
  expect(match?.margin).toBeLessThan(0.15);
});

test("does not fast-path multi-intent wording", () => {
  const match = findBestFaqMatch(
    resources,
    "How can I invite a team member and cancel my subscription?",
  );

  expect(match?.authoritative).toBe(false);
});

test("does not fast-path duplicate questions with conflicting answers", () => {
  const conflictingResources = [
    {
      title: "Old FAQ",
      content: JSON.stringify([
        { question: "How long is the trial?", answer: "The trial is 7 days." },
      ]),
    },
    {
      title: "New FAQ",
      content: JSON.stringify([
        { question: "How long is the trial?", answer: "The trial is 14 days." },
      ]),
    },
  ];

  const match = findBestFaqMatch(conflictingResources, "How long is the trial?");
  expect(match?.authoritative).toBe(false);
});
```

- [ ] **Step 2: Run the FAQ tests and verify red state**

Run:

```bash
bun test worker/chat-runtime/prompt/build-compiled-faq-context.test.ts
```

Expected: FAIL because `FaqMatchResult` does not expose `authoritative`, `precision`, `margin`, or `matchKind`, and the containment regression still receives the old score.

- [ ] **Step 3: Implement bidirectional scoring and an explicit authoritative decision**

Replace `FaqMatchResult`, `tokenize`, `overlapSimilarity`, and `findBestFaqMatch` with the following shape and algorithm. Keep `parseFaqPairs` and the compiled-context cache unchanged.

```typescript
export interface FaqMatchResult {
  question: string;
  answer: string;
  score: number;
  precision: number;
  recall: number;
  margin: number;
  authoritative: boolean;
  matchKind: "exact" | "lexical";
}

type ScoredFaqPair = Omit<FaqMatchResult, "margin" | "authoritative">;

const FAQ_HINT_THRESHOLD = 0.35;
const FAQ_AUTHORITATIVE_F1 = 0.82;
const FAQ_AUTHORITATIVE_COVERAGE = 0.8;
const FAQ_AUTHORITATIVE_MARGIN = 0.15;
const MULTI_INTENT_RE = /\b(and|also|plus|another|as well as|but)\b|[?][^?]+[?]/i;

function normalizeFaqText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeFaqText(text)
      .split(" ")
      .filter((token) => token.length > 1 && !FAQ_STOPWORDS.has(token)),
  );
}

function scoreFaqPair(userMessage: string, question: string): ScoredFaqPair | null {
  const normalizedUser = normalizeFaqText(userMessage);
  const normalizedQuestion = normalizeFaqText(question);
  if (normalizedUser === normalizedQuestion) {
    return {
      question,
      answer: "",
      score: 1,
      precision: 1,
      recall: 1,
      matchKind: "exact",
    };
  }

  const userTokens = tokenize(userMessage);
  const questionTokens = tokenize(question);
  if (userTokens.size < 2 || questionTokens.size < 2) return null;

  let overlap = 0;
  for (const token of userTokens) {
    if (questionTokens.has(token)) overlap += 1;
  }
  const precision = overlap / userTokens.size;
  const recall = overlap / questionTokens.size;
  const score =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    question,
    answer: "",
    score,
    precision,
    recall,
    matchKind: "lexical",
  };
}

export function findBestFaqMatch(
  faqResources: FaqLikeResource[],
  userMessage: string,
): FaqMatchResult | null {
  const candidates: ScoredFaqPair[] = [];
  for (const resource of faqResources) {
    for (const pair of parseFaqPairs(resource.content)) {
      const scored = scoreFaqPair(userMessage, pair.question);
      if (scored && scored.score >= FAQ_HINT_THRESHOLD) {
        candidates.push({ ...scored, answer: pair.answer });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return null;
  const runnerUp = candidates[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  const hasConflictingExactAnswer =
    best.matchKind === "exact" &&
    candidates.slice(1).some((candidate) =>
      candidate.matchKind === "exact" &&
      normalizeFaqText(candidate.answer) !== normalizeFaqText(best.answer),
    );
  const authoritative =
    (best.matchKind === "exact" && !hasConflictingExactAnswer) ||
    (!MULTI_INTENT_RE.test(userMessage) &&
      best.score >= FAQ_AUTHORITATIVE_F1 &&
      best.precision >= FAQ_AUTHORITATIVE_COVERAGE &&
      best.recall >= FAQ_AUTHORITATIVE_COVERAGE &&
      margin >= FAQ_AUTHORITATIVE_MARGIN);

  return { ...best, margin, authoritative };
}
```

If the existing stopword set removes a product-significant word exposed by the new tests, remove only that word and add a regression for it. Do not add stemming, embeddings, or a model call in this task.

- [ ] **Step 4: Run FAQ tests and verify green state**

Run:

```bash
bun test worker/chat-runtime/prompt/build-compiled-faq-context.test.ts
```

Expected: PASS. The previous paraphrase remains a non-authoritative hint if it clears `FAQ_HINT_THRESHOLD`; exact normalized text is authoritative.

- [ ] **Step 5: Checkpoint**

If the user has explicitly approved commits:

```bash
git add worker/chat-runtime/prompt/build-compiled-faq-context.ts worker/chat-runtime/prompt/build-compiled-faq-context.test.ts
git commit -m "fix(chat): require bidirectional coverage for FAQ fast paths"
```

Otherwise leave the passing change uncommitted.

---

### Task 2: Add the pure deterministic route decision

**Files:**
- Create: `worker/chat-runtime/routing/identify-fast-path.ts`
- Create: `worker/chat-runtime/routing/identify-fast-path.test.ts`
- Modify: `worker/chat-runtime/types.ts:1-30`

- [ ] **Step 1: Add the shared route types**

Add to `worker/chat-runtime/types.ts` after `SupportIntent`:

```typescript
export type FastPathKind =
  | "scope_blocked"
  | "small_talk"
  | "authoritative_faq";

export type FastPathDecision =
  | {
      kind: "scope_blocked";
      reason: string;
      response: string;
    }
  | {
      kind: "small_talk";
      reason: "pure_greeting" | "pure_resolution";
      composeKind: "greeting" | "resolution";
    }
  | {
      kind: "authoritative_faq";
      reason: "exact_faq" | "high_coverage_faq";
      faq: {
        question: string;
        answer: string;
        score: number;
      };
    };
```

- [ ] **Step 2: Write the failing router tests**

Create `worker/chat-runtime/routing/identify-fast-path.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { identifyFastPath } from "./identify-fast-path";

describe("identifyFastPath", () => {
  test("returns a greeting only for the whole message", () => {
    expect(identifyFastPath({ message: "hello!", scopeDecision: null, faqMatch: null }))
      .toMatchObject({ kind: "small_talk", composeKind: "greeting" });
    expect(identifyFastPath({
      message: "hello, how much is Pro?",
      scopeDecision: null,
      faqMatch: null,
    })).toBeNull();
  });

  test("does not close a turn with unresolved language", () => {
    expect(identifyFastPath({
      message: "thanks, but I still cannot log in",
      scopeDecision: null,
      faqMatch: null,
    })).toBeNull();
  });

  test("does not fast-path while a persisted workflow is pending", () => {
    expect(identifyFastPath({
      message: "thanks",
      scopeDecision: null,
      faqMatch: null,
      hasPendingWorkflow: true,
    })).toBeNull();
  });

  test("does not fast-path image turns", () => {
    expect(identifyFastPath({
      message: "hello",
      scopeDecision: null,
      faqMatch: null,
      hasImage: true,
    })).toBeNull();
  });

  test("scope block takes precedence over FAQ evidence", () => {
    expect(identifyFastPath({
      message: "tell me a joke",
      scopeDecision: {
        kind: "out_of_scope_general",
        reason: "general_creative_request",
        response: "Support questions only.",
      },
      faqMatch: {
        question: "Tell me a joke",
        answer: "No.",
        score: 1,
        precision: 1,
        recall: 1,
        margin: 1,
        authoritative: true,
        matchKind: "exact",
      },
    })).toEqual({
      kind: "scope_blocked",
      reason: "general_creative_request",
      response: "Support questions only.",
    });
  });

  test("returns only authoritative FAQ matches", () => {
    const baseMatch = {
      question: "How do I invite a team member?",
      answer: "Open Dashboard > Team.",
      score: 0.9,
      precision: 0.9,
      recall: 0.9,
      margin: 0.2,
      matchKind: "lexical" as const,
    };

    expect(identifyFastPath({
      message: "How do I invite a team member?",
      scopeDecision: null,
      faqMatch: { ...baseMatch, authoritative: true },
    })).toMatchObject({ kind: "authoritative_faq" });

    expect(identifyFastPath({
      message: "Invite someone and restrict their domain",
      scopeDecision: null,
      faqMatch: { ...baseMatch, authoritative: false },
    })).toBeNull();
  });

  test("keeps FAQ turns on the planner path when priority instructions exist", () => {
    expect(identifyFastPath({
      message: "How do I invite a team member?",
      scopeDecision: null,
      faqMatch: {
        question: "How do I invite a team member?",
        answer: "Open Dashboard > Team.",
        score: 1,
        precision: 1,
        recall: 1,
        margin: 1,
        authoritative: true,
        matchKind: "exact",
      },
      hasPriorityInstructions: true,
    })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the router test and verify red state**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts
```

Expected: FAIL because `identify-fast-path.ts` does not exist.

- [ ] **Step 4: Implement the pure router**

Create `worker/chat-runtime/routing/identify-fast-path.ts`:

```typescript
import { detectSmallTalk } from "../planner/small-talk";
import { type FaqMatchResult } from "../prompt/build-compiled-faq-context";
import {
  type FastPathDecision,
} from "../types";
import {
  type TaskScopeDecision,
} from "../workflows/classify-task-scope";

interface IdentifyFastPathInput {
  message: string;
  scopeDecision: TaskScopeDecision | null;
  faqMatch: FaqMatchResult | null;
  hasPendingWorkflow?: boolean;
  hasImage?: boolean;
  hasPriorityInstructions?: boolean;
}

export function identifyFastPath(
  input: IdentifyFastPathInput,
): FastPathDecision | null {
  if (
    input.scopeDecision &&
    input.scopeDecision.kind !== "in_scope_support"
  ) {
    return {
      kind: "scope_blocked",
      reason: input.scopeDecision.reason,
      response:
        input.scopeDecision.response ??
        "I can only help with this product, website, and support-related questions here.",
    };
  }

  if (input.hasPendingWorkflow || input.hasImage) return null;

  const smallTalkKind = detectSmallTalk(input.message);
  if (smallTalkKind) {
    return {
      kind: "small_talk",
      reason:
        smallTalkKind === "greeting" ? "pure_greeting" : "pure_resolution",
      composeKind: smallTalkKind,
    };
  }

  if (
    !input.faqMatch?.authoritative ||
    input.hasPriorityInstructions
  ) return null;
  return {
    kind: "authoritative_faq",
    reason:
      input.faqMatch.matchKind === "exact"
        ? "exact_faq"
        : "high_coverage_faq",
    faq: {
      question: input.faqMatch.question,
      answer: input.faqMatch.answer,
      score: input.faqMatch.score,
    },
  };
}
```

- [ ] **Step 5: Run the router tests**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts worker/chat-runtime/planner/small-talk.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/types.ts worker/chat-runtime/routing/identify-fast-path.ts worker/chat-runtime/routing/identify-fast-path.test.ts
git commit -m "feat(chat): add pure deterministic fast-path router"
```

---

### Task 3: Remove page-context scope leakage

**Files:**
- Modify: `worker/chat-runtime/workflows/classify-task-scope.ts:67-102`
- Create: `worker/chat-runtime/workflows/classify-task-scope.test.ts`

- [ ] **Step 1: Write the page-context regression tests**

Create `worker/chat-runtime/workflows/classify-task-scope.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { classifyTaskScope } from "./classify-task-scope";

describe("classifyTaskScope", () => {
  test("automatic page context does not make a joke request in scope", () => {
    const withoutContext = classifyTaskScope({ message: "tell me a joke" });
    const withContext = classifyTaskScope({
      message: "tell me a joke",
      pageContext: {
        currentPageUrl: "https://replymaven.com/pricing",
        pageTitle: "Pricing",
      },
    });

    expect(withContext).toEqual(withoutContext);
    expect(withContext.kind).toBe("out_of_scope_general");
  });

  test("support wording remains in scope with or without page context", () => {
    expect(classifyTaskScope({ message: "How do I configure the widget?" }).kind)
      .toBe("in_scope_support");
    expect(classifyTaskScope({
      message: "How do I configure the widget?",
      pageContext: { plan: "Pro" },
    }).kind).toBe("in_scope_support");
  });
});
```

- [ ] **Step 2: Run the test and verify red state**

Run:

```bash
bun test worker/chat-runtime/workflows/classify-task-scope.test.ts
```

Expected: FAIL because `pageContextSignals` currently changes the joke request to `in_scope_support`.

- [ ] **Step 3: Make the visitor message the only scope signal**

In `classifyTaskScope`, replace:

```typescript
const pageContextSignals = Object.keys(options.pageContext ?? {}).length > 0;
const supportSignals = hasSupportSignals(message) || pageContextSignals;
```

with:

```typescript
const supportSignals = hasSupportSignals(message);
```

Keep the `pageContext` parameter for API compatibility; it can still inform composition after a message is admitted.

- [ ] **Step 4: Run scope and router tests**

Run:

```bash
bun test worker/chat-runtime/workflows/classify-task-scope.test.ts worker/chat-runtime/routing/identify-fast-path.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/workflows/classify-task-scope.ts worker/chat-runtime/workflows/classify-task-scope.test.ts
git commit -m "fix(chat): keep page metadata out of scope classification"
```

---

### Task 4: Add shadow/on/off routing configuration and telemetry

**Files:**
- Modify: `wrangler.jsonc:90-103`
- Modify: `worker/types.ts:32-61`
- Modify: `worker/chat-runtime/types.ts:475-489`
- Modify: `worker/chat-runtime/llm/create-language-model.ts`
- Modify: `worker/chat-runtime/llm/create-language-model.test.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:129-169`
- Modify: `worker/index.ts:862-914`
- Regenerate: `worker-configuration.d.ts`

- [ ] **Step 1: Add a typed mode parser test**

Expand the existing import in `identify-fast-path.test.ts`:

```typescript
import {
  identifyFastPath,
  parseFastPathMode,
} from "./identify-fast-path";
```

Then append:

```typescript
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

- [ ] **Step 2: Run the test and verify red state**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts
```

Expected: FAIL because `parseFastPathMode` is not exported.

- [ ] **Step 3: Add the mode parser**

Add to `identify-fast-path.ts`:

```typescript
export type FastPathMode = "off" | "shadow" | "on";

export function parseFastPathMode(value: string | undefined): FastPathMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "on") return normalized;
  return "shadow";
}
```

- [ ] **Step 4: Add environment and telemetry fields**

Add to `wrangler.jsonc` under `vars`:

```json
"CHAT_FAST_PATH_MODE": "shadow",
```

Add to `AppEnv` in `worker/types.ts`:

```typescript
CHAT_FAST_PATH_MODE: string;
```

Extend `TurnTelemetry` in `worker/chat-runtime/types.ts`:

```typescript
routeStartedAt: number;
fastPathMode?: "off" | "shadow" | "on";
fastPathCandidate?: FastPathKind | null;
fastPathSelected?: FastPathKind | null;
modelCallCount?: number;
modelCallsByStage?: Record<string, number>;
```

Add `routeStartedAt: number` to `WidgetMessageTurnContext`. At the first line of the widget-message route in `worker/index.ts`, capture:

```typescript
const routeStartedAt = Date.now();
```

Pass `routeStartedAt` into `handleWidgetMessageTurn`. In the handler, replace `const startedAt = Date.now()` with `const startedAt = context.routeStartedAt`, and initialize telemetry outside timing ambiguity:

```typescript
const telemetry: TurnTelemetry = {
  startedAt,
  routeStartedAt: startedAt,
};
```

Preserve `startedAt` temporarily for compatibility with existing latency logs.

- [ ] **Step 5: Count every primary and fallback model attempt**

Expand the existing import at the top of `create-language-model.test.ts`:

```typescript
import {
  createModelRuntimeState,
  isProviderLikeError,
  runWithModelFallback,
} from "./create-language-model";
```

Then append:

```typescript
test("counts a successful primary attempt by stage", async () => {
  const runtime = createModelRuntimeState({
    model: "gpt-5-chat-latest",
    openaiApiKey: "openai-test",
    geminiApiKey: null,
  });

  await runWithModelFallback({
    runtime,
    stage: "compose",
    operation: async () => "ok",
  });

  expect(runtime.modelCallCount).toBe(1);
  expect(runtime.modelCallsByStage).toEqual({ compose: 1 });
});

test("counts both attempts when provider fallback runs", async () => {
  const runtime = createModelRuntimeState({
    model: "gpt-5-chat-latest",
    openaiApiKey: "openai-test",
    geminiApiKey: "gemini-test",
  });
  let attempts = 0;

  await runWithModelFallback({
    runtime,
    stage: "plan_next_action",
    operation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("503 Service Unavailable");
      return "ok";
    },
  });

  expect(runtime.modelCallCount).toBe(2);
  expect(runtime.modelCallsByStage).toEqual({ plan_next_action: 2 });
});
```

Run:

```bash
bun test worker/chat-runtime/llm/create-language-model.test.ts
```

Expected: FAIL because `ModelRuntimeState` has no counters.

Add to `ModelRuntimeState` and `createModelRuntimeState`:

```typescript
modelCallCount: number;
modelCallsByStage: Record<string, number>;
```

```typescript
modelCallCount: 0,
modelCallsByStage: {},
```

Add this helper and call it immediately before each `options.operation(...)` invocation, including the fallback invocation:

```typescript
function recordModelAttempt(runtime: ModelRuntimeState, stage: string): void {
  runtime.modelCallCount += 1;
  runtime.modelCallsByStage[stage] =
    (runtime.modelCallsByStage[stage] ?? 0) + 1;
}
```

At handler completion, log `modelRuntime.modelCallCount` and `modelRuntime.modelCallsByStage`. Hard-gate and scope-blocked branches log zero without creating a runtime.

- [ ] **Step 6: Regenerate Cloudflare types**

Run:

```bash
bun run cf-typegen
```

Expected: `worker-configuration.d.ts` contains `CHAT_FAST_PATH_MODE: "shadow"` or an equivalent generated string binding.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts
bun test worker/chat-runtime/llm/create-language-model.test.ts
bun run build
```

Expected: PASS with no new TypeScript errors.

- [ ] **Step 8: Checkpoint**

If commits are approved:

```bash
git add wrangler.jsonc worker/types.ts worker-configuration.d.ts worker/chat-runtime/types.ts worker/chat-runtime/routing/identify-fast-path.ts worker/chat-runtime/routing/identify-fast-path.test.ts worker/chat-runtime/llm/create-language-model.ts worker/chat-runtime/llm/create-language-model.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/index.ts
git commit -m "feat(chat): add shadow-mode control for deterministic routing"
```

---

### Task 5: Enforce hard agent-mode silence before AI preparation

**Files:**
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:100-115, 172-201, 261-291, 343-388`
- Modify: `worker/chat-runtime/orchestration/normalize-history.ts`
- Modify: `worker/chat-runtime/orchestration/normalize-history.test.ts`
- Test: `worker/chat-runtime/routing/identify-fast-path.test.ts`

- [ ] **Step 1: Add a pure hard-gate helper and failing status tests**

Expand the existing router-test import:

```typescript
import {
  identifyFastPath,
  identifyHardGate,
  parseFastPathMode,
} from "./identify-fast-path";
```

Then add:

```typescript
test.each(["waiting_agent", "agent_replied"])(
  "always identifies %s as agent mode",
  (status) => {
    expect(identifyHardGate({ status, closeReason: null })).toBe("agent_mode");
  },
);

test("identifies spam as muted before agent mode", () => {
  expect(identifyHardGate({ status: "closed", closeReason: "spam" }))
    .toBe("muted");
});
```

- [ ] **Step 2: Run the test and verify red state**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts
```

Expected: FAIL because `identifyHardGate` does not exist.

- [ ] **Step 3: Implement the hard-gate helper**

Add to `identify-fast-path.ts`:

```typescript
export type HardGateDecision = "muted" | "agent_mode" | null;

export function identifyHardGate(input: {
  status: string;
  closeReason: string | null;
}): HardGateDecision {
  if (input.closeReason === "spam") return "muted";
  if (input.status === "waiting_agent" || input.status === "agent_replied") {
    return "agent_mode";
  }
  return null;
}
```

- [ ] **Step 4: Split handler prefetch into minimal and AI-only waves**

In `handleWidgetMessageTurn`, the first `Promise.all` must contain only data required to admit and persist the turn:

```typescript
const [ownerSub, conversationLookup, settings] = await Promise.all([
  billingService.getSubscriptionByUserId(context.project.userId),
  chatService.getConversationById(context.conversationId, context.project.id),
  projectService.getSettings(context.project.id),
]);
```

Delete `enabledTools`, `enabledGuidelines`, `allResources`, and `parallelPrefetchedHistory` from this wave. Declare and load those only after the spam/agent-mode returns:

```typescript
const [enabledTools, enabledGuidelines, allResources, recentHistory] =
  await Promise.all([
    toolService.getEnabledTools(context.project.id),
    guidelineService.getEnabledByProject(context.project.id),
    resourceService.getResourcesByProject(context.project.id),
    chatService.getRecentMessages(context.conversationId, 11),
  ]);
const parallelPrefetchedHistory = recentHistory.messages;
```

Do not use `context.payload.history` to skip D1. The server history is canonical.

Add this normalization regression to `normalize-history.test.ts`:

```typescript
test("drops system messages from model history", () => {
  const result = normalizeConversationHistory({
    rawHistory: [
      { role: "system", content: "internal note" },
      { role: "visitor", content: "hello" },
    ],
    currentMessage: "next question",
  });

  expect(result).toEqual([{ role: "visitor", content: "hello" }]);
});
```

Update the first normalization filter to admit only model-visible roles:

```typescript
.filter((message) =>
  message.role === "visitor" ||
  message.role === "agent" ||
  (message.role === "bot" && Boolean(message.content)),
)
```

- [ ] **Step 5: Replace role-dependent agent silence with the hard gate**

After saving and broadcasting `visitorMessage`, compute:

```typescript
const hardGate = identifyHardGate({
  status: conversation.status,
  closeReason: conversation.closeReason,
});
```

Keep the existing muted return for `hardGate === "muted"`. For `agent_mode`, forward when Telegram is configured and always return JSON:

```typescript
if (hardGate === "agent_mode") {
  if (settings?.telegramBotToken && settings.telegramChatId) {
    const telegramService = new TelegramService(context.db);
    context.executionCtx.waitUntil(
      telegramService.forwardVisitorMessage(
        settings.telegramBotToken,
        settings.telegramChatId,
        conversation.visitorName,
        context.payload.content,
        conversation.id,
        conversation.telegramThreadId
          ? Number.parseInt(conversation.telegramThreadId, 10)
          : undefined,
      ).catch((error) => {
        logError(
          "widget_turn.telegram_forward_failed",
          error,
          buildWidgetTurnLogContext(context, turnId),
        );
      }),
    );
  }

  logInfo(
    "widget_turn.agent_mode_bypassed",
    buildWidgetTurnLogContext(context, turnId, {
      conversationStatus: conversation.status,
      modelCallCount: 0,
    }),
  );
  return Response.json({ ok: true, agentMode: true });
}
```

Delete `getLastTeamMessageRole`, `requestedAgent`, `prefetchedHistory`, and `shouldSilenceForAgent`.

- [ ] **Step 6: Move tool decryption out of the minimal preflight**

Remove the `decryptEnabledToolHeaders` call and tool-specific rate-limit check from the section before visitor-message persistence. Task 6 will restore them only on the normal planner path. Keep the existing decrypt block intact while moving it so its logging behavior is preserved:

```typescript
await decryptEnabledToolHeaders(
  enabledTools,
  context.env.ENCRYPTION_KEY,
  (row) => {
    logWarn(
      "widget_turn.tool_headers_decrypt_failed",
      buildWidgetTurnLogContext(context, turnId, {
        toolId: row.id,
        toolName: row.name,
      }),
    );
  },
);
```

- [ ] **Step 7: Run hard-gate tests and build**

Run:

```bash
bun test worker/chat-runtime/routing/identify-fast-path.test.ts
bun test worker/chat-runtime/orchestration/normalize-history.test.ts
bun run build
```

Expected: PASS. Search the handler to confirm the role-dependent condition is gone:

```bash
rg "getLastTeamMessageRole|shouldSilenceForAgent" worker/chat-runtime/orchestration/handle-widget-message-turn.ts
```

Expected: no matches.

- [ ] **Step 8: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/routing/identify-fast-path.ts worker/chat-runtime/routing/identify-fast-path.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/orchestration/normalize-history.ts worker/chat-runtime/orchestration/normalize-history.test.ts worker/chat-runtime/executor/run-planner-loop.ts
git commit -m "fix(chat): silence AI unconditionally during agent mode"
```

---

### Task 6: Route before auxiliary calls and contact extraction

**Files:**
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:390-680`
- Modify: `worker/chat-runtime/orchestration/prepare-turn-routing.ts:49-166`
- Modify: `worker/chat-runtime/orchestration/run-agentic-pipeline.ts:45-175`
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts:670-850`
- Create: `worker/chat-runtime/executor/run-planner-loop.test.ts`
- Modify: `worker/chat-runtime/types.ts`

- [ ] **Step 1: Add a pure fast-path translation test at the executor boundary**

Create `worker/chat-runtime/executor/run-planner-loop.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildFastPathPlannerDecision } from "./run-planner-loop";

describe("buildFastPathPlannerDecision", () => {
  test("translates a greeting into a compose decision", () => {
    expect(buildFastPathPlannerDecision({
      goal: "Help the visitor.",
      decision: {
        kind: "small_talk",
        reason: "pure_greeting",
        composeKind: "greeting",
      },
    })).toEqual({
      goal: "Help the visitor.",
      intent: "smalltalk",
      nextAction: {
        type: "compose",
        reason: "pure_greeting",
        composeKind: "greeting",
      },
    });
  });

  test("translates an FAQ into a grounded compose decision", () => {
    expect(buildFastPathPlannerDecision({
      goal: "Answer from the curated FAQ.",
      decision: {
        kind: "authoritative_faq",
        reason: "exact_faq",
        faq: {
          question: "How do I invite a team member?",
          answer: "Open Dashboard > Team.",
          score: 1,
        },
      },
    })).toMatchObject({
      nextAction: { type: "compose", composeKind: "grounded" },
    });
  });

  test("returns null for scope responses handled by the outer handler", () => {
    expect(buildFastPathPlannerDecision({
      goal: "Redirect unrelated requests.",
      decision: {
        kind: "scope_blocked",
        reason: "general_creative_request",
        response: "Support questions only.",
      },
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify red state**

Run:

```bash
env -u GEMINI_API_KEY -u OPENAI_API_KEY bun test worker/chat-runtime/executor/run-planner-loop.test.ts
```

Expected: FAIL because `buildFastPathPlannerDecision` is not exported.

- [ ] **Step 3: Carry the decision through pipeline types**

Add `fastPathDecision?: FastPathDecision | null` to the input interfaces for `runAgenticTurn` and `runPlannerLoop`, then pass it unchanged from the handler to `runAgenticTurn` and from `runAgenticTurn` to `runPlannerLoop`.

- [ ] **Step 4: Detect the candidate before `prepareTurnRouting`**

Move the existing `load_history` normalization block out of the SSE callback so it runs after the AI-only prefetch wave and before `return createWidgetSseResponse(...)`. Continue using `normalizeConversationHistory`, and remove all use of `context.payload.history` so D1 is canonical:

```typescript
const conversationHistory = normalizeConversationHistory({
  rawHistory: parallelPrefetchedHistory,
  currentMessage: context.payload.content,
});
```

Then, before `createModelRuntimeState` or `prepareTurnRouting`, compute:

```typescript
const scopeDecision = classifyTaskScope({
  message: context.payload.content,
  pageContext: context.payload.pageContext,
});
const sortedFaqResources = allResources
  .filter((resource) => resource.type === "faq")
  .sort((left, right) => left.title.localeCompare(right.title));
const faqMatch = findBestFaqMatch(
  sortedFaqResources.map((resource) => ({
    title: resource.title,
    content: resource.content,
  })),
  context.payload.content,
);
const fastPathMode = parseFastPathMode(context.env.CHAT_FAST_PATH_MODE);
const conversationMetadata = parseConversationMetadata(conversation.metadata);
const agentHandbackInstructions =
  typeof conversationMetadata.agentHandbackInstructions === "string"
    ? conversationMetadata.agentHandbackInstructions
    : null;
const fastPathCandidate = identifyFastPath({
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
const fastPathDecision =
  fastPathMode === "on" ? fastPathCandidate : null;
```

Reuse `conversationMetadata` and `agentHandbackInstructions` later when building `runAgenticTurn`; delete their former duplicate declarations inside the SSE callback.

Restore tool rate limiting and header decryption only for the normal planner path, still before opening SSE so the existing HTTP 429 contract is preserved:

```typescript
if (!fastPathDecision && enabledTools.length > 0) {
  if (!context.checkRateLimit(`toolmsg:${context.project.id}`, 100, 60_000)) {
    return Response.json(
      { error: "Tool execution rate limit exceeded. Please try again shortly." },
      { status: 429 },
    );
  }
  await decryptEnabledToolHeaders(
    enabledTools,
    context.env.ENCRYPTION_KEY,
    (row) => {
      logWarn(
        "widget_turn.tool_headers_decrypt_failed",
        buildWidgetTurnLogContext(context, turnId, {
          toolId: row.id,
          toolName: row.name,
        }),
      );
    },
  );
}
const availableTools = fastPathDecision
  ? []
  : enabledTools.map(toToolDefinition);
```

Log both candidate and selection:

```typescript
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

For `scope_blocked` in active mode, retain the existing immediate-response behavior and return before any model runtime is created.

- [ ] **Step 5: Skip auxiliary routing for active compose fast paths**

When `fastPathDecision` is `small_talk` or `authoritative_faq`, construct routing data locally:

```typescript
const routing = fastPathDecision
  ? {
      conversationSummary: null,
      compiledFaqContext:
        fastPathDecision.kind === "authoritative_faq"
          ? `<source type="faq-match" score="${fastPathDecision.faq.score.toFixed(2)}">\nQ: ${fastPathDecision.faq.question}\nA: ${fastPathDecision.faq.answer}\n</source>`
          : "",
      faqMatchHint:
        fastPathDecision.kind === "authoritative_faq"
          ? fastPathDecision.faq
          : null,
      selectedFaqSetIds: [],
      selectorOutcome: "fast_path" as const,
      sortedFaqResources,
      hasIndexedResources: allResources.some(
        (resource) => resource.status === "indexed",
      ),
    }
  : await prepareTurnRouting({
      modelRuntime,
      conversationHistory,
      currentMessage: context.payload.content,
      pageContext: context.payload.pageContext,
      sortedFaqResources,
      faqMatchHint: faqMatch,
      hasIndexedResources: allResources.some(
        (resource) => resource.status === "indexed",
      ),
      kv: context.env.CONVERSATIONS_CACHE,
      projectId: context.project.id,
      executionCtx: context.executionCtx,
      onRouterFinished(ms) {
        telemetry.routerMs = ms;
      },
      buildLogContext(extra = {}) {
        return buildWidgetTurnLogContext(context, turnId, extra);
      },
    });
```

Extend `selectorOutcome` with `"fast_path"`.

Change `TurnRoutingInput` in `prepare-turn-routing.ts` so the normal path reuses the handler's sorting and ranking work:

```typescript
import {
  getOrBuildCompiledFaqContext,
  type FaqMatchResult,
} from "../prompt/build-compiled-faq-context";
```

Remove the former `findBestFaqMatch` import.

```typescript
export interface TurnRoutingInput {
  modelRuntime: ModelRuntimeState;
  conversationHistory: ConversationTurnMessage[];
  currentMessage: string;
  pageContext?: Record<string, string>;
  sortedFaqResources: FaqLikeResource[];
  faqMatchHint: FaqMatchResult | null;
  hasIndexedResources: boolean;
  kv: KVNamespace;
  projectId: string;
  executionCtx: ExecutionContext;
  onRouterFinished?: (elapsedMs: number) => void;
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}
```

Remove the internal resource filter/sort and `findBestFaqMatch` call. Compile from `input.sortedFaqResources`, and return `input.faqMatchHint` and `input.hasIndexedResources`.

- [ ] **Step 6: Execute injected fast paths before contact extraction**

In `runPlannerLoop`, move `populateKnownVisitorInfo` below the fast-path decision. Add the pure function tested in Step 1:

```typescript
export function buildFastPathPlannerDecision(input: {
  goal: string;
  decision: FastPathDecision;
}): PlannerDecision | null {
  if (input.decision.kind === "scope_blocked") return null;
  if (input.decision.kind === "small_talk") {
    return {
      goal: input.goal,
      intent: "smalltalk",
      nextAction: {
        type: "compose",
        reason: input.decision.reason,
        composeKind: input.decision.composeKind,
      },
    };
  }
  return {
    goal: input.goal,
    nextAction: {
      type: "compose",
      reason: input.decision.reason,
      composeKind: "grounded",
    },
  };
}
```

Compute:

```typescript
const injectedComposeDecision = options.fastPathDecision
  ? buildFastPathPlannerDecision({
      goal: loopState.goal,
      decision: options.fastPathDecision,
    })
  : null;
```

Use that value as the first planner decision without calling `planNextAction`. Delete the old score-based `shouldFaqFastPath` condition so one component owns the route. Preserve `detectSmallTalk` only as a fallback when `CHAT_FAST_PATH_MODE` is not `on` until rollout is complete.

Call `populateKnownVisitorInfo` only after confirming there is no injected fast path. This preserves current contact accuracy on the normal planner route while guaranteeing that active small-talk and FAQ fast paths never run contact extraction. Moving extraction off ordinary documentation turns belongs in the later bounded-executor plan because it changes planner/contact ordering.

- [ ] **Step 7: Run focused chat-runtime tests**

Run:

```bash
env -u GEMINI_API_KEY -u OPENAI_API_KEY bun test \
  worker/chat-runtime/routing/identify-fast-path.test.ts \
  worker/chat-runtime/executor/run-planner-loop.test.ts \
  worker/chat-runtime/planner/small-talk.test.ts \
  worker/chat-runtime/planner/plan-next-action.test.ts \
  worker/chat-runtime/prompt/build-compiled-faq-context.test.ts
```

Expected: PASS with live-model integration cases skipped, not failed.

- [ ] **Step 8: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/orchestration/prepare-turn-routing.ts worker/chat-runtime/orchestration/run-agentic-pipeline.ts worker/chat-runtime/executor/run-planner-loop.ts worker/chat-runtime/executor/run-planner-loop.test.ts worker/chat-runtime/types.ts
git commit -m "feat(chat): run deterministic routes before auxiliary model calls"
```

---

### Task 7: Keep retrieved FAQ evidence in the priority evidence tier

**Files:**
- Modify: `worker/chat-runtime/executor/run-planner-loop.test.ts`
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` in `executeCompose`

- [ ] **Step 1: Add a composer-input regression test**

Extend the import in `run-planner-loop.test.ts` and add a focused test around the evidence merge helper used by `executeCompose`:

```typescript
import {
  buildComposerFaqEvidence,
  buildFastPathPlannerDecision,
} from "./run-planner-loop";

test("merges retrieved FAQ evidence with curated FAQ evidence", () => {
  const result = buildComposerFaqEvidence({
    compiledFaqContext: "<source type=\"faq\">Curated answer</source>",
    retrievedFaqContext: "<source type=\"faq\">Retrieved answer</source>",
  });

  expect(result).toContain("Curated answer");
  expect(result).toContain("Retrieved answer");
});
```

- [ ] **Step 2: Run the test and verify red state**

Run:

```bash
bun test worker/chat-runtime/executor/run-planner-loop.test.ts
```

Expected: FAIL because composer FAQ evidence currently receives only the compiled selection while retrieved FAQ text is split from `knowledgeBaseContext`.

- [ ] **Step 3: Implement the evidence merge**

Add:

```typescript
export function buildComposerFaqEvidence(input: {
  compiledFaqContext: string;
  retrievedFaqContext: string;
}): string {
  return [input.compiledFaqContext.trim(), input.retrievedFaqContext.trim()]
    .filter(Boolean)
    .join("\n\n");
}
```

In `executeCompose`, pass:

```typescript
faqContext: buildComposerFaqEvidence({
  compiledFaqContext: options.compiledFaqContext,
  retrievedFaqContext: options.state.docsEvidence.faqContext,
}),
```

Continue passing `knowledgeBaseContext` as RAG document evidence. Do not duplicate `faqContext` inside the document block.

- [ ] **Step 4: Run retrieval and prompt tests**

Run:

```bash
bun test worker/chat-runtime/executor/run-planner-loop.test.ts worker/chat-runtime/retrieval/build-rag-context.test.ts worker/chat-runtime/prompt/build-support-system-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/executor/run-planner-loop.ts worker/chat-runtime/executor/run-planner-loop.test.ts
git commit -m "fix(chat): preserve retrieved FAQ evidence during composition"
```

---

### Task 8: Introduce a versioned single terminal SSE event

**Files:**
- Modify: `worker/chat-runtime/streaming/map-agent-events-to-sse.ts`
- Modify: `worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:436-461, 800-870`
- Modify: `worker/chat-runtime/types.ts:450-470`
- Modify: `worker/validation.ts` (`sendMessageSchema`)
- Modify: `worker/index.ts:862-914`
- Modify: `widget/index.ts:4645-4865`

- [ ] **Step 1: Add completion-event serialization tests**

Add `emitCompletedEvent` to the existing import from `map-agent-events-to-sse`, then append this test inside the existing top-level `describe`:

```typescript
test("emits one authoritative completion payload", () => {
  const { controller, encoder, chunks } = createTestController();

  emitCompletedEvent(controller, encoder, {
    messageId: "msg_1",
    finalText: "Happy to help!",
    conversationStatus: "closed",
    sources: [],
  });

  expect(chunks).toHaveLength(1);
  expect(chunks[0].payload).toEqual({
    completed: {
      messageId: "msg_1",
      finalText: "Happy to help!",
      conversationStatus: "closed",
      sources: [],
    },
  });
});
```

- [ ] **Step 2: Run the streaming test and verify red state**

Run:

```bash
bun test worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts
```

Expected: FAIL because `emitCompletedEvent` does not exist.

- [ ] **Step 3: Implement the typed event helper**

Add to `map-agent-events-to-sse.ts`:

```typescript
export interface WidgetCompletedPayload {
  messageId: string | null;
  finalText: string;
  conversationStatus: "active" | "waiting_agent" | "agent_replied" | "closed";
  sources: Array<{ title: string; url: string | null; type: string }>;
}

export function emitCompletedEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  completed: WidgetCompletedPayload,
): void {
  emitSseEvent(controller, encoder, { completed });
}
```

- [ ] **Step 4: Add a backwards-compatible protocol negotiation field**

Add an optional literal to `sendMessageSchema` in `worker/validation.ts`:

```typescript
streamProtocolVersion: z.literal(2).optional(),
```

Add to `WidgetMessageTurnContext` in `worker/chat-runtime/types.ts`:

```typescript
streamProtocolVersion: 1 | 2;
```

Pass it from the route in `worker/index.ts`:

```typescript
streamProtocolVersion: parsed.data.streamProtocolVersion ?? 1,
```

Old cached widgets omit the field and continue to receive the legacy event contract. The new widget sends `2` in its JSON request body; no custom header or CORS preflight change is required.

- [ ] **Step 5: Emit completion only after persistence for protocol v2**

In both immediate and normal response branches of `handleWidgetMessageTurn`:

1. Strip internal tokens.
2. Apply the resolution state transition when `[RESOLVED]` was detected.
3. Persist the bot message once.
4. Broadcast it once.
5. For protocol v2, emit one `completed` event containing the persisted text, message ID, final status, and capped sources.

Initialize and update the terminal status explicitly:

```typescript
let finalConversationStatus:
  | "active"
  | "waiting_agent"
  | "agent_replied"
  | "closed" = conversation.status as
    | "active"
    | "waiting_agent"
    | "agent_replied"
    | "closed";

if (
  loopResult.detectedInternalTokens.includes("[RESOLVED]") &&
  !flaggedForReview
) {
  await chatService.updateConversationStatus(
    context.conversationId,
    context.project.id,
    "closed",
    "bot_resolved",
  );
  finalConversationStatus = "closed";
}
```

Keep the existing status-change broadcasts in that branch.

Use this compatibility branch at the terminal boundary:

```typescript
if (context.streamProtocolVersion === 2) {
  emitCompletedEvent(controller, encoder, {
    messageId: botMessage.id,
    finalText: fullResponse,
    conversationStatus: finalConversationStatus,
    sources: cappedSources,
  });
} else {
  if (finalConversationStatus === "closed") {
    emitSseEvent(controller, encoder, { resolved: true });
  }
  emitSseEvent(controller, encoder, { finalText: fullResponse });
  emitSseEvent(controller, encoder, {
    done: true,
    messageId: botMessage.id,
    sources: cappedSources,
  });
}
```

Text deltas and status/tool events remain unchanged. The legacy branch is intentionally retained until widget protocol-v2 adoption is confirmed.

For an intentionally empty escalated response, preserve the same protocol split:

```typescript
if (context.streamProtocolVersion === 2) {
  emitCompletedEvent(controller, encoder, {
    messageId: null,
    finalText: "",
    conversationStatus: "waiting_agent",
    sources: [],
  });
} else {
  emitSseEvent(controller, encoder, { done: true });
}
```

- [ ] **Step 6: Update the widget request and parser**

In `widget/index.ts`:

- Add `streamProtocolVersion: 2` to the existing request body.
- Keep legacy `data.resolved`, `data.finalText`, and `data.done` parsing during the compatibility window.
- Keep `data.text`, status, tool, inquiry, and error handling.
- Handle `data.completed` with this logic:

```typescript
if (data.completed) {
  hideTyping();
  const completed = data.completed as {
    messageId: string | null;
    finalText: string;
    conversationStatus: "active" | "waiting_agent" | "agent_replied" | "closed";
    sources: Array<{ title: string; url: string | null; type: string }>;
  };
  botMessage = completed.finalText;

  if (botMessage) {
    if (!botMessageEl) {
      botMessageEl = addMessageToUI("bot", botMessage);
    } else {
      botMessageEl.innerHTML = renderMarkdown(botMessage);
      updateLastBotHistoryEntry(botMessage);
    }
  }
  if (completed.sources.length > 0 && botMessageEl) {
    addSourcesToMessage(botMessageEl, completed.sources);
  }
  if (completed.messageId) {
    renderedMessageIds.add(completed.messageId);
    lastSeenMessageId = completed.messageId;
    newestResponseId = completed.messageId;
    reportDelivered();
    reportRead();
  }

  conversationStatus = completed.conversationStatus;
  syncConversationModeUi();
  if (conversationStatus === "closed") {
    stopPolling();
    stopHeartbeat();
    disconnectWebSocket();
  }
  lastMessageTimestamp = Date.now();
  scrollToBottom();
  continue;
}
```

Delete both hard-coded `"Glad I could help!..."` additions from the legacy `done` and truncated-stream branches. On a legacy `resolved` event, set closed state but keep the server's `finalText`; never add client-authored bot text. The server-authored localized final text is the only closing message in both protocols.

- [ ] **Step 7: Run streaming tests and build the widget**

Run:

```bash
bun test worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts worker/chat-runtime/streaming/internal-tokens.test.ts
bun run widget:build
bun run build
```

Expected: PASS. Confirm obsolete client branches are gone:

```bash
rg "Glad I could help" widget/index.ts
```

Expected: no matches.

- [ ] **Step 8: Checkpoint**

If commits are approved:

```bash
git add worker/chat-runtime/streaming/map-agent-events-to-sse.ts worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/types.ts worker/validation.ts worker/index.ts widget/index.ts
git commit -m "fix(chat): make stream completion authoritative and singular"
```

---

### Task 9: Verify shadow-mode behavior and activate safely

**Files:**
- No planned modifications; this task verifies the changes from Tasks 1–8.

- [ ] **Step 1: Run the hermetic focused suite**

Run:

```bash
env -u GEMINI_API_KEY -u OPENAI_API_KEY bun test \
  worker/chat-runtime/orchestration/normalize-history.test.ts \
  worker/chat-runtime/routing/identify-fast-path.test.ts \
  worker/chat-runtime/llm/create-language-model.test.ts \
  worker/chat-runtime/executor/run-planner-loop.test.ts \
  worker/chat-runtime/workflows/classify-task-scope.test.ts \
  worker/chat-runtime/prompt/build-compiled-faq-context.test.ts \
  worker/chat-runtime/retrieval/build-rag-context.test.ts \
  worker/chat-runtime/planner/small-talk.test.ts \
  worker/chat-runtime/planner/plan-next-action.test.ts \
  worker/chat-runtime/streaming/internal-tokens.test.ts \
  worker/chat-runtime/streaming/map-agent-events-to-sse.test.ts \
  worker/services/chat-service.test.ts
```

Expected: zero failures; explicitly marked live-model tests may be skipped.

- [ ] **Step 2: Run static and build verification**

Run:

```bash
bun run lint
bun run build
bun run widget:build
```

Expected: no new lint errors and successful worker/dashboard/widget builds. Record pre-existing lint failures separately instead of modifying unrelated files.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only files named in this plan are modified.

- [ ] **Step 4: Deploy shadow mode only after explicit approval**

Do not deploy as part of implementation. When the user explicitly approves a deploy, leave:

```json
"CHAT_FAST_PATH_MODE": "shadow"
```

Shadow mode must log candidates while preserving existing responses.

Release the compatibility pieces in this order:

1. Deploy the worker/dashboard build with protocol-v1 fallback and `CHAT_FAST_PATH_MODE=shadow`.
2. Build and upload the protocol-v2 widget only after separate explicit widget-deploy approval.
3. Confirm protocol-v2 completion events in logs before evaluating fast-path activation.

This ordering keeps cached v1 widgets working while new widgets move to the singular completion contract.

- [ ] **Step 5: Review shadow telemetry**

For a representative sample, calculate by `candidate` and `reason`:

- Candidate count.
- Candidate/planner outcome agreement.
- False-positive count from conversation review.
- Route-entry-to-first-text latency.
- Model-call count.
- FAQ precision, recall, and margin distributions.

Activation gates:

- Zero agent-mode AI invocations.
- Zero known false-positive scope blocks caused by page context.
- Zero duplicate closing messages.
- At least 99.5% reviewed precision for `small_talk` and `authoritative_faq` candidates.
- No candidate category with fewer than 100 reviewed examples is activated solely from aggregate metrics.

- [ ] **Step 6: Activate without changing code**

After the user explicitly approves activation, change only:

```json
"CHAT_FAST_PATH_MODE": "on"
```

Build and deploy through the repository's normal approved release flow. Roll back by returning the value to `shadow` or `off`; no schema rollback is required.

---

## Self-review record

- **Spec coverage:** The plan covers deterministic identification, strict precedence, agent-mode silence, FAQ false positives, scope leakage, pre-auxiliary execution, evidence continuity, widget completion, telemetry, shadow rollout, and rollback.
- **Scope discipline:** The one-planner/one-composer executor, rolling summaries, prompt-wide compaction, and conversation serialization remain separate projects because they can ship and fail independently.
- **Type consistency:** `FastPathDecision` is defined once in `types.ts`; the handler, pipeline, and executor consume that same type. `FaqMatchResult.authoritative` is produced by the ranker and consumed by the pure router.
- **Safety:** Every ambiguous classifier result falls back to the existing planner. The default environment mode is `shadow`, and deployment is explicitly excluded without approval.
