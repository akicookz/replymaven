# Idle human handoff takeover implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return a widget conversation to AI when two visitor messages arrive after the latest human reply has been idle for four hours.

**Architecture:** Add a pure transcript policy beside the public Agent turn gate. `MavenChatAgent` calls it only for an ordinary message that the existing gate classified as `human_mode`. A qualifying second message applies the existing `ai_handed_back` event, then continues through the normal AI turn in the same request.

**Tech stack:** TypeScript, Bun tests, Cloudflare Agents, Workers Vitest pool.

## Global constraints

- The timeout is fixed at four hours.
- Count only ordinary widget visitor messages created after the four-hour point.
- An explicit visitor `@BotName` invocation does not count.
- Inbound email messages do not count.
- An active snooze blocks takeover.
- The first qualifying message stays in human mode and follows the existing Telegram forwarding path.
- The second qualifying message changes ownership and gets the AI response.
- A later human reply resets the rule through the transcript.
- Human-owned conversations do not auto-close before the second message.
- Do not add a D1 column, Agent state field, scheduled task, dashboard setting, or inbound-email behavior.
- Do not add a visitor-visible handback message.
- Use Bun for every command.

---

### Task 1: Add the transcript eligibility policy

**Files:**
- Modify: `worker/agents/maven/public/public-turn.ts`
- Test: `worker/agents/maven/public/public-turn.test.ts`

**Interfaces:**
- Consumes: `PublicMessageRecord[]`, the submitted visitor message ID, and the configured bot name.
- Produces: `shouldResumeAiAfterHumanIdle(input): boolean`.

- [ ] **Step 1: Write failing policy tests**

Add a `publicRecord` test builder with explicit `author`, `content`, and `createdAt` values. Add tests that call:

```typescript
shouldResumeAiAfterHumanIdle({
  messages,
  submittedMessageId: "visitor-2",
  botName: "Maven",
})
```

Cover these exact cases:

```typescript
expect(secondMessageAfterFourHours).toBe(true);
expect(firstMessageAfterFourHours).toBe(false);
expect(twoMessagesBeforeFourHours).toBe(false);
expect(noHumanMessage).toBe(false);
expect(humanReplyBetweenVisitorMessages).toBe(false);
expect(explicitBotInvocationExcluded).toBe(false);
```

Use `const hour = 60 * 60 * 1_000`. Make the latest agent message timestamp `hour`, the cutoff `5 * hour`, and qualifying visitor timestamps `5 * hour` or later. In the reset case, insert a newer agent message between the two visitor messages. In the invocation case, use `@Maven answer this` for one of the two visitor records.

- [ ] **Step 2: Run the policy tests and verify failure**

Run:

```bash
bun test worker/agents/maven/public/public-turn.test.ts
```

Expected result: the test file fails because `shouldResumeAiAfterHumanIdle` is not exported.

- [ ] **Step 3: Implement the pure policy**

In `public-turn.ts`, import `PublicMessageRecord` and `parseVisitorAiInvocation`. Add:

```typescript
const HUMAN_IDLE_TAKEOVER_MS = 4 * 60 * 60 * 1_000;

interface ResumeAiAfterHumanIdleInput {
  messages: PublicMessageRecord[];
  submittedMessageId: string;
  botName: string | null | undefined;
  snoozedUntil?: number | null;
}

export function shouldResumeAiAfterHumanIdle(
  input: ResumeAiAfterHumanIdleInput,
): boolean {
  const submitted = input.messages.find((message) =>
    message.id === input.submittedMessageId
  );
  if (!submitted || submitted.author !== "visitor") return false;
  if (
    input.snoozedUntil !== null &&
    input.snoozedUntil !== undefined &&
    input.snoozedUntil > submitted.createdAt
  ) return false;

  let latestAgentMessage: PublicMessageRecord | null = null;
  for (let index = input.messages.length - 1; index >= 0; index--) {
    const message = input.messages[index];
    if (message?.author === "agent") {
      latestAgentMessage = message;
      break;
    }
  }
  if (!latestAgentMessage) return false;

  const cutoff = latestAgentMessage.createdAt + HUMAN_IDLE_TAKEOVER_MS;
  const qualifyingVisitors = input.messages.filter((message) =>
    message.author === "visitor" &&
    message.origin !== "email" &&
    message.createdAt >= cutoff &&
    !parseVisitorAiInvocation(message.content, input.botName).invoked
  );
  return qualifyingVisitors.length >= 2 &&
    qualifyingVisitors.at(-1)?.id === input.submittedMessageId;
}
```

- [ ] **Step 4: Run the policy tests**

Run:

```bash
bun test worker/agents/maven/public/public-turn.test.ts
```

Expected result: all tests in the file pass.

### Task 2: Apply takeover in the public widget turn

**Files:**
- Modify: `worker/agents/maven/maven-chat-agent.ts:665-795`
- Test: `worker/agents/maven/public/public-child.integration.test.ts`
- Test: `worker/agents/maven/public/public-operations.integration.test.ts`

**Interfaces:**
- Consumes: `shouldResumeAiAfterHumanIdle` from Task 1 and the existing `transitionPublicOwnership("ai_handed_back")`.
- Produces: a second post-idle visitor request that changes the conversation to `active` and streams the normal AI response.

- [ ] **Step 1: Add a failing native Agent integration test**

Create a human-owned conversation with:

```typescript
record.status = "agent_replied";
record.chatState = {
  state: "agent_mode",
  aiParticipation: "human_only",
  ownershipRevision: 1,
};
record.ownershipRevision = 1;
```

Seed one agent message at `Date.now() - (4 * 60 * 60 * 1_000) - 1`. Open the authenticated visitor WebSocket using the existing `signPublicChatToken` pattern.

Send one ordinary visitor request and wait for its completed response frame. Assert:

```typescript
expect(firstSnapshot.conversation.status).toBe("agent_replied");
expect(firstSnapshot.conversation.chatState.aiParticipation).toBe("human_only");
expect(firstSnapshot.messages.filter((message) => message.author === "bot"))
  .toHaveLength(0);
```

Send the second ordinary visitor request and wait for its completed response frame. Assert:

```typescript
expect(secondSnapshot.conversation.status).toBe("active");
expect(secondSnapshot.conversation.chatState.aiParticipation).toBe("continuous");
expect(secondSnapshot.messages.filter((message) => message.author === "bot"))
  .toHaveLength(1);
expect(secondSnapshot.messages.filter((message) => message.author === "system"))
  .toHaveLength(0);
```

- [ ] **Step 2: Run the integration test and verify failure**

Run:

```bash
bun run test:agents -- worker/agents/maven/public/public-child.integration.test.ts
```

Expected result: the second message leaves the conversation in `agent_replied` with `human_only`, and no bot message exists.

- [ ] **Step 3: Wire the policy into `handlePublicChatMessage`**

Import `shouldResumeAiAfterHumanIdle` from `./public/public-turn`. After the second gate evaluation and archived check, but before the existing `human_mode` return, add:

```typescript
if (
  gate === "human_mode" &&
  !aiInvocation.invoked &&
  shouldResumeAiAfterHumanIdle({
    messages: this.readPublicMessages(),
    submittedMessageId: submitted.id,
    botName: settings?.botName,
    snoozedUntil: currentState.snoozedUntil,
  })
) {
  const handback = await this.transitionPublicOwnership(
    "ai_handed_back",
    currentState.revision,
  );
  if (handback.status === "active") {
    currentState = this.requirePublicState();
    currentChatState = this.parseStoredChatState(currentState);
    gate = evaluatePublicTurnGate({
      subscriptionActive,
      messageAllowed,
      banned: false,
      archived: currentState.archivedAt !== null,
      status: currentState.status,
      closeReason: currentState.closeReason,
      aiParticipation: currentChatState.aiParticipation,
      aiInvoked: false,
    });
  }
}
```

If the transition returns no active conversation, leave `gate` as `human_mode`. The existing block then forwards the second message to Telegram and returns 204.

Make `transitionPublicOwnership` compare the optional expected conversation
revision inside `runExclusivePublicMutation`. A concurrent human reply, snooze,
or other mutation must leave human ownership unchanged. Exclude
`agent_replied` from auto-close scheduling and callbacks.

- [ ] **Step 4: Run focused unit and Agent tests**

Run:

```bash
bun test worker/agents/maven/public/public-turn.test.ts
bun run test:agents -- worker/agents/maven/public/public-child.integration.test.ts
```

Expected result: both commands pass.

### Task 3: Verify the complete change

**Files:**
- Verify: `worker/agents/maven/public/public-turn.ts`
- Verify: `worker/agents/maven/maven-chat-agent.ts`
- Verify: `worker/agents/maven/public/public-turn.test.ts`
- Verify: `worker/agents/maven/public/public-child.integration.test.ts`

**Interfaces:**
- Consumes: the completed unit and runtime behavior from Tasks 1 and 2.
- Produces: passing repository validation with no unrelated file changes.

- [ ] **Step 1: Run all unit and contract tests**

```bash
bun test
```

Expected result: pass.

- [ ] **Step 2: Run all Agent integration tests**

```bash
bun run test:agents
```

Expected result: pass.

- [ ] **Step 3: Run lint**

```bash
bun run lint
```

Expected result: pass.

- [ ] **Step 4: Run a forced TypeScript build and production build**

```bash
bunx tsc -b --force
bun run build
```

Expected result: both commands pass.

- [ ] **Step 5: Review the final diff**

Confirm that the diff contains only the transcript policy, its runtime call, tests, and the approved design and plan documents. Do not commit or push without a separate user request.
