# Remove Self-Updating Docs Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every trace of the "self-updating docs" story (Maven suggesting changes/drafts to docs, FAQs, help articles from conversations) from the landing page.

**Architecture:** Exploration confirmed the feature exists **only as marketing** in `src/pages/Landing.tsx` — there is no backend, schema, widget, or dashboard code implementing conversation-driven doc/FAQ change suggestions. Four surfaces in that one file carry the story: the hero subtitle clause, a landing FAQ entry, the `ArticleGenMock` diff mock (with its `ARTICLE_DIFF` data), and the `3.0 — Self-updating` ValueSection. Removing the 3.0 section leaves a numbering gap, so `4.0 — AI-native` renumbers to `3.0` (index items `4.1`–`4.4` → `3.1`–`3.4`).

**Tech Stack:** React 19 SPA · Tailwind v4 · Vite · Bun

## Global Constraints

- Per CLAUDE.md: never commit or push unless the user explicitly asks, each time — tasks end at "verify green".
- Bun only: `bunx tsc -b`, `bun run lint`, `bun run build`.
- Lint baseline: 14 pre-existing problems, none in `src/pages/Landing.tsx` — the file must stay lint-clean.
- Keep the `FileText` and `ChevronRight` imports in `Landing.tsx` — both are used outside the removed code (lines 294, 540, 831).
- Keep the `Window` and `Mono` primitives — used by the other section mocks.

## Out of Scope (explicitly kept — separate live features, not the self-updating loop)

- FAQ editor "Suggest description" assist: `src/components/faq-editor.tsx`, route `/api/projects/:id/faq-description-suggestion` (`worker/index.ts:5038`), `aiService.suggestFaqDescription`.
- FAQ generation from sources: `src/components/faq-generate-modal.tsx`, `aiService.generateFaqFromSources`, `aiService.splitFaqIntoBuckets`.
- Bot prompt lines about not giving undocumented suggestions (`worker/chat-runtime/prompt/*`) — chat-safety copy, unrelated.

---

### Task 1: Strip the self-updating story from Landing.tsx

**Files:**
- Modify: `src/pages/Landing.tsx:55-59,367-454,837,930-942,944-956`

**Interfaces:**
- Consumes: nothing.
- Produces: `Landing.tsx` with three ValueSections numbered 1.0/2.0/3.0 and five FAQ items; `ArticleGenMock` and `ARTICLE_DIFF` deleted.

- [x] **Step 1: Remove the landing FAQ entry**

In `src/pages/Landing.tsx` (lines 55–59), delete this object from `faqItems`:

```tsx
  {
    question: "What does 'keeps itself up to date' mean?",
    answer:
      "Every resolved conversation is a signal. Maven detects gaps in your help center and drafts new articles from real tickets, so your documentation stays current without anyone maintaining it. You review and publish in one click.",
  },
```

- [x] **Step 2: Remove `ARTICLE_DIFF` and `ArticleGenMock`**

Delete lines 367–454 in full — the section comment, the data const, and the component:

```tsx
// ─── Section mock: Auto article generation ────────────────────────────────────

const ARTICLE_DIFF: { type: "ctx" | "del" | "add"; text: string }[] = [
  ...
];

function ArticleGenMock() {
  ...
}
```

(The block starts at the `// ─── Section mock: Auto article generation ─...` comment and ends at the `}` closing `ArticleGenMock`, immediately before the next section-mock comment.)

- [x] **Step 3: Rewrite the hero subtitle**

Line 837, change:

```tsx
            Delightful software for human support, an AI agent that actually resolves tickets, and a help desk that keeps itself up to date. Built for teams who'd rather ship.
```

to:

```tsx
            Delightful software for human support and an AI agent that actually resolves tickets. Built for teams who'd rather ship.
```

- [x] **Step 4: Remove the `3.0 — Self-updating` ValueSection**

Delete lines 930–942:

```tsx
        <ValueSection
          num="3.0 — Self-updating"
          title={<>A help desk that<br className="hidden sm:block" /> keeps itself up to date</>}
          body="Every resolved ticket is a signal. Maven spots gaps and drafts new help articles from real conversations, so your knowledge base stays current without anyone maintaining it."
          index={[
            { n: "3.1", label: "Auto-drafted articles" },
            { n: "3.2", label: "Gap detection" },
            { n: "3.3", label: "One-click publish" },
            { n: "3.4", label: "Always current" },
          ]}
        >
          <ArticleGenMock />
        </ValueSection>
```

- [x] **Step 5: Renumber the AI-native section from 4.0 to 3.0**

In the (formerly line 944) `ValueSection`, change:

```tsx
          num="4.0 — AI-native"
```
to
```tsx
          num="3.0 — AI-native"
```

and its index items:

```tsx
            { n: "4.1", label: "Native MCP server" },
            { n: "4.2", label: "Typed tool calls" },
            { n: "4.3", label: "Scoped access" },
            { n: "4.4", label: "Agent-to-agent" },
```
to
```tsx
            { n: "3.1", label: "Native MCP server" },
            { n: "3.2", label: "Typed tool calls" },
            { n: "3.3", label: "Scoped access" },
            { n: "3.4", label: "Agent-to-agent" },
```

- [x] **Step 6: Verify**

Run: `grep -n -i "self-updat\|keeps itself\|ArticleGenMock\|ARTICLE_DIFF\|spots gaps\|stays current\|Auto-drafted\|Gap detection" src/pages/Landing.tsx`
Expected: no matches.

Run: `bunx tsc -b`
Expected: exit 0.

Run: `bunx eslint src/pages/Landing.tsx`
Expected: no problems (file was clean before; unused-import regressions would surface here).

Run: `bun run build`
Expected: `tsc -b` + `vite build` succeed.

---

## Notes

- No tests exist for `Landing.tsx`; typecheck + lint + build is the verification surface, plus optional visual check of `/` in dev.
- No worker, widget, schema, or API changes — nothing to deploy beyond the SPA that ships with the worker deploy.
