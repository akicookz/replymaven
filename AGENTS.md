# AGENTS.md - ReplyMaven

This file is the operating guide for agents/contributors working in this repo.

## How to respond

Write in plain, everyday language. The target is ASD-STE100 Simplified Technical English: one word one meaning, short sentences, active voice. Use a technical term only when there is no simpler way, then define it in passing. Don't try to sound smart.

Be concise and conversational. Give the precise answer and nothing around it.

Don't:

- Open with a setup phrase ("here's the thing", "straight version", "the fact is", "plain version").
- Narrate what you are doing, or comment on what you got wrong. Fix it instead of describing the fix.
- Restate the question back.
- Write ad copy, essay framing, or exaggerations.
- Use em-dashes for effect. Split the sentence, or use a comma, colon, or semicolon.

If a sentence is not carrying information, cut it. Short and plain beats clever.

This is about how you write, not how much you do. Still finish the whole task, and still say plainly when something failed or was skipped.

## Trace it end to end before you touch it

Never work from a single grep hit. Before changing or explaining anything, follow the whole path the request or the data actually takes, in order, and read the real files.

For a feature in this repo that usually means:

1. The page or component that triggers it (`src/pages/`, `src/components/`).
2. The hook or client helper it calls (`src/hooks/`, `src/lib/`).
3. The `fetch("/api/...")` call and the route it maps to.
4. Where that route is mounted in `worker/index.ts`, and every middleware in front of it.
5. The handler in `worker/routes/*.ts` or `worker/index.ts`, then each `worker/services/*.ts` and `worker/chat-runtime/*` function it calls.
6. The Drizzle schema and the actual columns it reads or writes. For conversation data, the owning Agent's SQLite and its RPC methods.
7. The response shape coming back, and every other place that reads it.

Work that does not end at the handler keeps going. If the route writes to a Durable Object, schedules an Agent callback, or enqueues work, find the consumer and read that too. If a value is cached in KV or stored in R2, find where it is written and where it is invalidated. The widget is a separate bundle: a worker change that alters a widget contract is not finished until the widget side is traced too.

Also check who else touches what you are about to change. Search for every call site, not the first one.

Read whole files, not the matched lines. Half-read context is where the bugs come from: the problem is almost always in a small detail that looked irrelevant or sat just outside the part you bothered to read. If you are not sure how something works, keep reading until you are. This includes third-party behavior: read the installed package in `node_modules` rather than assuming what an SDK does. Do not guess, and do not fill the gap with a plausible story.

## Product Overview

ReplyMaven (replymaven.com) is a multi-tenant AI-powered customer support chatbot platform built on Cloudflare Workers. Users sign up, create a project/bot, customize its appearance and behavior, add knowledge resources (web pages, PDFs, FAQs), and embed a lightweight chat widget on their website. The bot uses configurable AI models (Google Gemini 3 Flash or OpenAI GPT-5, controlled via the `AI_MODEL` env var) for AI responses, Cloudflare AI Search for RAG over user-uploaded resources, and supports live agent handoff over Telegram or Slack when the bot cannot confidently answer. Users can set the bot name once (e.g. "Luna") and configure a human agent label (e.g. "an engineer") for personalized handoff messages. Agents interact with the bot via `@BotName` commands in Telegram, Slack, the dashboard composer, or MCP to hand back control, close conversations, instruct the bot to respond directly, or start a private Sidechat investigate turn. MCP also exposes `ask_maven` and `get_sidechat_status`. A command is never stored as a visitor-visible agent row. Handing the thread to AI assigns Maven and writes a dashboard system pill.

### Core Features

- **Embeddable chat widget** -- standalone JS embed script (`<script>` tag) that users install on their pages. Supports programmatic invocation (`open`, `close`, `toggle`, `sendMessage`, `identify`, `setPageContext`, `setMetadata`, `requestNotifications`, `openInquiryForm`). Talks native Agent chat over a WebSocket to the conversation's `MavenChatAgent` child. Automatically sends current page URL and title as context with each message.
- **Dashboard** -- React SPA where users configure their bot, manage resources, review conversations, and customize the widget's look and feel.
- **Resource management** -- users add web pages, FAQs, and PDFs as knowledge sources. These are stored in R2 and indexed via Cloudflare AI Search for RAG retrieval.
- **Tone of voice** -- configurable AI personality (professional, friendly, casual, formal, or custom prompt).
- **Quick actions and quick topics** -- configurable buttons and topic suggestions shown above the chat input.
- **Intro message** -- the first bot message visitors see when they open the widget.
- **Live agent handoff** -- when the bot cannot answer or the visitor requests a human, one escalation fans out to every connected Telegram/Slack channel and every accepted project member with access. Maven keeps helping while review is pending. A channel or member email joins the conversation when a human first replies there. After that, visitor messages go only to the joined external clients. Dashboard and MCP replies do not create push routes. Agents use `@BotName` commands (Telegram, Slack, dashboard, or MCP) to hand back to AI (with optional instructions), close conversations, instruct the bot to respond immediately, or start a Sidechat investigate turn. `ask_maven` starts that investigate turn from MCP. The inbox Assign menu includes Maven; picking it hands the thread back. Idle takeover after four quiet hours also assigns Maven. New bookings, conversations, and contact form submissions also notify enabled messengers when configured.
- **Canned response auto-drafting** -- after a conversation ends, the AI analyzes it and generates draft canned responses. Users approve or reject drafts from the dashboard.
- **Customer continuity** -- anonymous widget visitor IDs can be connected to project-scoped customer profiles. Signed server-issued tokens keep exact visitor history together across devices without trusting browser-supplied email.

### Conversation runtime

There is one conversation runtime, built on Cloudflare Agents. One `MavenProjectAgent` per project owns the child registry, shared project tools/MCP, and an indexed conversation directory that serves the dashboard inbox in a single query. Each public transcript (`pub_<conversationId>`) and each private Sidechat (`sc_<conversationId>`) is an isolated child instance of the shared `MavenChatAgent` class; every transcript lives in its child Agent's SQLite, and every public mutation is serialized by its child. The widget and dashboard both use native Agent chat sessions. Retention deletes child Agents and conversation-scoped R2 attachments. D1 keeps product/business data only; the frozen legacy `conversations`/`messages` tables remain solely as the one-time import source (`worker/conversations/legacy-conversation-reader.ts` plus the backfill admin endpoints) until the final cleanup migration drops them.

Sidechat exposes a fixed provider-neutral tool set. `search_knowledge`, `list_knowledge`, `read_knowledge`, `apply_knowledge_change`, and `present_reply_draft` are direct first-party tools. Knowledge writes pause on a Sidechat change card (computed diff plus Approve / Reject). External MCP and custom HTTP tools use `search_project_tools`, `describe_project_tool`, and `call_project_tool`. Raw external schemas stay inside `MavenProjectAgent`; the model receives bounded summaries and argument guides. A versioned `toolRef` binds each call and approval to the exact connection, tool, catalog fingerprint, safety, and access policy. Manual-write arguments are encrypted in the project Agent until the exact approved call consumes them once; only redacted arguments enter the private transcript.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime / Package Manager | **Bun** (never npm/yarn) |
| Frontend Framework | **React 19** SPA |
| Routing | **React Router DOM 7** |
| Data Fetching | **TanStack React Query** |
| Build Tool | **Vite** + `@vitejs/plugin-react-swc` + `@cloudflare/vite-plugin` |
| Styling | **Tailwind CSS v4** + `@tailwindcss/vite` |
| UI Components | **shadcn/ui** (new-york style, stone base color) + Radix UI primitives |
| Icons | **Lucide React** |
| Backend Framework | **Hono** on Cloudflare Workers |
| Database | **Cloudflare D1** (SQLite) via **Drizzle ORM** |
| Cache | **Cloudflare KV** (active conversation cache) |
| File Storage | **Cloudflare R2** (PDFs, uploads, widget bundle) |
| RAG | **Cloudflare AI Search** (managed indexing + search) |
| AI Model | **Google Gemini 3 Flash** or **OpenAI GPT-5** (configurable via `AI_MODEL` env var, server-side, streamed over the Agent WebSocket) |
| Auth | **Better Auth** + `better-auth-cloudflare` (Google/GitHub OAuth) |
| Validation | **Zod** |
| Email | **Resend** |

---

## Quick Context

- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Hono Worker + D1 + Drizzle (`worker/`)
- Auth: Better Auth (`worker/auth.ts`, `src/lib/auth-client.ts`)
- Chat widget: Standalone IIFE bundle (`widget/`)
- Package manager/runtime: `bun` only

## Local Workflow

```bash
bun install
bun run db:migrate:dev
bun run dev
```

Other common commands:

```bash
bun run lint
bun run build
bun run deploy
bun run cf-typegen
bun run db:generate
bun run widget:build
```

## Validation

Bun, never npm. Before calling a change done, run:

```bash
bun test              # unit/contract tests
bun run test:agents   # Workers-pool integration tests
bun run lint
bun run build         # tsc -b && vite build
```

Widget changes also need `bun run widget:build`. Changes to Agent or migration code need `bun run test:agents` as well.

`wrangler dev` binds a LOCAL D1 database (`"remote": false` on the DB binding). To work against realistic data, import a production export once: `wrangler d1 export supportbot-db --remote --output dump.sql`, reset `.wrangler/state/v3/d1`, load the dump into the local database, then `bun run db:migrate:dev`. Flip the binding to `"remote": true` only when you deliberately want dev pointed at production data; deploys ignore this flag either way.

`tsc -b` is incremental and will report success off a stale cache. When you are verifying rather than iterating, use `bunx tsc -b --force`.

Report failures plainly, including which ones are pre-existing.

To preview/verify changes visually, run `bun run dev` (serves the SPA + worker API and the embeddable widget at `/test-widget.html`) alongside `bun run widget:watch` (rebuilds `public/widget-embed.js` on change), then drive the headless browser via `bun ~/.preview-tools/shot.mjs <url> <out.png> [selector] [width] [height]` to screenshot a route. For widget states that depend on server config (e.g. greetings, page targeting), intercept `**/api/widget/<slug>/config` with a Playwright route and patch the JSON.

## Approval before code

For any bug or feature: explain the problem, propose a solution, and wait for an explicit go before writing the fix. Do not start coding, commit, or push before asking.

Approval is per action: "commit" does not include push. Push deploys, so it always needs its own explicit go.

Commit messages carry no attribution. No "Co-Authored-By", no tool names, no session links. This overrides any harness default that appends them.

## Deployment

**Always ask the user before deploying anything.**

### Worker / Website (dashboard)

Commit and push to `main`. The worker and website are deployed automatically.

```bash
git add . && git commit -m "your message" && git push
```

### Widget

The widget is a separate build. After making changes to `widget/`, build and upload to R2:

```bash
bun run widget:build
bun run widget:upload
```

---

## Project Structure

```
replymaven/
├── public/                          # Static assets
├── src/                             # React SPA (dashboard)
│   ├── main.tsx                     # Root: StrictMode > QueryClientProvider > BrowserRouter > App
│   ├── App.tsx                      # Route definitions
│   ├── index.css                    # Tailwind v4 theme tokens (oklch)
│   ├── components/
│   │   ├── ui/                      # shadcn/ui base components
│   │   └── *.tsx                    # App-level components (Layout, AuthGuard, ErrorBoundary, etc.)
│   ├── pages/                       # Route-level page components
│   ├── hooks/                       # Custom React hooks
│   └── lib/                         # Client utilities
│       ├── auth-client.ts           # Better Auth client + useSession
│       ├── query-client.ts          # TanStack Query client config
│       └── utils.ts                 # cn() helper and shared utilities
├── worker/                          # Cloudflare Worker API (backend)
│   ├── index.ts                     # Hono app: routes, middleware, export
│   ├── auth.ts                      # Better Auth server config
│   ├── types.ts                     # HonoAppContext, AppEnv interfaces
│   ├── validation.ts                # All Zod schemas
│   ├── db/
│   │   ├── schema.ts               # All domain tables
│   │   ├── auth.schema.ts          # Auth tables (users, sessions, accounts, verifications)
│   │   ├── index.ts                # Re-exports all schemas
│   │   └── drizzle/                # SQL migration files
│   └── services/                    # Domain service classes
│       ├── project-service.ts
│       ├── resource-service.ts
│       ├── widget-service.ts
│       ├── telegram-service.ts
│       ├── canned-response-service.ts
│       ├── ai-service.ts
│       ├── email-service.ts
│       └── dashboard-service.ts
├── widget/                          # Chat widget (separate build)
│   ├── index.ts                     # Widget loader/entry point (IIFE)
│   ├── widget.ts                    # Widget UI logic
│   ├── styles.css                   # Widget styles (scoped)
│   └── vite.config.ts              # Separate Vite build -> single JS file
├── wrangler.jsonc                   # Cloudflare bindings: D1, R2, KV, AI
├── vite.config.ts                   # Main Vite config (React SPA + Cloudflare)
├── drizzle.config.ts                # Drizzle Kit config (local D1 SQLite)
├── tsconfig.json                    # Project references root
├── tsconfig.app.json                # Frontend TypeScript config
├── tsconfig.node.json               # Vite/Node TypeScript config
├── tsconfig.worker.json             # Worker TypeScript config (extends node)
├── components.json                  # shadcn/ui config
├── eslint.config.js                 # Flat ESLint config
├── package.json
├── worker-configuration.d.ts        # Auto-generated Cloudflare env types
└── AGENTS.md                        # This file
```

---

## Codebase Map

- `src/App.tsx` -- app routes (dashboard under `/app`, public widget config endpoints)
- `src/components/` -- reusable app components
- `src/components/ui/` -- shadcn/ui base components
- `src/pages/` -- route-level screens
- `src/lib/` -- client utilities (query client, auth client, helpers)
- `worker/index.ts` -- API routes, middleware, bindings usage
- `worker/services/` -- business logic layer (one class per domain)
- `worker/db/` -- Drizzle schemas + SQL migrations
- `widget/` -- standalone embeddable chat widget
- `wrangler.jsonc` -- worker bindings/env configuration

---

## Non-Negotiable Conventions

### Runtime and tooling

- Use `bun` for all scripts/package operations
- Do not use `npm` or `yarn`
- Keep Cloudflare Worker compatibility in mind for all backend code

### Function style

- Use **function declarations** for all named functions and React components
- Arrow functions are **only** allowed for inline callbacks (`.map((x) => ...)`, event handlers)
- `export default` for page components and layout components
- Named exports for service classes, schemas, and utilities

### Imports and modules

- Use `@/` alias for imports from `src/`
- Keep import order consistent:
  1. React (`import { useState } from "react"`)
  2. Third-party (`react-router-dom`, `@tanstack/react-query`, `hono`, `drizzle-orm`, `lucide-react`)
  3. Internal alias `@/components/ui/*` then `@/components/*` then `@/lib/*`
  4. Relative imports
- Use `import type` for type-only imports (e.g., `import { type HonoAppContext } from "./types"`)

### Don't reach for `shared/` by default

`shared/` is for code that genuinely needs to run in **both** the browser bundle and the worker. It is not a default home for "reusable" constants or helpers, and moving something there is not an automatic improvement.

- A single constant or small helper used on one side belongs in that side's module (a worker constant in the relevant `worker/` file, a frontend one in the component or `src/lib/*.ts` that owns it). Export it from there if a sibling needs it.
- A value used on both sides may still be better as **two local definitions** than one shared module, especially a trivial literal. Cross-bundle imports pull worker-only dependencies (drizzle, `AppEnv`, Cloudflare types) toward the browser and the widget bundle, so don't import worker modules from `src/` or `widget/` just to dedupe a number.
- Only promote to `shared/` once the duplication is genuinely getting out of hand: the same non-trivial logic is maintained in multiple places and drifting, or correctness depends on both sides agreeing. A one-line constant duplicated in two files does not meet that bar.

When in doubt, keep it local and let it duplicate. Consolidate later when the cost of drift is real.

### No nested ternaries

For 3+ branches, extract a small helper with `if`/`else if`/`return`, use a lookup map (`{ foo: "Foo", bar: "Bar" }[key] ?? "default"`), or, for JSX, split into mutually exclusive `{cond && <X/>}` sibling guards. Use explicit boolean conditions so `0` and `""` don't render literally. Prefer `??` over `||` for fallbacks so falsy-but-valid values (`0`, `""`, `false`) survive.

### TypeScript

- Keep strict typing everywhere; avoid `any`
- Prefer `interface` for object shapes and `type` for unions/compositions and Drizzle row types
- Add explicit types for API responses and service inputs/outputs
- `verbatimModuleSyntax: true` enforced across all tsconfigs

### Naming conventions

- **PascalCase**: Components, types, interfaces, service classes (`ProjectService`, `AuthGuard`, `ChatService`)
- **camelCase**: Variables, functions
- **kebab-case**: UI component files (`app-sidebar.tsx`), service files (`project-service.ts`), hook files (`use-mobile.ts`)
- **PascalCase filenames**: Page components (`Dashboard.tsx`, `Conversations.tsx`)

### UI/component workflow

1. Check shadcn/ui availability first
2. Reuse existing components in `src/components/` next
3. Create custom component only if no reusable option exists

### UI verification

- Do not add mocked DOM/component tests for visual styling, layout, focus, scrolling, or interaction behavior. These tests have repeatedly passed while the real dashboard was broken.
- Verify UI changes in the real authenticated browser at the affected route and viewport. Exercise the actual interaction and inspect the rendered result.
- Keep pure state/protocol tests and backend/security tests only when they prove a real contract independently of component markup or CSS classes.

### Styling

- Tailwind CSS v4 tokens from `src/index.css`
- Use semantic color tokens (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, etc.)
- Keep glassmorphism style consistent: `bg-card/50 backdrop-blur-xl`, `rounded-2xl`, subtle borders/shadows
- oklch color space for all color definitions
- Base radius: `1.25rem`
- Fonts: `Satoshi` (sans), `Playfair Display` (heading)
- Dark mode via `.dark` class variant
- Ensure keyboard accessibility, ARIA usage, and color contrast
- **Never use borders as visual separators** -- no `border-t`, `border-b`, `<hr>`, horizontal rules, or separator elements for dividing sections or list rows. Use spacing (`space-y-*`, `gap-*`, `py-*`) and background color contrast (`bg-muted/50` cards) for visual separation instead. Container borders on cards (`border border-border` on the outer card) are acceptable only sparingly, but row-separator borders within lists/tables are never allowed.

### Routing and data fetching

- Use `react-router-dom` route patterns in `src/App.tsx`
- Use `@tanstack/react-query` for async data access
- Route all API requests through `/api/*` endpoints in the worker
- All API calls via `fetch("/api/...")` inside `useQuery`/`useMutation`

---

## Backend Patterns

### Hono app structure

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { except } from "hono/combine";
import { drizzle } from "drizzle-orm/d1";
import { type HonoAppContext, type AppEnv } from "./types";

const app = new Hono<HonoAppContext>()
  // 1. Global CORS
  .use("*", cors())
  // 2. Auth-specific CORS with credentials
  .use("/api/auth/*", cors({
    origin: (origin) => origin || "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    credentials: true,
  }))
  // 3. Better Auth handler
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    const auth = createAuth(c.env, c.req.raw.cf);
    return auth.handler(c.req.raw);
  })
  // 4. Static SPA fallback for non-API routes
  .use("*", except(["/api/*"], async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
  }))
  // 5. Public endpoints (no auth)
  // 6. Session middleware (sets user, session, db on context)
  // 7. Protected endpoints
```

### Service layer pattern

```typescript
import { type DrizzleD1Database } from "drizzle-orm/d1";

export class FooService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  async getFooById(id: string): Promise<FooRow | null> {
    const rows = await this.db
      .select()
      .from(foos)
      .where(eq(foos.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createFoo(data: Omit<NewFooRow, "id" | "createdAt" | "updatedAt">): Promise<FooRow> {
    const id = crypto.randomUUID();
    await this.db.insert(foos).values({ id, ...data });
    return (await this.getFooById(id))!;
  }
}
```

Services are instantiated per-request inside route handlers:

```typescript
.get("/api/foos", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const service = new FooService(db);
  const foos = await service.getFoosByUserId(user.id);
  return c.json(foos);
})
```

### Validation pattern

All Zod schemas live in `worker/validation.ts` with section comment dividers:

```typescript
import { z } from "zod";

// ─── Projects ─────────────────────────────────────────────────────────────────
export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  domain: z.string().max(255).optional(),
});
```

Validated via a generic helper:

```typescript
function validate<T>(schema, data): { success: true; data: T } | { success: false; error: string }
```

### Rate limiting

In-memory per-isolate rate limiter using `Map<string, { count: number; resetAt: number }>`:

```typescript
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}
```

### Section comment style

Use box-drawing dividers throughout backend code:

```typescript
// ─── Section Name ─────────────────────────────────────────────────────────────
```

---

## Database Patterns (Drizzle + D1)

### Table definition style

```typescript
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const foos = sqliteTable(
  "foos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authSchema.users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_foos_user").on(table.userId),
  ],
);

export type FooRow = typeof foos.$inferSelect;
export type NewFooRow = typeof foos.$inferInsert;
```

### Key conventions

- `text("id").primaryKey()` with `crypto.randomUUID()` for ID generation
- `integer("col", { mode: "timestamp" })` with `.default(sql\`(unixepoch())\`)` for timestamps
- `.$onUpdate(() => new Date())` on all `updatedAt` columns
- Type exports after each table: `FooRow` (select) and `NewFooRow` (insert)
- Cascade deletes on parent foreign key references
- Separate files: `auth.schema.ts` for auth tables, `schema.ts` for domain tables
- Indexes defined in the third argument to `sqliteTable` as an array

### D1 migration flow

```bash
bun run db:generate        # Generate migration SQL from schema changes
bun run db:migrate:dev     # Apply migrations locally
bun run db:migrate:prod    # Apply migrations to remote D1
```

Only edit the Drizzle schema files, then run `bun run db:generate`. Never hand-write a SQL migration file and never edit `meta/_journal.json` by hand. After changing the schema, check that the generated SQL covers every change you made: a column added to `schema.ts` without a matching migration fails only at runtime, in production.

---

## Frontend Patterns

### Entry point (`main.tsx`)

```tsx
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
```

### Route structure (`App.tsx`)

- Public routes at top level (`/`, `/login`, `/signup`)
- Protected dashboard routes nested under `/app` wrapped in `ErrorBoundary > AuthGuard > Layout`
- Layout component renders `<Outlet />` for nested child routes

### Auth guard

```tsx
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

### Query client config

- 5-minute stale time, 30-minute GC time
- Smart retry: no retry on 4xx except 429 (rate limit)
- `refetchOnWindowFocus: false`
- `refetchOnMount: true`, `refetchOnReconnect: true`

### Page component pattern

```tsx
interface FooData {
  // typed response shape
}

function FooPage() {
  const { data, isLoading } = useQuery<FooData>({
    queryKey: ["foo"],
    queryFn: async () => {
      const res = await fetch("/api/foo");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      {/* page content using shadcn/ui components */}
    </div>
  );
}

export default FooPage;
```

---

## Database Schema

### Auth Tables (Better Auth managed)

- `users` -- id, name, email, emailVerified, image, timestamps
- `sessions` -- id, token, userId, ipAddress, userAgent, geo fields
- `accounts` -- OAuth provider accounts (Google, GitHub)
- `verifications` -- magic link tokens

### Domain Tables

```
projects
  id, userId (FK users), name, slug (unique per user), domain, createdAt, updatedAt

project_settings
  id, projectId (FK projects), geminiApiKey (encrypted), aiSearchInstanceName,
  telegramBotToken (encrypted), telegramChatId, companyName, companyUrl,
  industry, companyContext, botName, agentName, toneOfVoice, customTonePrompt,
  introMessage, showIntroBubble (boolean), autoCannedDraft (boolean),
  createdAt, updatedAt

widget_config
  id, projectId (FK projects), primaryColor, backgroundColor, textColor,
  headerText, avatarUrl, position, borderRadius, fontFamily, customCss,
  createdAt, updatedAt

quick_actions
  id, projectId (FK projects), label, action, icon, sortOrder

quick_topics
  id, projectId (FK projects), label, prompt, sortOrder

resources
  id, projectId (FK projects), type (webpage|pdf|faq), title, url, r2Key,
  content, status (pending|indexed|failed), lastIndexedAt, createdAt, updatedAt

conversations
  id, projectId (FK projects), customerId (nullable FK customers), visitorId, visitorName, visitorEmail,
  status (active|waiting_agent|agent_replied|closed), telegramThreadId
  (populated on handoff/new-convo Telegram notification for reply threading),
  metadata (JSON -- geo data, device info, agentHandbackInstructions),
  createdAt, updatedAt

messages
  id, conversationId (FK conversations), role (visitor|bot|agent),
  content, sources (JSON), createdAt

canned_responses
  id, projectId (FK projects), trigger, response,
  status (draft|approved|rejected), sourceConversationId, createdAt, updatedAt

api_keys
  id, projectId (FK projects), keyHash (SHA-256), prefix, label, createdAt

customers
  id, projectId (FK projects), name, email, externalId, phone, customFields (JSON),
  firstSeenAt, lastSeenAt, createdAt, updatedAt

customer_visitors
  id, projectId, customerId, visitorId, linkedBy (dashboard|signed_widget),
  createdAt
```

### KV Namespace: CONVERSATIONS_CACHE

Shared general-purpose KV namespace. The name is historical -- it no longer caches conversations. Current consumers:

- `email-change:{userId}` -- pending email change verification tokens
- `faq:{version}:{projectId}:{fingerprint}` -- compiled FAQ prompt text, keyed by a content-hash fingerprint (`worker/chat-runtime/prompt/build-compiled-faq-context.ts`). 5-minute TTL.
- `hybrid_unavailable:{projectId}` -- remembers which projects cannot serve hybrid retrieval so new Worker isolates skip the failed attempt (`worker/chat-runtime/retrieval/run-ai-search.ts`). 24-hour TTL.
- Auto-refine flow uses it for transient state.

Do NOT re-add conversation-message caching here -- prior attempts introduced stale-snapshot bugs in the widget. Message reads should hit D1 via `ChatService.getMessages` / `ChatService.getMessagesSince` directly.

---

## API Routes

### Public (no auth required)

| Method | Route | Purpose |
|--------|-------|---------|
| POST/GET | `/api/auth/*` | Better Auth handler |
| GET | `/api/widget/:projectSlug/config` | Widget config + quick actions/topics |
| POST | `/api/widget/:projectSlug/conversations` | Start a new conversation |
| POST | `/api/widget/:projectSlug/identify` | Verify an opaque signed customer token and attach exact visitor history |
| POST | `/api/widget/:projectSlug/conversations/:id/messages` | Send message (returns SSE stream, or JSON `{ agentMode: true }` when in agent mode) |
| GET | `/api/widget/:projectSlug/conversations/:id/messages` | Get conversation history |
| POST | `/api/telegram/webhook/:projectId` | Telegram bot webhook. Verified with the per-project `secret_token` Telegram echoes in `X-Telegram-Bot-Api-Secret-Token` (derived from `ENCRYPTION_KEY`, `worker/services/telegram-secrets.ts`). The first verified update from a project with no chat id binds that chat; there is no token-polling detect endpoint. |
| POST | `/api/slack/events/:projectId` | Slack Events API. Verified with the per-project Slack signing secret (`v0:{ts}:{body}` HMAC). The first trusted `event.channel` binds once. |
| POST | `/api/webhooks/inbound-mail` | Resend inbound webhook (svix-signed). Fetching the body needs a Resend key with read access, not a sending-only one; a failed fetch answers 502 so Resend retries. Replies are routed by the conversation link they quote (`worker/services/inbound-email-routing.ts`) because Resend replaces our `Message-ID` with the sending provider's, so `In-Reply-To` never references an id we issued. Sender-email lookup is the last resort and only ever matches visitors. |
| GET | `/api/widget-embed.js` | 301 redirect to `widget.replymaven.com` (legacy) |

### Dashboard (session-authenticated)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/dashboard` | Dashboard stats |
| GET/POST/PATCH/DELETE | `/api/projects[/:id]` | CRUD projects |
| GET/PUT | `/api/projects/:id/settings` | Project settings (tone, intro, API keys) |
| GET/PUT | `/api/projects/:id/widget-config` | Widget look and feel |
| GET/POST/DELETE | `/api/projects/:id/quick-actions` | Quick actions CRUD |
| GET/POST/DELETE | `/api/projects/:id/quick-topics` | Quick topics CRUD |
| GET/POST/DELETE | `/api/projects/:id/resources` | Resource management |
| GET/POST | `/api/projects/:id/customers` | List/create customer profiles |
| GET | `/api/projects/:id/customers/ws` | Project-scoped customer cache update stream |
| GET/PATCH/DELETE | `/api/projects/:id/customers/:customerId` | Customer detail/profile lifecycle |
| POST | `/api/projects/:id/conversations/:conversationId/customer` | Promote a visitor or link a conversation to a customer |
| POST | `/api/projects/:id/customers/:targetCustomerId/merge` | Merge a duplicate customer into the target profile |
| POST | `/api/projects/:id/customer-identity-secret/rotate` | Create or rotate the project-scoped signing secret |
| POST | `/api/projects/:id/resources/:resId/reindex` | Trigger re-index |
| GET | `/api/projects/:id/conversations` | List conversations |
| GET | `/api/projects/:id/conversations/:convId` | Conversation detail + messages |
| POST | `/api/projects/:id/conversations/:convId/reply` | Agent reply |
| GET/PATCH/DELETE | `/api/projects/:id/canned-responses` | Canned response management |
| POST | `/api/projects/:id/canned-responses/:crId/approve` | Approve draft |
| GET/PUT | `/api/projects/:id/telegram` | Telegram config |
| POST | `/api/projects/:id/telegram/test` | Test Telegram connection |
| GET/PUT | `/api/projects/:id/slack` | Slack config |
| POST | `/api/projects/:id/slack/test` | Test Slack connection |
| POST | `/api/upload` | Upload files to R2 |

---

## Key Feature Implementation Details

### Chat Widget

The widget is a standalone JS file (`widget-embed.js`) built separately via Vite into a single IIFE bundle, served from a dedicated R2 custom domain (`widget.replymaven.com`). Users add it to their page:

```html
<script src="https://widget.replymaven.com/widget-embed.js"
        data-project="project-slug"></script>
```

The script creates an iframe or shadow DOM element containing the chat UI. It exposes a programmatic API on `window.ReplyMaven`:

```javascript
window.ReplyMaven.open()
window.ReplyMaven.close()
window.ReplyMaven.toggle()
window.ReplyMaven.sendMessage("Hello")
window.ReplyMaven.identify({ name: "John", email: "john@example.com" })
await window.ReplyMaven.identify({ token })
window.ReplyMaven.reset()
window.ReplyMaven.setPageContext({ page: "Pricing", plan: "Pro" })
window.ReplyMaven.setMetadata({ internalId: "abc123" })
window.ReplyMaven.requestNotifications()
window.ReplyMaven.openInquiryForm()
```

### Customer Continuity

- A customer is the canonical project-scoped person. The current stable application `externalId` and normalized email live directly on that customer; they are not stored as an identity or alias history.
- Anonymous `visitorId` remains the widget device ID. `customer_visitors` only maps exact visitor IDs to customers so their conversations stay on one profile. It does not track per-device first/last-seen activity or other analytics.
- Dashboard create/link/promote actions are trusted. They attach every same-project conversation with the exact visitor ID, regardless of whether the conversation is active, closed, or archived.
- Every new chat, inquiry, or ticket resolves the visitor ID before insertion and stores the resulting `customerId`, keeping future threads on the same profile.
- Signed widget identify uses a project-scoped HMAC-SHA256 token with `v`, `projectId`, `iat`, `exp`, and at least `externalId` or email. Tokens may also carry name, phone, and primitive custom fields. Prefer a stable application `externalId` and a 15-minute lifetime; one hour is the maximum.
- The per-project identity secret is encrypted in `project_settings.customerIdentitySecret`, returned in plaintext only when created or rotated, and must never be shipped to browser code.
- Site owners should call `identify({ token })` as soon as authenticated data is available. They may start with only `externalId`, then fetch a fresh token and identify again whenever email, name, phone, or custom fields become available or change.
- Signed identify is serialized in invocation order and returns a promise. Await it so token rejection is observable before continuing an account lifecycle operation.
- For an already-connected visitor ID, at least one signed external ID or email must resolve to the same customer before profile enrichment is accepted. An entirely unmatched signed account conflicts rather than relabeling existing history.
- Unsigned `identify({ name, email, phone, metadata })` only updates the current conversation snapshot. It never creates a customer or attaches earlier threads.
- `reset()` rotates `rm_visitor_id` and clears conversation-scoped widget state. Call it before logout or account switching.
- External ID, email, and visitor-link conflicts fail without mutation. Customers are never auto-merged.
- Customer mutations publish a project-scoped realtime event so customer lists and details refresh even when no conversation changed.

### SSE Streaming Flow

1. Visitor sends message via `POST /api/widget/:slug/conversations/:id/messages`
2. Worker stores visitor message in D1 + updates KV cache
3. **Agent-mode check**: If conversation status is `waiting_agent` or `agent_replied`, AI is bypassed entirely. The visitor message is forwarded to Telegram (as a reply to the thread if `telegramThreadId` exists) and the endpoint returns `{ ok: true, agentMode: true }` as JSON instead of SSE. The widget detects the JSON content type and skips SSE parsing.
4. Worker queries AI Search `search()` with project folder filter for relevant resource chunks
5. Worker checks canned responses for exact/close matches
6. Worker builds system prompt with: `botName` identity, tone config, company context, RAG context, canned response hints, conversation summary, `<page-context>` (from `setPageContext` + auto-collected page URL/title), `<agent-instructions>` (from `agentHandbackInstructions` in conversation metadata if present), and guidelines/SOPs
7. Worker streams AI response back as SSE (`Content-Type: text/event-stream`)
8. Bot message is stored in D1 after streaming completes
9. If bot confidence is low or visitor requests a human, the AI says a natural handoff message (e.g. "Let me connect you with an engineer!") and appends `[HANDOFF_REQUESTED]` which is stripped. Status changes to `waiting_agent`, Telegram notification is sent with recent messages + dashboard link, and `telegramThreadId` is stored for reply threading.

### AI Search (RAG) Integration

Each project stores resources in R2 under a `{projectId}/` prefix. AI Search indexes the R2 bucket and we use folder-based metadata filtering for multitenancy:

```typescript
const results = await env.AI.autorag("supportbot").search({
  query: userMessage,
  filters: { type: "eq", key: "folder", value: `${projectId}/` },
  max_num_results: 5,
  ranking_options: { score_threshold: 0.3 },
});
```

Resource ingestion:
- **Web pages**: URL added -> Worker fetches content -> uploads markdown to R2 under `{projectId}/` -> AI Search auto-indexes
- **PDFs**: File uploaded -> stored in R2 under `{projectId}/` -> AI Search auto-indexes
- **FAQs**: Stored in D1 + written as markdown to R2 -> AI Search indexes

### Live agent handoff (Telegram and Slack)

Messenger transport sits behind `AgentChannelAdapter` (`worker/services/agent-channel.ts`). Telegram and Slack share one inbound handler (`runAgentChannelInbound`). Initial escalation fans out through all enabled adapters. Later visitor messages use `forwardVisitorToJoinedHumans` to reach only joined external clients. Dashboard and MCP ordinary replies do not go through the adapters. Adapters do not interpret `@BotName` or start Sidechat.

1. The owner saves a Telegram bot token or Slack bot token plus signing secret in Tools. `botName` can be set once, then it is locked. Tokens are encrypted at rest. Telegram uses `ENCRYPTION_KEY` (`worker/services/telegram-secrets.ts`). Slack uses its own derived secrets (`worker/services/slack-secrets.ts`).
2. Telegram: saving registers the webhook with a per-project `secret_token`. The chat id is learned from the first verified update. Slack: Events API at `/api/slack/events/:projectId`. The first trusted `event.channel` binds once.
3. When the bot cannot answer confidently or the visitor requests a human:
   - Conversation status changes to `waiting_agent`
   - Enabled adapters send an escalation (`notifyEscalation`) with recent messages, a dashboard link, and `@BotName` command hints
   - Thread ids are stored on `channelThreads` (`telegram` and/or `slack`). `telegramThreadId` remains `channelThreads.telegram ?? null`
4. While review is pending (`waiting_agent`):
   - Maven remains active in `assist_until_agent`, but `request_team_help` is hidden
   - Later visitor messages stay in the conversation and are not pushed externally
5. After a human replies (`agent_replied`):
   - AI is silenced in `human_only`
   - Telegram, Slack, and member email routes join as human replies arrive there. Email routes store only the authorized member identity because inbound providers do not preserve a reliable RFC reply id.
   - Later visitor messages go only to the joined external routes; dashboard and MCP remain transcript-only clients
   - Joined routes clear when Maven receives ownership again
6. Agent replies in Telegram or Slack (not prefixed with `@BotName`) are stored as agent messages. Status becomes `agent_replied`.
7. Agent types `@BotName` commands in Telegram, Slack, the dashboard composer, or MCP. Bare `@BotName` hands the thread back to AI, assigns Maven, and writes `{name} assigned {botName}`. Any other text is read as ordinary language by `interpretBotNameCommand()` and applied as one decision: keep or hand off ownership, store or clear instructions, speak now or stay silent, investigate now, close, or ban. Speak-now uses `generateDirectedResponse()`. Investigate-now starts a private Sidechat turn via `startSidechatTurn` and does not speak to the visitor. MCP `ask_maven` starts the same investigate path. `get_sidechat_status` returns `{ status, hasDraft, waitingApproval }` only. Drafts stay in the dashboard until a human sends them. There is no keyword list. Dashboard and MCP commands are not stored as visitor-visible agent rows. Idle takeover writes `{botName} self-assigned because the human seemed away`.

#### Messenger methods

| Method | Trigger | Content |
|--------|---------|---------|
| `notifyEscalation` | AI handoff or visitor requests human | Recent messages, summary, dashboard link, command hints |
| `forwardVisitorMessage` | Visitor sends a message after this channel joins | Visitor name + message content, threaded reply |
| `confirm` | Command result or Sidechat status ping | Short confirmation text |

### Page Context API

The widget automatically sends `currentPageUrl` and `pageTitle` with every message, so the AI always knows what page the visitor is on. Site owners can enrich this with custom context via the programmatic API:

```javascript
window.ReplyMaven.setPageContext({
  page: "Pricing",
  plan: "Pro",
  userTier: "free",
  cartTotal: "$149.00",
});
```

- Page context is sent **per-message** (not stored on the conversation) because it is transient -- the visitor may navigate pages mid-conversation.
- The context is injected as a `<page-context>` section in the system prompt, so the AI can give contextually relevant answers.
- Keys are freeform -- site owners control what data is relevant. Values are sanitized on both sides (`shared/page-context.ts`): numbers and booleans become text, anything else is dropped, keys are capped at 80 characters, values at 1,000, and the whole record at 20 entries. A loose value never fails the turn.
- Unlike `setMetadata` (which is for analytics/dashboard tracking), `setPageContext` data is actively used by the AI when generating responses.

### Canned Response Auto-Drafting

After a conversation closes:
1. Worker analyzes the conversation using Gemini
2. Identifies the core question/intent
3. Extracts the best answer from bot/agent responses
4. Generates a concise canned response draft
5. Stores draft in `canned_responses` with status `draft`
6. User sees drafts in dashboard and can approve/edit/reject

---

## Cloudflare Bindings

| Binding | Type | Name | Purpose |
|---------|------|------|---------|
| `DB` | D1 Database | `supportbot-db` | Primary data store (legacy name, kept for compatibility) |
| `UPLOADS` | R2 Bucket | `supportbot-uploads` | PDFs, images, widget bundle (legacy name, kept for compatibility) |
| `CONVERSATIONS_CACHE` | KV Namespace | `supportbot-kv` | Shared KV: email-change tokens, compiled FAQ cache, hybrid-unavailable cache, auto-refine state (legacy name kept) |
| `AI` | Workers AI | -- | AI Search binding (`env.AI.autorag(...)`) |
| `ASSETS` | Assets | -- | SPA static assets |

### Environment Variables and Secrets

Defined in `wrangler.jsonc` vars:
- `BETTER_AUTH_URL` -- auth base URL (`http://localhost:5173` in dev, `https://replymaven.com` in prod)
- `AI_MODEL` -- AI model identifier (`gemini-3-flash-preview` or `gpt-5.6-terra`, default `gemini-3-flash-preview`)

Secrets (via `.dev.vars` locally, `wrangler secret put` for production):
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `RESEND_API_KEY`
- `ENCRYPTION_KEY` -- for AES-GCM encryption of stored API keys/tokens
- `GEMINI_API_KEY` -- Google Gemini API key (required when `AI_MODEL` is a Gemini model)
- `OPENAI_API_KEY` -- OpenAI API key (required when `AI_MODEL` is a GPT model)

---

## Implementation Phases

### Phase 1 -- Foundation (scaffold + auth + projects)
1. Initialize project (package.json, vite config, wrangler config, tsconfigs, eslint)
2. Set up Drizzle + D1 schema (auth tables + projects + project_settings)
3. Set up Better Auth (Google/GitHub OAuth)
4. Create dashboard layout (sidebar, auth guard, error boundary)
5. Build project CRUD pages

### Phase 2 -- Widget and Chat Core
6. Build widget embed script (loader + iframe/shadow DOM)
7. Build widget UI (chat interface, message bubbles, input)
8. Implement chat API routes (create conversation, send message)
9. Integrate Gemini API (server-side, SSE streaming)
10. Implement KV conversation caching

### Phase 3 -- RAG and Resources
11. Build resource management pages (add URL, upload PDF, create FAQ)
12. Implement resource ingestion pipeline (R2 upload -> AI Search)
13. Integrate AI Search `search()` into chat flow
14. Build RAG-augmented prompt construction

### Phase 4 -- Customization
15. Build widget config page (colors, position, fonts, live preview)
16. Implement quick actions and quick topics
17. Build tone of voice configuration
18. Implement intro message configuration

### Phase 5 -- Telegram and Agent Features
19. Build Telegram integration config page
20. Implement Telegram webhook + message relay
21. Build conversation inbox for agent replies
22. Implement live agent handoff flow (AI confidence check + `[HANDOFF_REQUESTED]` token)
23. Implement agent-mode AI bypass (silence AI when conversation is in `waiting_agent`/`agent_replied`, forward visitor messages to Telegram)
24. Implement `@BotName` command parsing with AI intent classification (`close`, `handback`, `respond`)
25. Implement `generateDirectedResponse()` for agent-directed bot replies
26. Add Telegram notification methods (`notifyNewConversation`, `notifyNewBooking`, `notifyContactForm`, `forwardVisitorMessage`) with reply threading via `telegramThreadId`
27. Add `botName` (set once, then locked) and configurable `agentName` in project settings + dashboard UI

### Phase 6 -- Canned Responses
28. Build canned response management page
29. Implement auto-draft generation (post-conversation Gemini analysis)
30. Integrate canned responses into chat flow (priority matching)

### Phase 7 -- Polish
31. Dashboard analytics (conversation counts, response times, topics)
32. Widget programmatic API (`open`, `close`, `toggle`, `identify`, `sendMessage`, `setPageContext`, `setMetadata`, `requestNotifications`, `openInquiryForm`)
33. Implement `setPageContext` for per-message AI-visible page context (auto-includes `currentPageUrl` and `pageTitle`)
34. Rate limiting and abuse prevention
35. Error handling, loading states, edge cases

---

## Documentation and Rules Maintenance

- Keep `AGENTS.md` as the canonical project guide for contributors and agents
- Do not put real secrets in docs; use variable names/placeholders only
- Update docs when scripts, folder structure, or env requirements change
- Keep command examples aligned with current `package.json` scripts
