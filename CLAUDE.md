# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ReplyMaven is an AI-powered customer support chatbot platform built on Cloudflare Workers. It allows users to create customizable AI chatbots with knowledge bases (web pages, PDFs, FAQs), embed them on websites via a lightweight widget, and handle Telegram-based live agent handoff.

## Essential Commands

```bash
# Development
bun run dev                  # Start local development server
bun run lint                 # Run ESLint
bun run build                # Build for production
bun run db:generate          # Generate Drizzle migrations from schema changes
bun run db:migrate:dev       # Apply migrations to local D1 database
bun run db:migrate:prod      # Apply migrations to production D1

# Widget Development
bun run widget:build         # Build widget bundle
bun run widget:upload        # Upload widget to R2
bun run widget:deploy        # Build and upload widget

# Deployment
bun run deploy               # Deploy worker and dashboard
bun run deploy:full          # Full deployment (build + widget + worker + migrations)
```

## Architecture Overview

### Tech Stack
- **Runtime**: Bun (NEVER use npm/yarn)
- **Frontend**: React 19 SPA with React Router DOM v7, TanStack Query, Tailwind CSS v4, shadcn/ui
- **Backend**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Storage**: Cloudflare R2 (files), KV (conversation cache)
- **AI**: Google Gemini or OpenAI GPT (configurable via `AI_MODEL`), Cloudflare AI Search for RAG
- **Auth**: Better Auth with Google/GitHub OAuth

### Project Structure
- `src/` - React dashboard SPA
- `worker/` - Cloudflare Worker backend (Hono API)
  - `worker/services/` - Business logic layer (one class per domain)
  - `worker/db/` - Drizzle schemas and migrations
  - `worker/chat-runtime/` - AI chat engine and agent system
- `widget/` - Standalone embeddable chat widget (separate build)

### Key Services
- **ChatService** - Conversation management and AI orchestration
- **ResourceService** - Knowledge base management (web pages, PDFs, FAQs)
- **TelegramService** - Live agent handoff and notifications
- **AIService** - Model abstraction for Gemini/OpenAI with SSE streaming

## Critical Patterns

### Function Style
Use function declarations for all named functions and React components. Arrow functions only for inline callbacks.

```typescript
// ✅ Correct
function MyComponent() { ... }
export default MyComponent;

// ❌ Wrong
const MyComponent = () => { ... }
```

### Service Layer Pattern
Services are instantiated per-request in route handlers:

```typescript
.get("/api/resources", async (c) => {
  const db = c.get("db");
  const service = new ResourceService(db);
  return c.json(await service.getResources());
})
```

### Database Conventions
- UUIDs via `crypto.randomUUID()` for IDs
- Timestamps as Unix integers with `sql\`(unixepoch())\``
- Type exports: `FooRow` (select), `NewFooRow` (insert)

### API Response Formats
- SSE streaming for AI chat responses (`text/event-stream`)
- JSON `{ ok: true, agentMode: true }` when in agent mode (no AI)
- Standard JSON for all other endpoints

## Live Agent Handoff

When AI confidence is low or visitor requests human:
1. AI responds with handoff message + hidden `[HANDOFF_REQUESTED]` token
2. Conversation status changes to `waiting_agent`
3. Telegram notification sent with thread ID stored
4. While in agent mode, AI is bypassed entirely - visitor messages forward to Telegram

Agent commands in Telegram:
- `@BotName` - Hand back to AI
- `@BotName close` - Close conversation
- `@BotName <instructions>` - Hand back with private instructions
- `@BotName respond` - Make AI respond immediately

## Environment Variables

Required secrets (`.dev.vars` locally, `wrangler secret put` for production):
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `RESEND_API_KEY`
- `ENCRYPTION_KEY`
- `GEMINI_API_KEY` (when using Gemini)
- `OPENAI_API_KEY` (when using GPT)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

## Development Notes

- Always use Bun, never npm/yarn
- Widget is built separately and served from R2 custom domain
- Use existing shadcn/ui components before creating custom ones
- Follow glassmorphism design: `bg-card/50 backdrop-blur-xl`
- Never use border separators in lists - use spacing and background contrast
- All timestamps stored as Unix integers in D1
- KV cache for active conversations (24hr TTL)
- AI Search handles RAG with folder-based multitenancy