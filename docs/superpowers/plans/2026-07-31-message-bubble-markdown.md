# Message Bubble Markdown Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ReplyMaven's duplicated message parsers with a safe shared Marked adapter, preserve blank lines, and correct code styling in dashboard and widget bubbles.

**Architecture:** A synchronous `renderMarkdown(text: string): string` in `shared/chat-markdown.ts` configures the existing Marked dependency with GFM and visible soft breaks. A narrow renderer policy escapes raw HTML, allowlists link protocols, and suppresses inline images. Dashboard and widget consume the same function, while adaptive CSS styles inline and fenced code from inherited text color.

**Tech Stack:** TypeScript 5.8, Marked 18.0.3, Bun test runner, React 19 dashboard CSS, Vite IIFE widget build.

## Global Constraints

- Use Bun for every test and build command.
- Use function declarations or class methods for named functions.
- Keep Marked parsing synchronous because the widget rerenders during streaming.
- Allow link protocols only for `http:`, `https:`, `mailto:`, and `tel:`.
- Escape raw HTML and link attributes; do not render inline Markdown images.
- Do not change stored messages or backend chat behavior.
- Do not add syntax highlighting, borders, or separator elements.

---

### Task 1: Add the shared Marked adapter

**Files:**
- Create: `shared/chat-markdown.ts`
- Create: `shared/chat-markdown.test.ts`
- Modify: `src/lib/utils.ts:1-104`
- Modify: `widget/index.ts:15-20,3528-3653`

**Interfaces:**
- Produces: `renderMarkdown(text: string): string` from `shared/chat-markdown.ts`.
- Dashboard consumes it through the existing `@/lib/utils` export.
- Widget imports it directly from `../shared/chat-markdown`.

- [ ] **Step 1: Write the first failing paragraph test**

Create `src/lib/utils.test.ts` against the current public import:

```typescript
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./utils";

describe("renderMarkdown", () => {
  test("preserves a blank line as a paragraph boundary", () => {
    expect(renderMarkdown("line one\n\nline two")).toBe(
      "<p>line one</p>\n<p>line two</p>\n",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
bun test src/lib/utils.test.ts
```

Expected: FAIL. The current renderer returns `<p>line one<br>line two</p>`.

- [ ] **Step 3: Add the minimal Marked-backed renderer**

Create the initial `shared/chat-markdown.ts`:

```typescript
import { Marked } from "marked";

const messageMarkdown = new Marked();
messageMarkdown.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(text: string): string {
  return messageMarkdown.parse(text, { async: false });
}
```

Replace the renderer in `src/lib/utils.ts` with a re-export, leaving `cn` unchanged:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { renderMarkdown } from "../../shared/chat-markdown";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run the paragraph test and verify GREEN**

```bash
bun test src/lib/utils.test.ts
```

Expected: one test passes.

- [ ] **Step 5: Add failing behavior and safety tests**

Expand `src/lib/utils.test.ts` with these tests inside the existing `describe`:

```typescript
test("keeps a single newline inside one paragraph", () => {
  expect(renderMarkdown("line one\nline two")).toBe(
    "<p>line one<br>line two</p>\n",
  );
});

test("renders inline and fenced code semantically", () => {
  expect(renderMarkdown("Use `@` or `www`.")).toBe(
    "<p>Use <code>@</code> or <code>www</code>.</p>\n",
  );
  expect(renderMarkdown("```txt\n  indented\n```")).toBe(
    '<pre><code class="language-txt">  indented\n</code></pre>\n',
  );
});

test("keeps safe Markdown links and bare URLs", () => {
  expect(renderMarkdown("[Docs](https://example.com?a=1&b=2)")).toBe(
    '<p><a href="https://example.com?a=1&amp;b=2" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">Docs</a></p>\n',
  );
  expect(renderMarkdown("https://example.com")).toBe(
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">https://example.com</a></p>\n',
  );
});

test("escapes raw HTML", () => {
  expect(renderMarkdown("<script>alert('x')</script>")).toBe(
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;",
  );
});

test("does not emit anchors for unsafe protocols", () => {
  expect(renderMarkdown("[bad](javascript:alert(1))")).toBe("<p>bad</p>\n");
  expect(renderMarkdown("[bad](data:text/html,boom)")).toBe("<p>bad</p>\n");
});

test("renders inline Markdown images as escaped alt text", () => {
  expect(renderMarkdown("![<logo>](https://example.com/logo.svg)")).toBe(
    "<p>&lt;logo&gt;</p>\n",
  );
});
```

- [ ] **Step 6: Run the expanded test and verify the safety cases fail**

```bash
bun test src/lib/utils.test.ts
```

Expected: raw HTML, unsafe links, link attributes, target/rel attributes, and inline-image assertions fail against default Marked output. Paragraph, soft-break, and code assertions pass.

- [ ] **Step 7: Implement the safe renderer policy**

Replace `shared/chat-markdown.ts` with:

```typescript
import { Marked, Renderer, type Tokens } from "marked";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const URL_BASE = "https://replymaven.invalid";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeLink(href: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href, URL_BASE).protocol);
  } catch {
    return false;
  }
}

class MessageMarkdownRenderer extends Renderer {
  override html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }

  override link({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    if (!isSafeLink(href)) return text;

    const titleAttribute = title
      ? ` title="${escapeHtml(title)}"`
      : "";
    return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">${text}</a>`;
  }

  override image({ text }: Tokens.Image): string {
    return escapeHtml(text);
  }
}

const messageMarkdown = new Marked();
messageMarkdown.setOptions({
  breaks: true,
  gfm: true,
  renderer: new MessageMarkdownRenderer(),
});

export function renderMarkdown(text: string): string {
  return messageMarkdown.parse(text, { async: false });
}
```

- [ ] **Step 8: Run the focused test and verify GREEN**

```bash
bun test src/lib/utils.test.ts
```

Expected: all seven tests pass.

- [ ] **Step 9: Move the test to the shared boundary**

Move the final test file to `shared/chat-markdown.test.ts` and change only its import:

```typescript
import { renderMarkdown } from "./chat-markdown";
```

Run:

```bash
bun test shared/chat-markdown.test.ts
```

Expected: all seven tests still pass.

- [ ] **Step 10: Switch the widget to the shared renderer**

Add this import in `widget/index.ts`:

```typescript
import { renderMarkdown } from "../shared/chat-markdown";
```

Delete the complete local `renderMarkdown` declaration at the current `widget/index.ts:3528-3653`. Keep every existing call site unchanged.

- [ ] **Step 11: Verify consumers and record bundle impact**

```bash
bun run build
bun run widget:build
gzip -c dist-widget/widget-embed.js | wc -c
```

Expected: both builds exit 0. Record the new gzip byte count beside the 32,444-byte baseline.

- [ ] **Step 12: Commit the shared renderer**

```bash
git add shared/chat-markdown.ts shared/chat-markdown.test.ts src/lib/utils.ts widget/index.ts public/widget-embed.js
git commit -m "fix: share safe message markdown rendering"
```

---

### Task 2: Style inline and fenced code adaptively

**Files:**
- Modify: `src/index.css:166-172`
- Modify: `widget/index.ts:1833-1839`

**Interfaces:**
- Consumes: Marked's `<code>` and `<pre><code>` output.
- Produces: adaptive code surfaces derived from each bubble's inherited text color.

- [ ] **Step 1: Record the current visual failure**

Use this message in both surfaces:

````text
`@` → `168.220.87.211`

Make sure there isn't a CNAME record for either `@` or `www`.

```txt
server 168.220.87.211
```
````

The supplied CleanShot is the failing dashboard baseline: inline code reads as unrelated dark blocks and the blank line is missing.

- [ ] **Step 2: Update dashboard code styling**

Replace `.prose-chat code` with:

```css
.prose-chat :not(pre) > code {
  background: color-mix(in srgb, currentColor 12%, transparent);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}
.prose-chat pre {
  max-width: 100%;
  margin: 4px 0 6px;
  overflow-x: auto;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  padding: 9px 11px;
}
.prose-chat pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.9em;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  white-space: pre;
  overflow-wrap: normal;
}
```

- [ ] **Step 3: Update widget code styling**

Replace `.rm-message code` with the equivalent widget selectors:

```css
.rm-message :not(pre) > code {
  background: color-mix(in srgb, currentColor 12%, transparent);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}
.rm-message pre {
  max-width: 100%;
  margin: 4px 0 8px;
  overflow-x: auto;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  padding: 9px 11px;
}
.rm-message pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  white-space: pre;
  overflow-wrap: normal;
}
```

- [ ] **Step 4: Build both clients**

```bash
bun run build
bun run widget:build
```

Expected: both builds exit 0 with no TypeScript or Vite errors.

- [ ] **Step 5: Visually verify both bubble contexts**

Inspect the baseline message in a blue dashboard sent bubble, neutral dashboard received bubble, blue widget visitor bubble, and neutral widget bot bubble. Verify paragraph spacing, readable inline chips, contained scrolling fenced blocks, and the absence of borders or separators.

- [ ] **Step 6: Commit code styling**

```bash
git add src/index.css widget/index.ts public/widget-embed.js
git commit -m "fix: style message code for bubble context"
```

---

### Task 3: Run full regression verification

**Files:**
- Verify only; no planned source edits.

**Interfaces:**
- Consumes: the shared Marked adapter and adaptive code CSS.
- Produces: fresh test, lint, build, bundle-size, and diff evidence.

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: zero failures.

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: ESLint exits 0 with no errors.

- [ ] **Step 3: Run both production builds**

```bash
bun run build
bun run widget:build
```

Expected: both commands exit 0.

- [ ] **Step 4: Measure the final widget and inspect the diff**

```bash
gzip -c dist-widget/widget-embed.js | wc -c
git diff main...HEAD --check
git status --short
```

Expected: record the final gzip byte count, no whitespace errors, and no uncommitted implementation files.
