# AGENTS.md - ReplyMaven

This file is the operating guide for agents/contributors working in this repo.

## Product Overview

ReplyMaven (replymaven.com) is a multi-tenant AI-powered customer support chatbot platform built on Cloudflare Workers. Users sign up, create a project/bot, customize its appearance and behavior, add knowledge resources (web pages, PDFs, FAQs), and embed a lightweight chat widget on their website. The bot uses Google Gemini (3.x Flash) for AI responses, Cloudflare AI Search for RAG over user-uploaded resources, and supports Telegram-based live agent handoff when the bot cannot confidently answer.

### Core Features

- **Embeddable chat widget** -- standalone JS embed script (`<script>` tag) that users install on their pages. Supports programmatic invocation (`open`, `close`, `toggle`, `sendMessage`, `identify`). Uses SSE for streaming AI responses.
- **Dashboard** -- React SPA where users configure their bot, manage resources, review conversations, and customize the widget's look and feel.
- **Resource management** -- users add web pages, FAQs, and PDFs as knowledge sources. These are stored in R2 and indexed via Cloudflare AI Search for RAG retrieval.
- **Tone of voice** -- configurable AI personality (professional, friendly, casual, formal, or custom prompt).
- **Quick actions and quick topics** -- configurable buttons and topic suggestions shown above the chat input.
- **Intro message** -- the first bot message visitors see when they open the widget.
- **Telegram live agent handoff** -- when the bot cannot answer or the visitor requests a human, the conversation is relayed to the user's Telegram. Agent replies in Telegram are synced back to the widget.
- **Canned response auto-drafting** -- after a conversation ends, the AI analyzes it and generates draft canned responses. Users approve or reject drafts from the dashboard.

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
| AI Model | **Google Gemini 3 Flash** (server-side, SSE streaming) |
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
│       ├── chat-service.ts
│       ├── resource-service.ts
│       ├── widget-service.ts
│       ├── telegram-service.ts
│       ├── canned-response-service.ts
│       ├── gemini-service.ts
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

### TypeScript

- Keep strict typing everywhere; avoid `any`
- Prefer `interface` for object shapes and `type` for unions/compositions and Drizzle row types
- Add explicit types for API responses and service inputs/outputs
- `verbatimModuleSyntax: true` enforced across all tsconfigs

### Naming conventions

- **PascalCase**: Components, types, interfaces, service classes (`ProjectService`, `AuthGuard`, `ChatService`)
- **camelCase**: Variables, functions
- **kebab-case**: UI component files (`app-sidebar.tsx`), service files (`chat-service.ts`), hook files (`use-mobile.ts`)
- **PascalCase filenames**: Page components (`Dashboard.tsx`, `Conversations.tsx`)

### UI/component workflow

1. Check shadcn/ui availability first
2. Reuse existing components in `src/components/` next
3. Create custom component only if no reusable option exists

### Styling

- Tailwind CSS v4 tokens from `src/index.css`
- Use semantic color tokens (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, etc.)
- Keep glassmorphism style consistent: `bg-card/50 backdrop-blur-xl`, `rounded-2xl`, subtle borders/shadows
- oklch color space for all color definitions
- Base radius: `1.25rem`
- Fonts: `Satoshi` (sans), `Playfair Display` (heading)
- Dark mode via `.dark` class variant
- Ensure keyboard accessibility, ARIA usage, and color contrast

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
  telegramBotToken (encrypted), telegramChatId, toneOfVoice, customTonePrompt,
  introMessage, autoCannedDraft (boolean), createdAt, updatedAt

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
  id, projectId (FK projects), visitorId, visitorName, visitorEmail,
  status (active|waiting_agent|agent_replied|closed), telegramThreadId,
  metadata (JSON), createdAt, updatedAt

messages
  id, conversationId (FK conversations), role (visitor|bot|agent),
  content, sources (JSON), createdAt

canned_responses
  id, projectId (FK projects), trigger, response,
  status (draft|approved|rejected), sourceConversationId, createdAt, updatedAt

api_keys
  id, projectId (FK projects), keyHash (SHA-256), prefix, label, createdAt
```

### KV Namespace: CONVERSATIONS_CACHE

- Key format: `conv:{conversationId}` -- JSON of recent messages (last 50)
- TTL: 24 hours (auto-evict stale conversations)
- Purpose: Fast reads for active chat sessions without hitting D1

---

## API Routes

### Public (no auth required)

| Method | Route | Purpose |
|--------|-------|---------|
| POST/GET | `/api/auth/*` | Better Auth handler |
| GET | `/api/widget/:projectSlug/config` | Widget config + quick actions/topics |
| POST | `/api/widget/:projectSlug/conversations` | Start a new conversation |
| POST | `/api/widget/:projectSlug/conversations/:id/messages` | Send message (returns SSE stream) |
| GET | `/api/widget/:projectSlug/conversations/:id/messages` | Get conversation history |
| POST | `/api/telegram/webhook/:projectId` | Telegram bot webhook |
| GET | `/api/widget-embed.js` | Serve the widget JS bundle from R2 |

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
| POST | `/api/projects/:id/resources/:resId/reindex` | Trigger re-index |
| GET | `/api/projects/:id/conversations` | List conversations |
| GET | `/api/projects/:id/conversations/:convId` | Conversation detail + messages |
| POST | `/api/projects/:id/conversations/:convId/reply` | Agent reply |
| GET/PATCH/DELETE | `/api/projects/:id/canned-responses` | Canned response management |
| POST | `/api/projects/:id/canned-responses/:crId/approve` | Approve draft |
| GET/PUT | `/api/projects/:id/telegram` | Telegram config |
| POST | `/api/projects/:id/telegram/test` | Test Telegram connection |
| POST | `/api/upload` | Upload files to R2 |

---

## Key Feature Implementation Details

### Chat Widget

The widget is a standalone JS file (`widget-embed.js`) built separately via Vite into a single IIFE bundle. Users add it to their page:

```html
<script src="https://replymaven.com/api/widget-embed.js"
        data-project="project-slug"></script>
```

The script creates an iframe or shadow DOM element containing the chat UI. It exposes a programmatic API on `window.ReplyMaven`:

```javascript
window.ReplyMaven.open()
window.ReplyMaven.close()
window.ReplyMaven.toggle()
window.ReplyMaven.sendMessage("Hello")
window.ReplyMaven.identify({ name: "John", email: "john@example.com" })
```

### SSE Streaming Flow

1. Visitor sends message via `POST /api/widget/:slug/conversations/:id/messages`
2. Worker stores visitor message in D1 + updates KV cache
3. Worker queries AI Search `search()` with project folder filter for relevant resource chunks
4. Worker checks canned responses for exact/close matches
5. Worker calls Gemini API with: system prompt + tone config + RAG context + conversation history + canned response hints
6. Worker streams Gemini response back as SSE (`Content-Type: text/event-stream`)
7. Bot message is stored in D1 after streaming completes
8. If bot confidence is low or visitor requests a human, status changes to `waiting_agent` and a Telegram notification is sent

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

### Telegram Live Agent Handoff

1. User configures Telegram bot token + chat ID in dashboard settings
2. When the bot cannot answer confidently or visitor clicks "Talk to human":
   - Conversation status changes to `waiting_agent`
   - Worker sends Telegram message via Bot API with conversation summary
3. Agent replies in Telegram -> Telegram webhook fires -> Worker receives reply
4. Worker stores agent message, updates conversation status, pushes to widget
5. Conversation status changes to `agent_replied`

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
| `CONVERSATIONS_CACHE` | KV Namespace | `supportbot-kv` | Active conversation cache (legacy name, kept for compatibility) |
| `AI` | Workers AI | -- | AI Search binding (`env.AI.autorag(...)`) |
| `ASSETS` | Assets | -- | SPA static assets |

### Environment Variables and Secrets

Defined in `wrangler.jsonc` vars:
- `BETTER_AUTH_URL` -- auth base URL (`http://localhost:5173` in dev, `https://replymaven.com` in prod)

Secrets (via `.dev.vars` locally, `wrangler secret put` for production):
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `RESEND_API_KEY`
- `ENCRYPTION_KEY` -- for AES-GCM encryption of stored API keys/tokens

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
22. Implement live agent handoff flow

### Phase 6 -- Canned Responses
23. Build canned response management page
24. Implement auto-draft generation (post-conversation Gemini analysis)
25. Integrate canned responses into chat flow (priority matching)

### Phase 7 -- Polish
26. Dashboard analytics (conversation counts, response times, topics)
27. Widget programmatic API (`open`, `close`, `identify`)
28. Rate limiting and abuse prevention
29. Error handling, loading states, edge cases

---

## Documentation and Rules Maintenance

- Keep `AGENTS.md` as the canonical project guide for contributors and agents
- Do not put real secrets in docs; use variable names/placeholders only
- Update docs when scripts, folder structure, or env requirements change
- Keep command examples aligned with current `package.json` scripts
