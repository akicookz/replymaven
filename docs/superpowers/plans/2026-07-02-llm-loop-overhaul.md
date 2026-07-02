# LLM Chat Loop Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the widget chat runtime so one component owns each decision (planner = classifier), the sanitizer enforces invariants instead of policy, all visitor-facing text passes through one voice layer, and the four reported symptoms (clarify-instead-of-answer, failing follow-ups, docs search on greetings, LLM-y ad-copy tone) are fixed at their roots.

**Architecture:** Delete the pre-loop `classifySupportTurn` router and make the planner's first step the single classifier (it gains `intent` + `composeKind` fields). Shrink `sanitizePlannerDecision` to invariant enforcement (dedup, budgets, contact-state, clarify limits) — it no longer rewrites greeting composes into doc searches. Introduce a shared voice contract (staff "we"-voice, chat register) used by the compose prompt, the handoff renderer, and a new ask-user renderer, and delete the post-hoc output stripper that fought the prompt.

**Tech Stack:** TypeScript on Cloudflare Workers, Hono, AI SDK v6 (`ai` package: `generateText`, `Output.object`, `streamText`), Zod v4, bun test.

## Global Constraints

- Package manager / test runner: **bun** only (`bun test`, `bun run build`). Never npm/yarn.
- All code must be Cloudflare Workers–compatible (no Node-only APIs).
- **Commits:** CLAUDE.md forbids committing unless the user explicitly asks, each time, and forbids co-authored commits. At execution start, ask the user whether to commit per task. Commit steps below are checkpoints — skip them (leave work uncommitted) unless the user has said to commit. Never add `Co-Authored-By`.
- **Never smoke-test the widget message route from `wrangler dev`** — dev binds the **production** D1 database (`remote: true`). Verification = unit tests + typecheck only. Live verification happens only after a deliberate deploy, against a designated test project.
- `bun test` baseline: 7 pre-existing failures marked "(LLM integration)" are environmental (need API keys) and expected. `bun run lint` has ~16 pre-existing problems. Do not add new failures/warnings; do not chase the pre-existing ones.
- Test files live next to sources (`foo.ts` → `foo.test.ts`), use `import { describe, expect, test } from "bun:test"`.
- Prompt copy in this plan is exact — copy it verbatim. Prompt tests assert on substrings; when a prompt string changes, its test assertions change in the same task.

## File Map (what this plan touches)

| File | Role |
|---|---|
| `worker/chat-runtime/orchestration/normalize-history.ts` | **NEW** — history convention helpers |
| `worker/chat-runtime/planner/small-talk.ts` | **NEW** — deterministic greeting/resolution detector |
| `worker/chat-runtime/prompt/voice.ts` | **NEW** — single voice contract + tone resolution |
| `worker/chat-runtime/llm/render-ask-user-message.ts` | **NEW** — tone/language renderer for clarifying questions |
| `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` | history block, turnPlan removal, resolved flow, chatState continuity |
| `worker/chat-runtime/orchestration/prepare-turn-routing.ts` | drop classifier call |
| `worker/chat-runtime/orchestration/run-agentic-pipeline.ts` | drop turnPlan passthrough |
| `worker/chat-runtime/executor/run-planner-loop.ts` | loop wiring, fast paths, full-transcript call sites, ask_user rendering, stripper removal |
| `worker/chat-runtime/planner/plan-next-action.ts` | schema + prompt (planner = classifier), sanitizer shrink, fallback merge |
| `worker/chat-runtime/llm/auxiliary-calls.ts` | delete classifier |
| `worker/chat-runtime/llm/support-prompt-builders.ts` | delete classifier prompt, we-voice handoff directives |
| `worker/chat-runtime/llm/render-handoff-message.ts` | we-voice fallbacks |
| `worker/chat-runtime/prompt/build-support-system-prompt.ts` | voice contract, chat register, resolved-token instruction |
| `worker/chat-runtime/prompt/sections.ts` | planner-loop section signature |
| `worker/chat-runtime/types.ts` | type changes |
| `worker/chat-runtime/executor/strip-trailing-solicited-follow-up.ts` | **DELETE** (+ its test) |

---

### Task 1: History convention — `conversationHistory` = prior turns only

The current visitor message is appended to `conversationHistory` in the handler, then appended *again* as `userMessage` by `streamSupportAgent`, so the compose model sees it twice; the planner/classifier transcripts also contain it twice ("Conversation:" + "Latest visitor message:"). Fix the convention once: history never contains the current turn; call sites that need a full transcript (contact extraction, team-request summary, handoff rendering) append it explicitly.

**Files:**
- Create: `worker/chat-runtime/orchestration/normalize-history.ts`
- Create: `worker/chat-runtime/orchestration/normalize-history.test.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts:532-583` (the `load_history` block)
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (3 call-site groups: `populateKnownVisitorInfo` call ~line 656, `buildTeamRequestSummary` call ~line 1148, the three `buildRenderedHandoffMessage` calls ~lines 1050/1092/1273)

**Interfaces:**
- Produces: `normalizeConversationHistory(options: { rawHistory: Array<{ role: string; content: string }>; currentMessage: string }): ConversationTurnMessage[]` and `withCurrentTurn(history: ConversationTurnMessage[], currentMessage: string): ConversationTurnMessage[]` — used by every later task that touches transcripts.
- Consumes: `ConversationTurnMessage` from `../types`.

- [ ] **Step 1: Write the failing test**

`worker/chat-runtime/orchestration/normalize-history.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  normalizeConversationHistory,
  withCurrentTurn,
} from "./normalize-history";

describe("normalizeConversationHistory", () => {
  test("passes prior turns through unchanged", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "how do I embed the widget?" },
        { role: "bot", content: "Add the script tag to your site." },
      ],
      currentMessage: "it did not work",
    });
    expect(result).toEqual([
      { role: "visitor", content: "how do I embed the widget?" },
      { role: "bot", content: "Add the script tag to your site." },
    ]);
  });

  test("drops a trailing entry that duplicates the current message", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "hi" },
        { role: "bot", content: "Hello!" },
        { role: "visitor", content: "it did not work" },
      ],
      currentMessage: "it did not work",
    });
    expect(result).toEqual([
      { role: "visitor", content: "hi" },
      { role: "bot", content: "Hello!" },
    ]);
  });

  test("keeps an identical earlier visitor message that is not trailing", () => {
    const result = normalizeConversationHistory({
      rawHistory: [
        { role: "visitor", content: "help" },
        { role: "bot", content: "With what?" },
      ],
      currentMessage: "help",
    });
    expect(result).toHaveLength(2);
  });

  test("filters empty bot messages and caps at 10 entries", () => {
    const rawHistory = [
      { role: "bot", content: "" },
      ...Array.from({ length: 14 }, (_, i) => ({
        role: i % 2 === 0 ? "visitor" : "bot",
        content: `m${i}`,
      })),
    ];
    const result = normalizeConversationHistory({
      rawHistory,
      currentMessage: "current",
    });
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe("m4");
  });
});

describe("withCurrentTurn", () => {
  test("appends the current message as a visitor turn", () => {
    const history = [{ role: "bot" as const, content: "Hello!" }];
    expect(withCurrentTurn(history, "thanks")).toEqual([
      { role: "bot", content: "Hello!" },
      { role: "visitor", content: "thanks" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test worker/chat-runtime/orchestration/normalize-history.test.ts`
Expected: FAIL — cannot resolve `./normalize-history`.

- [ ] **Step 3: Implement `normalize-history.ts`**

```typescript
import { type ConversationTurnMessage } from "../types";

const HISTORY_LIMIT = 10;

// Convention: `conversationHistory` throughout the chat runtime contains the
// PRIOR turns only — never the message currently being answered. The current
// message always travels separately as `currentMessage`. Call sites that need
// a full transcript (contact extraction, handoff rendering, team-request
// summaries) append it explicitly via `withCurrentTurn`.
export function normalizeConversationHistory(options: {
  rawHistory: Array<{ role: string; content: string }>;
  currentMessage: string;
}): ConversationTurnMessage[] {
  const normalized = options.rawHistory
    .filter((message) => message.role !== "bot" || message.content)
    .map((message) => ({
      role: message.role as "visitor" | "bot" | "agent",
      content: message.content,
    }));

  // A freshly-fetched server history may already contain the just-saved
  // current visitor message as its last entry; drop it so the convention
  // holds for every history source (client payload, prefetch, fresh fetch).
  const last = normalized[normalized.length - 1];
  if (
    last &&
    last.role === "visitor" &&
    last.content === options.currentMessage
  ) {
    normalized.pop();
  }

  return normalized.slice(-HISTORY_LIMIT);
}

export function withCurrentTurn(
  conversationHistory: ConversationTurnMessage[],
  currentMessage: string,
): ConversationTurnMessage[] {
  return [
    ...conversationHistory,
    { role: "visitor", content: currentMessage },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test worker/chat-runtime/orchestration/normalize-history.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Replace the `load_history` block in the handler**

In `handle-widget-message-turn.ts`, add the import and replace the entire block from `currentStage = "load_history";` through `conversationHistory = normalized.slice(-10);` (both branches, currently lines ~532-583) with:

```typescript
currentStage = "load_history";
const clientHistory = context.payload.history;
const usedClientHistory =
  Array.isArray(clientHistory) && clientHistory.length > 0;
const rawHistory = usedClientHistory
  ? clientHistory
  : (parallelPrefetchedHistory ??
    prefetchedHistory ??
    (await chatService.getMessages(context.conversationId)));
// Prior turns only. The current visitor message travels separately as
// `currentMessage` everywhere downstream — see normalize-history.ts.
const conversationHistory = normalizeConversationHistory({
  rawHistory,
  currentMessage: context.payload.content,
});
```

Import at the top: `import { normalizeConversationHistory } from "./normalize-history";`
Keep the `widget_turn.history_loaded` log line that follows; it compiles unchanged.

- [ ] **Step 6: Append the current turn where a full transcript is required**

In `run-planner-loop.ts`, import `withCurrentTurn` from `../orchestration/normalize-history`, then:

1. `populateKnownVisitorInfo` call (~line 656): change `conversationHistory: options.conversationHistory,` → `conversationHistory: withCurrentTurn(options.conversationHistory, options.currentMessage),` (the current message may contain the email being extracted).
2. `buildTeamRequestSummary` call in the `escalate` branch (~line 1148): change `conversationHistory: options.conversationHistory,` the same way (the escalation brief must include the triggering message).
3. All three `buildRenderedHandoffMessage` calls (`offer_handoff` ~1050, `collect_contact` ~1092, `escalate` ~1273): change `conversationHistory: options.conversationHistory,` the same way (language matching needs the current message — on a first-turn handoff the history is otherwise empty).

Do **not** change: `planNextAction`, `executeCompose`/`streamSupportAgent`, `reformulateQuery`, `reformulateSearchQueries`, `summarizeConversation` — these all receive `currentMessage` separately and are the double-inclusion sites this task fixes.

- [ ] **Step 7: Typecheck and full test run**

Run: `bun run build 2>&1 | head -30` — expected: no new type errors.
Run: `bun test worker/chat-runtime` — expected: same pass/fail set as baseline plus the 5 new passing tests.

- [ ] **Step 8: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/orchestration/normalize-history.ts worker/chat-runtime/orchestration/normalize-history.test.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts worker/chat-runtime/executor/run-planner-loop.ts
git commit -m "fix(chat-runtime): stop sending the current visitor message twice to every model call"
```

---

### Task 2: Planner schema learns `intent` and `composeKind`

Additive schema/type change so the planner can declare classification and whether a compose needs evidence. No behavior change yet (Task 3 uses these fields).

**Files:**
- Modify: `worker/chat-runtime/types.ts` (`SupportIntent`, `PlannerComposeAction`, `PlannerDecision`, `PlannerLoopState`)
- Modify: `worker/chat-runtime/planner/plan-next-action.ts` (schema + decision mapping + prompt classification section)
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (`createInitialLoopState` seeds new state fields; record intent after each planner call)
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` (pass persisted clarify state in; persist it out)
- Test: `worker/chat-runtime/planner/plan-next-action.test.ts`

**Interfaces:**
- Produces: `type ComposeKind = "grounded" | "greeting" | "resolution" | "redirect"` (exported from `types.ts`); `PlannerComposeAction.composeKind?: ComposeKind`; `PlannerDecision.intent?: SupportIntent`; `SupportIntent` gains `"smalltalk"`; `PlannerLoopState` gains `intent: SupportIntent | null`, `clarificationAttempts: number`, `lastBotQuestion: string | null`.
- Consumes: nothing new.

- [ ] **Step 1: Extend types in `types.ts`**

```typescript
export type SupportIntent =
  | "how_to"
  | "troubleshoot"
  | "lookup"
  | "policy"
  | "clarify"
  | "handoff"
  | "smalltalk";

export type ComposeKind = "grounded" | "greeting" | "resolution" | "redirect";

export interface PlannerComposeAction {
  type: "compose";
  reason: string;
  answerStyle?: "direct" | "step_by_step" | "summary";
  // "grounded" composes require evidence (or an exhausted search); the other
  // kinds are declared evidence-free turns the sanitizer must not rewrite.
  composeKind?: ComposeKind;
}

export interface PlannerDecision {
  goal: string;
  // Classification of the visitor's latest message, set by the planner's
  // structured output (the planner IS the classifier). Optional because
  // deterministic fast paths and legacy fallbacks may omit it.
  intent?: SupportIntent;
  nextAction: PlannerNextAction;
}
```

Add to `PlannerLoopState` (keep every existing field):

```typescript
  // Classification recorded from the first planner decision of this turn.
  intent: SupportIntent | null;
  // Cross-turn clarify continuity, persisted via ConversationChatState.
  clarificationAttempts: number;
  lastBotQuestion: string | null;
```

- [ ] **Step 2: Extend the planner schema and decision mapping in `plan-next-action.ts`**

Add to `plannerDecisionSchema` (after `goal`):

```typescript
  intent: z
    .enum([
      "how_to",
      "troubleshoot",
      "lookup",
      "policy",
      "clarify",
      "handoff",
      "smalltalk",
    ])
    .describe("Classification of the visitor's latest message."),
  composeKind: z
    .enum(["grounded", "greeting", "resolution", "redirect"])
    .nullable()
    .describe(
      "Required when actionType is compose: 'grounded' for evidence-based answers, 'greeting' for greetings/small talk, 'resolution' when the visitor signals the issue is resolved or says thanks/goodbye, 'redirect' for off-topic redirects. Null for non-compose actions.",
    ),
```

In `planNextAction`'s return statement, add `intent: object.intent,` next to `goal`, and add `composeKind: object.composeKind ?? undefined,` into the `nextAction` object literal.

- [ ] **Step 3: Update the planner prompt's classification block**

In `promptText`, replace the three classification bullets for greetings/resolution/chit-chat with:

```
- Greetings ("hi", "hello", "hey", "good morning"): choose compose with composeKind "greeting" and intent "smalltalk". No search needed.
- Resolution signals ("thanks", "that worked", "got it", "it's ok now", "never mind", "all good", "no worries"): choose compose with composeKind "resolution" and intent "smalltalk". No search needed.
- Chit-chat or off-topic ("what's the weather", "tell me a joke"): choose compose with composeKind "redirect" and intent "smalltalk" to politely redirect.
- Product-overview questions ("what is this?", "how does it work?", "what does this product do?", "what do you offer?", "is this right for me?") are NOT ambiguous — the subject is this product and company. Never choose ask_user for them. If the SOPs, FAQs, or company background above already describe the product, choose compose with composeKind "grounded". Otherwise choose search_docs with an overview-style query such as "product overview what it does features getting started".
```

Add to the `Current planner state:` block:

```
- clarificationAttemptsThisConversation: ${options.state.clarificationAttempts}
- lastClarifyingQuestionAsked: ${options.state.lastBotQuestion ?? "none"}
```

Add one line to the `Anti-loop rules (CRITICAL):` block:

```
- If clarificationAttemptsThisConversation is 2 or more, ask_user is forbidden for the rest of this conversation — choose offer_handoff or compose instead.
```

Also update this existing rule so declared compose kinds are legitimate:

```
- Choose compose with composeKind "grounded" ONLY when SOPs, FAQs, or docs/tool evidence directly answers the question, OR when documentation searches have already been exhausted. Greetings, resolution signals, and off-topic redirects use their own composeKind and need no evidence.
```

- [ ] **Step 4: Seed and record the new loop state**

In `run-planner-loop.ts`:

1. `createInitialLoopState` gains a `persistedClarifyState` parameter and seeds the fields:

```typescript
function createInitialLoopState(
  turnPlan: SupportTurnPlan,
  conversationSummary: string | null,
  visitorInfo: { name: string | null; email: string | null },
  persistedContactState?: {
    awaitingContactFields: Array<"name" | "email">;
    awaitingHandoffConfirmation: boolean;
    contactDeclined: boolean;
  },
  persistedClarifyState?: {
    clarificationAttempts: number;
    lastBotQuestion: string | null;
  },
): PlannerLoopState {
  return {
    // ...all existing fields unchanged...
    intent: null,
    clarificationAttempts: persistedClarifyState?.clarificationAttempts ?? 0,
    lastBotQuestion: persistedClarifyState?.lastBotQuestion ?? null,
  };
}
```

`RunPlannerLoopOptions` gains `persistedClarifyState?: { clarificationAttempts: number; lastBotQuestion: string | null };` and the `runPlannerLoop` body passes it through to `createInitialLoopState`.

2. Immediately after `const sanitizedDecision = sanitizePlannerDecision({...})`, record classification once:

```typescript
    if (!loopState.intent && plannerDecision.intent) {
      loopState.intent = plannerDecision.intent;
    }
```

3. `AgenticTurnInput` in `run-agentic-pipeline.ts` gains the same `persistedClarifyState?` field, passed through to `runPlannerLoop`.

- [ ] **Step 5: Persist clarify continuity in the handler**

In `handle-widget-message-turn.ts`:

1. Pass state in — next to the existing `persistedContactState` argument of `runAgenticTurn`, add:

```typescript
        persistedClarifyState: {
          clarificationAttempts: chatState.clarificationAttempts,
          lastBotQuestion: chatState.lastBotQuestion,
        },
```

2. Persist state out — in the post-loop `chatState = { ...chatState, awaitingContactFields: ... }` update, add:

```typescript
        clarificationAttempts:
          loopResult.terminationAction === "ask_user"
            ? chatState.clarificationAttempts + 1
            : 0,
        lastBotQuestion:
          loopResult.terminationAction === "ask_user"
            ? loopResult.fullResponse
            : null,
```

(`ConversationChatState` already has both fields and `parseChatState` already defends them — no type/migration work.)

- [ ] **Step 6: Update the test helper and add coverage**

In `plan-next-action.test.ts`, add to the object returned by `createState()`:

```typescript
    intent: null,
    clarificationAttempts: 0,
    lastBotQuestion: null,
```

Add one new test:

```typescript
test("planner decision carries intent and composeKind through mapping", () => {
  const recovered = recoverPlannerDecisionFromText(
    JSON.stringify({
      goal: "Greet the visitor",
      intent: "smalltalk",
      actionType: "compose",
      reason: "Greeting",
      query: null,
      broaderQueries: null,
      toolName: null,
      toolInput: null,
      question: null,
      missingFields: null,
      answerStyle: "direct",
      composeKind: "greeting",
    }),
  );
  expect(recovered?.intent).toBe("smalltalk");
  expect(recovered?.composeKind).toBe("greeting");
});
```

- [ ] **Step 7: Verify**

Run: `bun test worker/chat-runtime/planner` then `bun run build 2>&1 | head -30`
Expected: planner tests pass (existing 24 + 1 new); no new type errors.

- [ ] **Step 8: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/types.ts worker/chat-runtime/planner/plan-next-action.ts worker/chat-runtime/planner/plan-next-action.test.ts worker/chat-runtime/executor/run-planner-loop.ts worker/chat-runtime/orchestration/run-agentic-pipeline.ts worker/chat-runtime/orchestration/handle-widget-message-turn.ts
git commit -m "feat(planner): planner declares intent and composeKind; clarify attempts persist across turns"
```

---

### Task 3: Sanitizer → invariants only; deterministic small-talk handling

Fixes the "docs search on Hi" root cause: the sanitizer stops rewriting declared-evidence-free composes into searches, and enforces the clarify limit the prompt only stated. A deterministic small-talk detector powers the fallback planner (greetings no longer default to `clarify` + retrieval) and a zero-LLM fast path.

**Files:**
- Create: `worker/chat-runtime/planner/small-talk.ts`
- Create: `worker/chat-runtime/planner/small-talk.test.ts`
- Modify: `worker/chat-runtime/planner/plan-next-action.ts` (`sanitizePlannerDecision` compose + ask_user branches, `fallbackPlanNextAction`)
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (greeting fast path before the planner call)
- Test: `worker/chat-runtime/planner/plan-next-action.test.ts`

**Interfaces:**
- Produces: `detectSmallTalk(message: string): "greeting" | "resolution" | null` from `planner/small-talk.ts`.
- Consumes: `ComposeKind`, `PlannerDecision.intent` from Task 2.

- [ ] **Step 1: Write failing tests for the detector**

`worker/chat-runtime/planner/small-talk.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { detectSmallTalk } from "./small-talk";

describe("detectSmallTalk", () => {
  test.each(["hi", "Hi!", "hello", "hey there", "good morning", "yo"])(
    "detects greeting: %s",
    (message) => {
      expect(detectSmallTalk(message)).toBe("greeting");
    },
  );

  test.each(["thanks", "thank you!", "that worked", "got it, thanks", "all good", "bye"])(
    "detects resolution: %s",
    (message) => {
      expect(detectSmallTalk(message)).toBe("resolution");
    },
  );

  test.each([
    "hi, my widget is broken",
    "thanks, but one more thing: how do I change the color?",
    "how does it work?",
    "hello@example.com is my email",
  ])("does not flag substantive messages: %s", (message) => {
    expect(detectSmallTalk(message)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test worker/chat-runtime/planner/small-talk.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `small-talk.ts`**

```typescript
// Deterministic detector for messages that never need evidence or an LLM
// planner step. Deliberately strict: only fires when the ENTIRE message is a
// greeting or a resolution signal — "hi, my widget is broken" must not match.
export type SmallTalkKind = "greeting" | "resolution";

const GREETING_RE =
  /^(hi|hii+|hello|hey|hey there|hi there|hello there|howdy|yo|good (morning|afternoon|evening))[!.,\s]*$/i;

const RESOLUTION_RE =
  /^(thanks( a lot| so much)?|thank you( so much| very much)?|thx|ty|got it([!.,\s]+thanks)?|that worked|perfect([!.,\s]+thanks)?|great([!.,\s]+thanks)?|awesome([!.,\s]+thanks)?|all good|ok(ay)? (thanks|got it)|no worries|never ?mind|(good)?bye|see you|that('s| is) all( i needed)?)[!.,\s]*$/i;

export function detectSmallTalk(message: string): SmallTalkKind | null {
  const normalized = message.trim();
  if (!normalized || normalized.length > 60) return null;
  if (GREETING_RE.test(normalized)) return "greeting";
  if (RESOLUTION_RE.test(normalized)) return "resolution";
  return null;
}
```

- [ ] **Step 4: Verify detector tests pass**

Run: `bun test worker/chat-runtime/planner/small-talk.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing sanitizer/fallback tests**

Add to `plan-next-action.test.ts`:

```typescript
test("sanitize lets a declared greeting compose through with no evidence", () => {
  const decision: PlannerDecision = {
    goal: "Greet the visitor",
    intent: "smalltalk",
    nextAction: { type: "compose", reason: "Greeting", composeKind: "greeting" },
  };
  const sanitized = sanitizePlannerDecision({
    decision,
    conversationHistory: [],
    currentMessage: "hi",
    turnPlan: createTurnPlan(),
    availableTools: [],
    state: createState(),
    maxSteps: 8,
  });
  expect(sanitized.nextAction.type).toBe("compose");
});

test("sanitize still forces search for grounded compose without evidence", () => {
  const decision: PlannerDecision = {
    goal: "Answer",
    nextAction: { type: "compose", reason: "Answer now", composeKind: "grounded" },
  };
  const sanitized = sanitizePlannerDecision({
    decision,
    conversationHistory: [],
    currentMessage: "how do I embed the widget?",
    turnPlan: createTurnPlan(),
    availableTools: [],
    state: createState(),
    maxSteps: 8,
  });
  expect(sanitized.nextAction.type).toBe("search_docs");
});

test("sanitize blocks a second ask_user in the same turn", () => {
  const state = createState();
  state.actionHistory.push({
    type: "ask_user",
    reason: "asked already",
    outcome: "completed",
    note: "Which page?",
  });
  const sanitized = sanitizePlannerDecision({
    decision: {
      goal: "Clarify",
      nextAction: { type: "ask_user", reason: "still unclear", question: "Which browser?" },
    },
    conversationHistory: [],
    currentMessage: "it is broken",
    turnPlan: createTurnPlan(),
    availableTools: [],
    state,
    maxSteps: 8,
  });
  expect(sanitized.nextAction.type).toBe("offer_handoff");
});

test("sanitize blocks ask_user after two clarify turns in the conversation", () => {
  const state = createState();
  state.clarificationAttempts = 2;
  const sanitized = sanitizePlannerDecision({
    decision: {
      goal: "Clarify",
      nextAction: { type: "ask_user", reason: "unclear", question: "Which page?" },
    },
    conversationHistory: [],
    currentMessage: "it is broken",
    turnPlan: createTurnPlan(),
    availableTools: [],
    state,
    maxSteps: 8,
  });
  expect(sanitized.nextAction.type).toBe("offer_handoff");
});

test("fallback planner composes greetings without retrieval", () => {
  const decision = fallbackPlanNextAction({
    conversationHistory: [],
    currentMessage: "hi",
    turnPlan: createTurnPlan(),
    availableTools: [],
    state: createState(),
    maxSteps: 8,
  });
  expect(decision.nextAction.type).toBe("compose");
  expect(decision.intent).toBe("smalltalk");
});
```

Run: `bun test worker/chat-runtime/planner/plan-next-action.test.ts` — expected: the 5 new tests FAIL.

- [ ] **Step 6: Implement the sanitizer changes**

In `sanitizePlannerDecision`:

1. Replace the `compose` branch with:

```typescript
  if (nextAction.type === "compose") {
    const composeKind = nextAction.composeKind ?? "grounded";
    if (
      composeKind === "grounded" &&
      !options.state.docsEvidence.ragContext.trim() &&
      options.state.toolEvidence.length === 0
    ) {
      if (!options.state.docsEvidence.retrievalAttempted) {
        return {
          goal: nextGoal,
          nextAction: {
            type: "search_docs",
            reason: "A grounded answer needs evidence; search the docs first.",
            query: options.currentMessage,
            broaderQueries: [],
          },
        };
      }

      return {
        goal: nextGoal,
        nextAction: {
          ...nextAction,
          reason:
            "No evidence was found in the knowledge base; compose a response acknowledging that.",
        },
      };
    }
  }
```

2. Replace the `ask_user` branch with:

```typescript
  if (nextAction.type === "ask_user") {
    const alreadyAskedThisTurn = options.state.actionHistory.some(
      (entry) => entry.type === "ask_user",
    );
    if (alreadyAskedThisTurn || options.state.clarificationAttempts >= 2) {
      return {
        goal: nextGoal,
        nextAction: {
          type: "offer_handoff",
          reason:
            "Clarification limit reached; offer human follow-up instead of asking again.",
        },
      };
    }

    return {
      goal: nextGoal,
      nextAction: {
        ...nextAction,
        question: nextAction.question.trim(),
      },
    };
  }
```

- [ ] **Step 7: Implement the fallback change**

At the very top of `fallbackPlanNextAction` (before the step-limit check), add:

```typescript
  const smallTalk = detectSmallTalk(options.currentMessage);
  if (smallTalk) {
    return {
      goal: options.state.goal,
      intent: "smalltalk",
      nextAction: {
        type: "compose",
        reason:
          smallTalk === "greeting"
            ? "Greeting; respond directly without evidence."
            : "Resolution signal; close politely.",
        composeKind: smallTalk,
      },
    };
  }
```

Import: `import { detectSmallTalk } from "./small-talk";`

- [ ] **Step 8: Add the zero-LLM fast path in the loop**

In `run-planner-loop.ts`, immediately before the `shouldFaqFastPath` computation, add:

```typescript
    // Pure greetings / resolution signals skip the planner LLM entirely —
    // but never while a handoff or contact-collection flow is mid-flight
    // ("thanks" while awaiting contact fields must reach the planner).
    const smallTalkKind =
      loopState.stepCount === 0 &&
      !loopState.handoffRequested &&
      !loopState.awaitingHandoffConfirmation &&
      loopState.awaitingContactFields.length === 0
        ? detectSmallTalk(options.currentMessage)
        : null;
```

Then extend the decision selection: before the `shouldFaqFastPath` branch, add:

```typescript
    if (smallTalkKind) {
      plannerDecision = {
        goal: loopState.goal,
        intent: "smalltalk" as const,
        nextAction: {
          type: "compose" as const,
          reason:
            smallTalkKind === "greeting"
              ? "Greeting; respond directly."
              : "Resolution signal; close politely.",
          composeKind: smallTalkKind,
        },
      };
      logInfo(
        "widget_turn.plan_next_action_small_talk_fast_path",
        options.buildLogContext({ smallTalkKind }),
      );
    } else if (shouldFaqFastPath) {
```

(The existing `shouldFaqFastPath` / `shouldForceCompose` / LLM-planner chain becomes the `else` chain.)
Import: `import { detectSmallTalk } from "../planner/small-talk";`

- [ ] **Step 9: Verify**

Run: `bun test worker/chat-runtime/planner worker/chat-runtime/executor` and `bun run build 2>&1 | head -30`
Expected: all new tests pass; no regressions; no new type errors.

- [ ] **Step 10: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/planner/small-talk.ts worker/chat-runtime/planner/small-talk.test.ts worker/chat-runtime/planner/plan-next-action.ts worker/chat-runtime/planner/plan-next-action.test.ts worker/chat-runtime/executor/run-planner-loop.ts
git commit -m "fix(planner): greetings compose directly — sanitizer enforces invariants, not policy"
```

---

### Task 4: Delete the router — planner is the only classifier

Removes `classifySupportTurn` and the `SupportTurnPlan` plumbing end-to-end. After this task the routing wave is `summarizeConversation` + `selectFaqSets` + deterministic `findBestFaqMatch` only.

**Files:**
- Modify: `worker/chat-runtime/types.ts` (delete `SupportTurnPlan`; `PlannerLoopState` drops `initialTurnPlan`; `SupportPromptOptions.turnPlan` → `turnIntent`)
- Modify: `worker/chat-runtime/llm/auxiliary-calls.ts` (delete `classifySupportTurn`, `fallbackClassifySupportTurn`, `supportTurnPlanSchema`)
- Modify: `worker/chat-runtime/llm/support-prompt-builders.ts` (delete `buildClassifySupportTurnPrompt`)
- Modify: `worker/chat-runtime/orchestration/prepare-turn-routing.ts`
- Modify: `worker/chat-runtime/planner/plan-next-action.ts` (drop `turnPlan` from all three entry points and the prompt)
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts`
- Modify: `worker/chat-runtime/orchestration/run-agentic-pipeline.ts`
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts`
- Modify: `worker/chat-runtime/prompt/sections.ts` + `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Test: `worker/chat-runtime/planner/plan-next-action.test.ts`, `worker/chat-runtime/llm/auxiliary-calls.test.ts`, `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`

**Interfaces:**
- Produces: `PlanNextActionOptions` / `SanitizePlannerDecisionOptions` / `fallbackPlanNextAction` options **without** `turnPlan`; `TurnRoutingResult` without `turnPlan`; `buildPlannerLoopSection(turnIntent: string | null | undefined, plannerGoal: string | null | undefined, plannerActionHistory: PlannerActionHistoryEntry[] | undefined): string`; `SupportPromptOptions.turnIntent?: string | null`.
- Consumes: `PlannerLoopState.intent` from Task 2; small-talk fallback from Task 3.

- [ ] **Step 1: Delete the classifier**

In `auxiliary-calls.ts`: delete `supportTurnPlanSchema`, `classifySupportTurn`, `fallbackClassifySupportTurn`, and the now-unused `SupportTurnPlan` import. In `support-prompt-builders.ts`: delete `buildClassifySupportTurnPrompt`. In `auxiliary-calls.test.ts`: delete every test that exercises those two functions (they reference nothing else).

- [ ] **Step 2: Shrink `prepareTurnRouting`**

In `prepare-turn-routing.ts`: remove the `classifySupportTurn` entry from the `Promise.all` (keep `summarizeConversation` and the FAQ selection IIFE); remove `turnPlan` from `TurnRoutingResult` and the return object; remove the `classifySupportTurn`/`fallbackClassifySupportTurn` imports and the `SupportTurnPlan` import.

- [ ] **Step 3: Remove `turnPlan` from the planner module**

In `plan-next-action.ts`:

1. Delete `turnPlan: SupportTurnPlan;` from `PlanNextActionOptions`, `SanitizePlannerDecisionOptions`, and the `fallbackPlanNextAction` options type; remove the `SupportTurnPlan` import.
2. Delete the entire `Initial turn analysis:` block from `promptText` (the five lines from `Initial turn analysis:` through `- focusedFollowUp: ...`).
3. In `fallbackPlanNextAction`, change

```typescript
  const explicitHumanRequest =
    options.turnPlan.intent === "handoff" ||
    isExplicitHumanRequest(options.currentMessage);
```

to `const explicitHumanRequest = isExplicitHumanRequest(options.currentMessage);` and replace every `options.turnPlan.retrievalQueries[0] ?? options.currentMessage` with `options.currentMessage`, every `options.turnPlan.broaderQueries.slice(0, 2)` with `[]`.
4. In `sanitizePlannerDecision`, same replacements in the `call_tool`-missing-tool rewrite (the `compose` branch was already rewritten in Task 3); in the `offer_handoff` branch change `options.turnPlan.intent === "handoff" || isExplicitHumanRequest(...)` to just `isExplicitHumanRequest(options.currentMessage)`.

- [ ] **Step 4: Remove `turnPlan` from the loop and pipeline**

In `run-planner-loop.ts`:

1. Remove `turnPlan: SupportTurnPlan;` from `RunPlannerLoopOptions`; remove the `SupportTurnPlan` import.
2. `createInitialLoopState` drops its `turnPlan` parameter and `initialTurnPlan` field; seed `goal: "Understand and resolve the visitor's latest message."`.
3. Remove `turnPlan: options.turnPlan` from the `planNextAction`, `fallbackPlanNextAction`, and `sanitizePlannerDecision` call sites.
4. In `executeCompose`'s `buildSupportSystemPrompt` call, replace the `turnPlan: { intent..., summary..., followUpQuestion... }` option with `turnIntent: options.state.intent,`. Change `ComposeSystemPromptContext`/`executeCompose` state usage accordingly (it reads `options.state.intent` instead of `options.state.initialTurnPlan`).
5. In the `search_docs` branch, `reformulateSearchQueries` currently receives `intent: options.turnPlan.intent ?? undefined` — change to `intent: loopState.intent ?? undefined`.

In `run-agentic-pipeline.ts`: remove `turnPlan` from `AgenticTurnInput` and the passthrough; remove the `SupportTurnPlan` import.

- [ ] **Step 5: Rewire the handler**

In `handle-widget-message-turn.ts`:

1. Remove `turnPlan` from the `routing` destructure.
2. Delete the pre-loop `if (turnPlan.retrievalQueries.length > 0) { emitStatus("Searching docs...", "retrieval"); }` block — the loop already emits an honest "Searching knowledge base..." when it actually searches.
3. Delete `turnIntent = turnPlan.intent;` and `retrievalMode = turnPlan.retrievalQueries.length > 0 ? ... : "none";` — instead, after the loop completes, set:

```typescript
      turnIntent = loopResult.loopState.intent;
      retrievalMode = loopResult.retrieval.retrievalAttempted
        ? "bounded_actions"
        : "none";
```

4. The pre-loop `chatState` update becomes `chatState = { ...chatState, state: "answering" };` and the post-loop `chatState` update (from Task 2 Step 5) additionally sets `lastIntent: loopResult.loopState.intent ?? chatState.lastIntent,`.
5. Delete the `widget_turn.plan_computed` log block (its inputs no longer exist pre-loop); the `widget_turn.loop_completed` log already covers the turn.
6. Remove `turnPlan` from the `runAgenticTurn` call.

- [ ] **Step 6: Update the prompt section**

In `sections.ts`, replace `buildPlannerLoopSection` with:

```typescript
export function buildPlannerLoopSection(
  turnIntent: string | null | undefined,
  plannerGoal: string | null | undefined,
  plannerActionHistory: PlannerActionHistoryEntry[] | undefined,
): string {
  if (
    !turnIntent &&
    !plannerGoal &&
    (!plannerActionHistory || plannerActionHistory.length === 0)
  ) {
    return "";
  }
  const plannerHistory =
    plannerActionHistory && plannerActionHistory.length > 0
      ? plannerActionHistory
          .map((entry, index) => {
            return `${index + 1}. ${entry.type}: ${entry.reason}${entry.note ? ` (${entry.note})` : ""}`;
          })
          .join("\n")
      : "No prior planner actions.";

  return `<planner-loop>
Support intent: ${turnIntent ?? "unknown"}
Planner goal: ${plannerGoal ?? "unknown"}
Action history:
${plannerHistory}
</planner-loop>

`;
}
```

(The `Focused follow-up if needed:` line is gone on purpose — a clarifying question now only exists when the planner chooses `ask_user`.)

In `build-support-system-prompt.ts`: change the call to `buildPlannerLoopSection(options?.turnIntent, options?.plannerGoal, options?.plannerActionHistory)`. In `types.ts`, `SupportPromptOptions` replaces the `turnPlan?: {...}` member with `turnIntent?: string | null;` and `SupportIntent` stays (still used by planner types). Delete the `SupportTurnPlan` interface.

- [ ] **Step 7: Update tests**

1. `plan-next-action.test.ts`: delete the `createTurnPlan()` helper and every `turnPlan: createTurnPlan(),` / `initialTurnPlan: createTurnPlan(),` line (the state helper keeps all other fields). Remove the `SupportTurnPlan` import.
2. `build-support-system-prompt.test.ts` / `documentation-only.test.ts`: any construction passing `turnPlan:` switches to `turnIntent: "troubleshoot"` (or the intent string the test used).
3. Run `bun test worker/chat-runtime` and fix any remaining compile errors in tests mechanically (they are all `turnPlan` removals).

- [ ] **Step 8: Verify**

Run: `bun run build 2>&1 | head -40` — expected: clean.
Run: `bun test worker/chat-runtime` — expected: baseline minus deleted classifier tests, no new failures.
Run: `grep -rn "SupportTurnPlan\|classifySupportTurn" worker/ --include='*.ts'` — expected: no matches.

- [ ] **Step 9: Checkpoint (commit only if user approved)**

```bash
git add -A worker/chat-runtime worker/services
git commit -m "refactor(chat-runtime): delete the pre-loop classifier — the planner is the single classifier"
```

---

### Task 5: One voice contract for every visitor-facing prompt

Creates the shared staff-voice/chat-register contract and rewires the compose system prompt and the handoff renderer to use it. Fixes the "assistant talking about the company in third person" framing and the essay/markdown push.

**Files:**
- Create: `worker/chat-runtime/prompt/voice.ts`
- Create: `worker/chat-runtime/prompt/voice.test.ts`
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts`
- Modify: `worker/chat-runtime/llm/support-prompt-builders.ts` (`buildRenderHandoffMessagePrompt`)
- Test: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`, `worker/chat-runtime/prompt/documentation-only.test.ts`

**Interfaces:**
- Produces: `resolveToneInstruction(settings)` (moved to `voice.ts`, re-exported from `build-support-system-prompt.ts` so `compose-agent-draft.ts` and `render-handoff-message.ts` imports keep working) and `buildVoiceContract(settings: SupportPromptSettings, projectName: string): string`.
- Consumes: `SupportPromptSettings` from `../types`.

- [ ] **Step 1: Write the failing test**

`worker/chat-runtime/prompt/voice.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildVoiceContract, resolveToneInstruction } from "./voice";

const settings = {
  toneOfVoice: "friendly",
  customTonePrompt: null,
  companyContext: null,
  botName: "Ava",
  agentName: null,
};

describe("buildVoiceContract", () => {
  test("frames the bot as company staff speaking as 'we'", () => {
    const contract = buildVoiceContract(settings, "Acme");
    expect(contract).toContain("You are Ava and you work at Acme");
    expect(contract).toContain('say "we", "us", and "our"');
    expect(contract).toContain("third person");
  });

  test("bans essay register", () => {
    const contract = buildVoiceContract(settings, "Acme");
    expect(contract).toContain("live chat");
    expect(contract).toContain("em dashes");
    expect(contract).toContain("Match the visitor's language");
  });

  test("includes the configured tone", () => {
    expect(buildVoiceContract(settings, "Acme")).toContain(
      resolveToneInstruction(settings),
    );
  });
});
```

Run: `bun test worker/chat-runtime/prompt/voice.test.ts` — expected: FAIL, module not found.

- [ ] **Step 2: Implement `voice.ts`**

```typescript
import { type SupportPromptSettings } from "../types";

// Single source of truth for how the bot's configured tone maps to a phrasing
// instruction. (Moved from build-support-system-prompt.ts, which re-exports it
// for existing importers.)
export function resolveToneInstruction(
  settings: Pick<SupportPromptSettings, "toneOfVoice" | "customTonePrompt">,
): string {
  const toneInstructions: Record<string, string> = {
    professional: "Be concise, clear, and solution-oriented.",
    friendly: "Be warm, empathetic, and helpful while staying informative.",
    casual: "Keep things light and easy to understand.",
    formal: "Use proper language and be respectful and courteous.",
    custom: settings.customTonePrompt ?? "Be helpful and informative.",
  };

  return (
    toneInstructions[settings.toneOfVoice] ?? toneInstructions.professional
  );
}

// The one voice contract every visitor-facing prompt shares: the compose
// system prompt, the handoff renderer, and the ask-user renderer. Edit voice
// here, nowhere else.
export function buildVoiceContract(
  settings: SupportPromptSettings,
  projectName: string,
): string {
  const identity = settings.botName
    ? `You are ${settings.botName} and you work at ${projectName}.`
    : `You work at ${projectName}.`;

  return `${identity} You are answering visitors in ${projectName}'s live chat.

How you write:
- You speak AS the company: say "we", "us", and "our". Never refer to ${projectName} or "the team" in the third person, and never say "the ${projectName} team will..." — you ARE the team.
- ${resolveToneInstruction(settings)}
- Write like a person typing in a live chat, not like an article: plain sentences, contractions are fine, no marketing language, no filler enthusiasm ("I'd be happy to...", "Great question!").
- Match the visitor's language, and roughly match their message length: a short question gets a short answer. One to three sentences unless you are walking through steps.
- No headings, no em dashes, and no bullet lists unless you are listing 3 or more discrete steps or options. Use **bold** only for exact UI labels the visitor must find or click.
- Ask at most one question per message, and only when you need the answer to proceed.`;
}
```

- [ ] **Step 3: Verify voice tests pass**

Run: `bun test worker/chat-runtime/prompt/voice.test.ts` — expected: PASS.

- [ ] **Step 4: Rewire the compose system prompt**

In `build-support-system-prompt.ts`:

1. Delete the local `resolveToneInstruction` definition; add `export { resolveToneInstruction } from "./voice";` and `import { buildVoiceContract } from "./voice";`.
2. Replace the `<identity>` block construction (the `botIdentity`/`tone` lines and the block itself) with:

```typescript
  prompt += `<identity>
${buildVoiceContract(settings, projectName)}

You help ${projectName}'s customers and website visitors with questions about ${projectName}'s products, services, documentation, and policies.
</identity>

`;
```

(Keep the `identityRule` lines — they are used later in the response rules.)
3. In `<response-rules>`, replace the line
`- Keep responses concise but complete. Use short paragraphs and bullet points.`
with
`- Keep responses concise but complete, in the chat register described in <identity>.`
4. Replace the line
`- Do not end with optional offers like "Would you like an example?" or "Let me know if you want me to...". Ask a follow-up question only when it is required to continue.`
with
`- Do not end with optional offers like "Would you like an example?" or "Let me know if you want me to...". Ask a follow-up question only when it is required to continue. The ONE exception: when the documentation does not contain the answer, end by asking whether they'd like the question passed to our team — that question is required, not optional.`
5. In `<internal-behavior>`, replace the formatting line
`- Format responses using markdown: **bold** for emphasis, bullet points for lists, short paragraphs. Do not use headings (#).`
with
`- Markdown is supported but follow the chat register in <identity>; never use headings (#).`

- [ ] **Step 5: Rewire the handoff renderer prompt**

In `support-prompt-builders.ts`:

1. `RenderHandoffMessagePromptOptions` replaces `toneInstruction: string; botName: string | null;` with `voiceContract: string;`.
2. `buildRenderHandoffMessagePrompt` drops the `persona` construction; the prompt starts:

```typescript
  return `${options.voiceContract}

Write a single short chat message to the visitor.
...`;
```

(Everything from `Write a single short chat message` on is unchanged.)
3. In `render-handoff-message.ts`, replace the `resolveToneInstruction` import/usage with:

```typescript
import { buildVoiceContract } from "../prompt/voice";
```

and pass `voiceContract: buildVoiceContract(params.settings, params.projectName)` — this requires `RenderHandoffMessageParams` to gain `projectName: string`, and `buildRenderedHandoffMessage` in `run-planner-loop.ts` to gain and forward `projectName: options.project.name` at its three call sites. `params.settings` must be widened from the 3-field `Pick` to `SupportPromptSettings` (callers already pass full settings).

- [ ] **Step 6: Update prompt tests**

Run: `bun test worker/chat-runtime/prompt worker/chat-runtime/llm` and fix assertions:
- `build-support-system-prompt.test.ts` / `documentation-only.test.ts`: assertions on removed copy (`"Use short paragraphs and bullet points"` etc.) switch to the new copy from Steps 4-5 verbatim.
- `render-handoff-message.test.ts`: constructions gain `projectName`.
Expected after fixes: PASS.

- [ ] **Step 7: Typecheck**

Run: `bun run build 2>&1 | head -30` — expected: clean (`compose-agent-draft.ts` still imports `resolveToneInstruction` from `build-support-system-prompt` via the re-export).

- [ ] **Step 8: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/prompt worker/chat-runtime/llm worker/chat-runtime/executor
git commit -m "feat(voice): single staff-voice contract shared by compose and handoff prompts"
```

---

### Task 6: Clarifying questions go through the voice layer

`ask_user` currently emits the planner's raw JSON `question` (temperature-0, English, toneless) directly to the visitor. Render it like handoff messages: scoped model call, voice contract, visitor's language, deterministic fallback = the raw question.

**Files:**
- Create: `worker/chat-runtime/llm/render-ask-user-message.ts`
- Create: `worker/chat-runtime/llm/render-ask-user-message.test.ts`
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (`ask_user` branch)

**Interfaces:**
- Produces: `renderAskUserMessage(model: LanguageModel, params: { question: string; settings: SupportPromptSettings; projectName: string; conversationHistory: ConversationTurnMessage[] }, options?: { throwOnModelError?: boolean }): Promise<string>` and `isRenderedAskUserMessageValid(assessment: { asksExactlyOneQuestion: boolean; introducesNewTopics: boolean }): boolean`.
- Consumes: `buildVoiceContract` (Task 5), `withCurrentTurn` (Task 1).

- [ ] **Step 1: Write failing validation tests**

`worker/chat-runtime/llm/render-ask-user-message.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { isRenderedAskUserMessageValid } from "./render-ask-user-message";

describe("isRenderedAskUserMessageValid", () => {
  test("accepts a single on-topic question", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: true,
        introducesNewTopics: false,
      }),
    ).toBe(true);
  });

  test("rejects multi-question renders", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: false,
        introducesNewTopics: false,
      }),
    ).toBe(false);
  });

  test("rejects renders that drift onto new topics", () => {
    expect(
      isRenderedAskUserMessageValid({
        asksExactlyOneQuestion: true,
        introducesNewTopics: true,
      }),
    ).toBe(false);
  });
});
```

Run: `bun test worker/chat-runtime/llm/render-ask-user-message.test.ts` — expected: FAIL.

- [ ] **Step 2: Implement the renderer**

```typescript
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  type ConversationTurnMessage,
  type SupportPromptSettings,
} from "../types";
import { buildVoiceContract } from "../prompt/voice";

const renderAskUserSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "The chat message shown to the visitor, written in the visitor's language.",
    ),
  asksExactlyOneQuestion: z
    .boolean()
    .describe("True if the message asks exactly one question."),
  introducesNewTopics: z
    .boolean()
    .describe(
      "True if the message brings up topics, offers, or requests beyond the single clarifying question.",
    ),
});

export function isRenderedAskUserMessageValid(assessment: {
  asksExactlyOneQuestion: boolean;
  introducesNewTopics: boolean;
}): boolean {
  return assessment.asksExactlyOneQuestion && !assessment.introducesNewTopics;
}

// Renders the planner's clarifying question into the shared voice and the
// visitor's language. Model errors throw when `throwOnModelError` is set (so
// the caller's model-fallback wrapper can retry the other provider); guardrail
// violations fall back to the planner's raw question — same contract as
// renderHandoffMessage.
export async function renderAskUserMessage(
  model: LanguageModel,
  params: {
    question: string;
    settings: SupportPromptSettings;
    projectName: string;
    conversationHistory: ConversationTurnMessage[];
  },
  options?: { throwOnModelError?: boolean },
): Promise<string> {
  const transcript = params.conversationHistory
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: renderAskUserSchema }),
      prompt: `${buildVoiceContract(params.settings, params.projectName)}

Recent conversation (for continuity and to match the visitor's language):
${transcript || "No prior conversation"}

You need one piece of information from the visitor before you can help further. Rewrite the following clarifying question as a single short chat message in your voice and in the visitor's language. Keep exactly the same meaning — do not ask for anything else and do not add offers.

Question to ask: ${params.question}

After writing the message, set each self-report field to honestly describe the message you wrote (in any language).`,
      temperature: 0.3,
      maxOutputTokens: 200,
    });

    if (!output) {
      const error = new Error(
        "model did not produce a valid structured output",
      );
      error.name = "AI_NoObjectGeneratedError";
      throw error;
    }

    const message = output.message.trim();
    if (message && isRenderedAskUserMessageValid(output)) {
      return message;
    }
    return params.question;
  } catch (error) {
    if (options?.throwOnModelError === true) {
      throw error;
    }
    return params.question;
  }
}
```

- [ ] **Step 3: Verify tests pass**

Run: `bun test worker/chat-runtime/llm/render-ask-user-message.test.ts` — expected: PASS.

- [ ] **Step 4: Route the `ask_user` branch through it**

In `run-planner-loop.ts`, add next to `buildRenderedHandoffMessage`:

```typescript
async function buildRenderedAskUserMessage(options: {
  modelRuntime: ModelRuntimeState;
  question: string;
  settings: SupportPromptSettings;
  projectName: string;
  conversationHistory: ConversationTurnMessage[];
  buildLogContext: (extra?: Record<string, unknown>) => Record<string, unknown>;
}): Promise<string> {
  try {
    return await runWithModelFallback({
      runtime: options.modelRuntime,
      stage: "render_ask_user_message",
      logContext: options.buildLogContext(),
      operation: async (activeConfig) =>
        renderAskUserMessage(
          createLanguageModel(activeConfig),
          {
            question: options.question,
            settings: options.settings,
            projectName: options.projectName,
            conversationHistory: options.conversationHistory,
          },
          { throwOnModelError: true },
        ),
    });
  } catch {
    logWarn(
      "widget_turn.render_ask_user_message_fallback_used",
      options.buildLogContext(),
    );
    return options.question;
  }
}
```

Then in the `ask_user` branch, before `loopState.finalDraft = nextAction.question;`, render:

```typescript
      const renderedQuestion = await buildRenderedAskUserMessage({
        modelRuntime: options.modelRuntime,
        question: nextAction.question,
        settings: options.settings,
        projectName: options.project.name,
        conversationHistory: withCurrentTurn(
          options.conversationHistory,
          options.currentMessage,
        ),
        buildLogContext: options.buildLogContext,
      });
```

and use `renderedQuestion` for `finalDraft`, the `finalText` SSE event, and `fullResponse` in the return (keep `note: nextAction.question` in the action-history entry so the planner sees its own original wording).
Import `renderAskUserMessage` from `../llm/render-ask-user-message`.

(`buildMissingInputQuestion`'s templated question flows through this same path automatically — its stilted English becomes the fallback, not the visitor-facing default.)

- [ ] **Step 5: Verify**

Run: `bun test worker/chat-runtime` and `bun run build 2>&1 | head -30` — expected: green/baseline.

- [ ] **Step 6: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/llm/render-ask-user-message.ts worker/chat-runtime/llm/render-ask-user-message.test.ts worker/chat-runtime/executor/run-planner-loop.ts
git commit -m "feat(voice): clarifying questions render through the voice layer with language matching"
```

---

### Task 7: Resolution flow + handoff wording in staff voice

Two fixes: (a) the model writes its own goodbye (visitor's language/tone) ending with the `[RESOLVED]` token instead of the handler appending hardcoded English; (b) handoff directives and fallbacks stop saying "the team will follow up" from outside the company.

**Files:**
- Modify: `worker/chat-runtime/prompt/build-support-system-prompt.ts` (`<internal-behavior>` [RESOLVED] instruction)
- Modify: `worker/chat-runtime/orchestration/handle-widget-message-turn.ts` (resolved branch)
- Modify: `worker/chat-runtime/llm/support-prompt-builders.ts` (`describeHandoffDirective`)
- Modify: `worker/chat-runtime/llm/render-handoff-message.ts` (`fallbackRenderHandoffMessage`)
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (agentLabel defaults)
- Test: `worker/chat-runtime/prompt/build-support-system-prompt.test.ts`, `worker/chat-runtime/llm/render-handoff-message.test.ts`

**Interfaces:**
- Consumes: voice contract from Task 5. No new exports.

- [ ] **Step 1: Change the [RESOLVED] instruction**

In `build-support-system-prompt.ts` `<internal-behavior>`, replace the non-escalated branch string:

```
'If the visitor indicates their issue is resolved, thanks you for your help, confirms something worked, or says goodbye (e.g. "thanks, that solved it", "got it, thanks!", "that\'s all I needed", "bye"), reply with one short, natural goodbye in the visitor\'s language and your configured voice, and end that reply with the exact token "[RESOLVED]".'
```

(The escalated branch string is unchanged.)

- [ ] **Step 2: Stop appending hardcoded English in the handler**

In `handle-widget-message-turn.ts`, in the `[RESOLVED]` branch, replace:

```typescript
        const resolvedMessage =
          "Glad I could help! Feel free to reach out anytime if you have more questions.";
        fullResponse = fullResponse.trim()
          ? `${fullResponse.trim()}\n\n${resolvedMessage}`
          : resolvedMessage;
```

with:

```typescript
        // The model writes its own goodbye (visitor's language, configured
        // voice); the English string is only the empty-output fallback.
        fullResponse =
          fullResponse.trim() ||
          "Glad I could help! Feel free to reach out anytime if you have more questions.";
```

- [ ] **Step 3: We-voice handoff directives**

In `support-prompt-builders.ts` `describeHandoffDirective`, replace `variantIntent` with:

```typescript
  const variantIntent: Record<typeof directive.variant, string> = {
    created: `Tell the visitor you've passed this along and that ${directive.agentLabel} will follow up with them shortly. Speak as part of the company — "we", not "the team" as if you were outside it.`,
    already_forwarded: `Tell the visitor this conversation is already with ${directive.agentLabel} and the follow-up will continue there. Speak as part of the company.`,
  };
```

- [ ] **Step 4: We-voice fallback strings and labels**

In `render-handoff-message.ts` `fallbackRenderHandoffMessage`, replace the escalated-variant strings:

```typescript
  if (directive.variant === "created") {
    return `I've passed this along and ${directive.agentLabel} will follow up with you shortly.`;
  }
  return `This is already with ${directive.agentLabel} and they'll continue the follow-up there.`;
```

In `run-planner-loop.ts`, change every `options.settings.agentName ?? "the team"` and `options.settings.agentName ?? "a team member"` to `options.settings.agentName ?? "our team"` (three sites: offer_handoff, collect_contact, escalate). "our team" reads correctly in both the directives ("passed this along and our team will follow up") and the offer/collect fallbacks ("I can forward this to our team...") — update the remaining `fallbackRenderHandoffMessage` strings that hardcode "the team" to say "our team" as well (`collect_contact` × 3 and `offer_handoff` × 2 strings).

- [ ] **Step 5: Update tests**

- `build-support-system-prompt.test.ts`: the test asserting `'respond with ONLY the exact text "[RESOLVED]"'` changes to assert `'end that reply with the exact token "[RESOLVED]"'`; the escalated test's `.not.toContain` mirror updates to the same string.
- `render-handoff-message.test.ts`: fallback-string assertions update to the Step 4 copy.

Run: `bun test worker/chat-runtime/prompt worker/chat-runtime/llm` — expected: PASS after updates.

- [ ] **Step 6: Verify streaming still strips the token**

`[RESOLVED]` detection/stripping is positional-agnostic (`internal-tokens.ts` strips it wherever it appears in the stream). Confirm: `bun test worker/chat-runtime/streaming` — expected: baseline PASS, no changes needed.

- [ ] **Step 7: Checkpoint (commit only if user approved)**

```bash
git add worker/chat-runtime/prompt worker/chat-runtime/llm worker/chat-runtime/executor worker/chat-runtime/orchestration
git commit -m "fix(voice): model-authored goodbyes and we-voice handoff wording"
```

---

### Task 8: Delete the trailing-follow-up stripper

The stripper deletes content the prompt mandates (the forward-offer when docs are missing) and rewrites messages after they've been shown/persisted. The prompt now owns this rule (Task 5 Step 4 added the no-optional-offers rule with the required-offer exception).

**Files:**
- Delete: `worker/chat-runtime/executor/strip-trailing-solicited-follow-up.ts`
- Delete: `worker/chat-runtime/executor/strip-trailing-solicited-follow-up.test.ts`
- Modify: `worker/chat-runtime/executor/run-planner-loop.ts` (`executeCompose`)

- [ ] **Step 1: Remove usage**

In `run-planner-loop.ts` `executeCompose`, delete the import of `stripTrailingSolicitedFollowUp` and this block (after the stream flush):

```typescript
  if (!detectedInternalTokens.includes("[RESOLVED]")) {
    const strippedResponse = stripTrailingSolicitedFollowUp(fullResponse);
    if (strippedResponse !== fullResponse.trim()) {
      fullResponse = strippedResponse;
      emitSseEvent(options.controller, options.encoder, {
        finalText: fullResponse,
      });
    }
  }
```

- [ ] **Step 2: Delete the files**

```bash
rm worker/chat-runtime/executor/strip-trailing-solicited-follow-up.ts worker/chat-runtime/executor/strip-trailing-solicited-follow-up.test.ts
```

- [ ] **Step 3: Verify**

Run: `bun run build 2>&1 | head -20` and `bun test worker/chat-runtime` — expected: clean; the stripper's 5 tests are gone, nothing else changes.
Run: `grep -rn "stripTrailingSolicitedFollowUp" worker/` — expected: no matches.

- [ ] **Step 4: Checkpoint (commit only if user approved)**

```bash
git add -A worker/chat-runtime/executor
git commit -m "fix(chat-runtime): delete output stripper that deleted the prompt-mandated forward offer"
```

---

### Task 9: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: only the 7 pre-existing "(LLM integration)" environmental failures. Any other failure is a regression from this plan — fix it before proceeding.

- [ ] **Step 2: Typecheck + lint**

Run: `bun run build` — expected: clean.
Run: `bun run lint 2>&1 | tail -5` — expected: no more than the ~16 pre-existing problems.

- [ ] **Step 3: Dead-reference sweep**

Run: `grep -rn "turnPlan\|SupportTurnPlan\|classifySupportTurn\|followUpQuestion\|stripTrailingSolicitedFollowUp\|initialTurnPlan" worker/ --include='*.ts'`
Expected: no matches (comments included — update any stale comments found).

- [ ] **Step 4: Behavior checklist (code-level assertions, no live traffic)**

Confirm by reading the final code:
1. "Hi" path: `detectSmallTalk` fast-path → compose `greeting` → no `runAiSearch` call reachable. ✔
2. "thanks" path: fast-path `resolution` → compose → model goodbye + `[RESOLVED]` → close without appended English. ✔
3. "How does it work?" path: planner prompt's product-overview rule forbids `ask_user`; sanitizer allows grounded compose after retrieval attempt. ✔
4. Follow-up path: compose messages contain the current message exactly once; `ask_user` capped at 2 per conversation and rendered in visitor's language. ✔
5. No visitor-facing text bypasses voice: compose ✔ (system prompt), handoff ✔ (renderer), ask_user ✔ (renderer), resolved ✔ (model-authored). Remaining deterministic strings (scope-block, error fallback, capability fallback, renderer fallbacks) are last-resort paths — accepted.

- [ ] **Step 5: Live verification note**

Do NOT drive the widget from `wrangler dev` (prod D1). After the user approves a deploy (`bun run deploy:full`), verify on a designated test project: send "Hi", "thanks", "how does it work?", and a two-turn follow-up; confirm no "Searching knowledge base..." status on the greeting and we-voice phrasing throughout.

---

## Self-Review Notes

- **Spec coverage:** symptom 3 → Tasks 3+4 (compose gate exemption, fallback classifier deletion, honest status); symptom 1 → Tasks 2-4 (product-overview rule, followUpQuestion removal, clarify caps) + Task 6 (rendered questions); symptom 2 → Task 1 (duplication) + Task 8 (stripper) + Task 3 (clarify caps); symptom 4 → Tasks 5-7 (voice contract, ask_user rendering, resolution/handoff wording). Architectural steps: router collapse = Task 4, sanitizer shrink = Task 3, voice boundary = Tasks 5-7, stripper deletion = Task 8.
- **Sequencing:** each task compiles and tests green independently; Task 2 is additive so Tasks 3-4 can land separately; Task 5 must precede 6-7 (voice contract dependency).
- **Known accepted gaps:** scope-block/capability/error fallback strings stay deterministic English (they are abuse/failure paths where an extra LLM call is undesirable); `claimsUnavailableCapabilities` post-filter is kept (whole-message safety substitution, not text surgery).
