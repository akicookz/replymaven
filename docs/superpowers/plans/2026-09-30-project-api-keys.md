# Project API Keys Implementation Plan

> **Execution:** Implement directly with `superpowers:executing-plans`. No sub-agents. No new tests, per repository instructions. Implementation was approved by the user after this plan.

**Goal:** Let a backend submit inbound messages with a project API key, without OAuth setup.

**Architecture:** Use the existing `api_keys` table for project-scoped credentials. Dashboard sessions manage keys; the inbound endpoint validates a key and passes the request to the existing shared inbound email processing. MCP keeps its own OAuth flow.

**Tech stack:** Hono, Drizzle/D1, Web Crypto, React, TanStack Query, existing shadcn controls, Bun.

**Related spec:** `../specs/2026-09-30-widget-prefill-inbound-api-design.md`. This plan supersedes its OAuth choice for inbound HTTP requests and the OAuth steps in `2026-09-30-widget-prefill-inbound-api.md`. Widget prefilling and inbound email processing retain their existing scope.

## Decisions

- No database changes or migrations. Existing columns are `id`, `projectId`, `keyHash`, `prefix`, `label`, and `createdAt`; project deletion already has a cascading foreign key.
- Multiple named keys per project. They do not expire automatically. Revoke by deleting the key row; rotate by creating a replacement, updating the integration, then revoking the old key.
- Generate 32 random bytes with Web Crypto and encode as unpadded base64url. New keys have the form `rm_key_<43 characters>`. Hash the complete key with SHA-256 and store lowercase hexadecimal in `keyHash`.
- Store only the first 14 characters as the display prefix. Show the full key once in the successful creation response. Never store plaintext in D1, KV, logs, browser storage, or a query cache.
- Read the key from `Authorization: Bearer <api_key>`. Do not accept it in URLs or JSON. Reject missing, blank, oversized (>512 characters), or invalid credentials with 401. Validate existing nonempty keys by their stored hash rather than requiring the new prefix, because storage predates this issuer.
- Authenticate against both the requested `projectId` and key hash. The current project index supports this lookup. A key for another project receives the same 401 as an invalid key. No positive authentication cache; a removed key must fail subsequent checks. Already-authorized work may finish after revocation.
- Keys authorize only this inbound HTTP endpoint in this scope. They do not grant access to dashboard, key-management, or MCP endpoints.
- Account owners and admins with access to the project can list, create, and revoke keys. Members cannot. This follows the existing customer signing-secret management role boundary.
- A key represents a trusted project integration, not a signed-in teammate. That backend is responsible for authenticating the sender before submitting their email. It can submit as a customer or as an existing authorized teammate. Do not invent a user ID for the key or treat the key's creator as the message author.
- Keep the email resolver and visitor/teammate classification. Existing membership, project access, assignee, Sidechat, and tool-approval rules still apply to the resolved teammate. A key does not turn an arbitrary email address into a teammate.

## Request flow

```text
Owner/admin dashboard session
  -> Project settings: create key
  -> Store hash; show full key once

Backend: POST /api/v1/projects/:projectId/inbound/messages
  Authorization: Bearer <project API key>
  -> Match project + stored key hash
  -> Validate required email and message fields
  -> Existing inbound email conversation resolver
  -> Existing visitor or teammate classification
  -> Public message / joined humans / Maven, or teammate Sidechat path
  -> Existing email reply delivery
```

Email, threading references, customer fields, and retry behavior keep their current inbound contract. Switching or rotating keys does not change the event-ID deduplication namespace.

## Files

| File | Responsibility |
| --- | --- |
| New `worker/services/api-key-service.ts` | Generate, hash, list, verify, and revoke project keys. |
| New `worker/routes/api-key-handlers.ts` | Session authorization and key-management responses. |
| `worker/index.ts` | Mount management routes under existing project access middleware. |
| `worker/validation.ts` | Reuse `createApiKeySchema`; trim labels and enforce its existing 1–100 character bounds after trimming. |
| `worker/routes/inbound-message-handlers.ts` | Replace OAuth context with project-key authentication. |
| `worker/mcp-server.ts` | Remove only the export added to expose `getMcpRequestContext` to the inbound adapter. |
| New `src/components/settings/ProjectApiKeys.tsx` | Key list, creation, one-time copy, and revocation. |
| `src/pages/ProjectSettings.tsx` | Mount the API keys section with a `projectId` component key. |
| `docs/api/inbound-messages.md` and both earlier spec/plan files | Replace the pending OAuth design with the implemented key contract when implementation finishes. |

No new settings page, navigation item, shared credential module, credential scope editor, expiration fields, last-used fields, or audit table is needed for this version.

## Checkpoint 1: Key service and management endpoints

**Interfaces**

`ApiKeyService` takes the existing Drizzle database type. Define `ApiKeySummary = { id: string; label: string; prefix: string; createdAt: string }`, with an ISO timestamp, inside the service.

- `list(projectId: string): Promise<ApiKeySummary[]>`
- `create(projectId: string, label: string): Promise<{ apiKey: ApiKeySummary; key: string }>`
- `authenticate(projectId: string, key: string): Promise<{ keyId: string; projectId: string } | null>`
- `revoke(projectId: string, keyId: string): Promise<boolean>`

| Route | Input | Response |
| --- | --- | --- |
| `GET /api/projects/:id/api-keys` | Dashboard session | 200 `{ apiKeys: ApiKeySummary[] }` |
| `POST /api/projects/:id/api-keys` | Dashboard session, `{ label }` | 201 `{ apiKey: ApiKeySummary, key }` |
| `DELETE /api/projects/:id/api-keys/:keyId` | Dashboard session | 204 on removal; 404 if not found in this project |

- [ ] Implement the service against `apiKeys` from `worker/db/schema.ts`. Use explicit summary selects; never serialize `keyHash` in list/create responses. Order lists by newest first, then ID.
- [ ] Implement `handleListApiKeys`, `handleCreateApiKey`, and `handleRevokeApiKey` in the new handler module. Require an authenticated dashboard session and explicit owner/admin role. Load the project and compare its owner with the active team's `effectiveUserId`; also enforce project access. Middleware alone does not verify project ownership.
- [ ] Mount the three routes after `.use("/api/projects/:id/*", projectAccessMiddleware)`. Follow the authorization checks of the existing customer signing-secret rotation route. Keys cannot authenticate these management routes.
- [ ] Validate labels with `createApiKeySchema`. Return 400 for invalid JSON or labels, 401 for no session, 403 for member role, and 404 for an inaccessible project or unknown key. Bound the creation body to 4 KiB with `readLimitedBody`; return 413 if exceeded. Set `Cache-Control: no-store` on management responses.
- [ ] Manually exercise creation, list, and revocation using disposable local data. Inspect the local row to confirm a hash and prefix, not plaintext. Check cross-project key IDs and owner/admin/member access. Do not print the generated secret into verification logs.
- [ ] Run `bunx tsc -b --force` and `bun run lint`. Commit this checkpoint locally as `Add project API key management` after its checks pass.

## Checkpoint 2: Authenticate inbound requests with the project key

- [ ] In `handleInboundMessage`, remove imports of `getMcpRequestContext` and `getAccessibleProject`. Read the bounded bearer credential, call `ApiKeyService.authenticate(projectId, key)`, and load the project through `ProjectService`. Use `c.get("db")` for database services. Do not fall back to an OAuth token or browser session.
- [ ] Remove the `conversations:reply` scope check and the check requiring `teammate.userId === context.userId`. There is no human token owner with a project key. Keep `ChannelIdentityService.resolveByEmail` and the shared email processor's membership/ownership checks. Do not pass the project owner as the sender.
- [ ] Change the request-rate bucket to `inbound-api:${project.id}:${keyId}` with the current 30/minute limit. Keep the shared eight-new-conversations/hour per project/sender limit. Preserve the project-scoped event marker, so the same retry under a replacement key remains a duplicate.
- [ ] Preserve required email, customer identity conflict handling, visitor bans, billing checks, shared conversation resolution, Maven eligibility, teammate commands, and reply delivery. Teammate messages must not update customer profile fields. The Resend adapter must continue to use its provider signature, not an API key.
- [ ] Remove the inbound-only export from `worker/mcp-server.ts`; retain the existing private function and MCP behavior.
- [ ] Manually call the local endpoint with missing, malformed, invalid, revoked, cross-project, OAuth, and valid project credentials. Verify invalid credentials stop before profile or conversation mutation. A valid key with missing email must reach validation and return 400, proving authentication passed.
- [ ] Using disposable local conversation data, verify customer creation, existing-conversation/reply references, fallback threading, identity conflicts, archived rejection, closed reopening, duplicate event handling across two keys, and teammate routing. Verify teammate commands remain unchanged and unauthorized senders cannot write to another customer's referenced thread. A sender without a thread match may still create their own customer conversation, as in email.
- [ ] Verify Maven/human routing and email delivery only against controlled recipients and local configuration. Do not use real customer threads. If live transport verification is unavailable, record that gap rather than claiming end-to-end delivery passed.
- [ ] Run `bunx tsc -b --force` and `bun run lint`. Commit locally as `Authenticate inbound messages with project API keys`.

## Checkpoint 3: Project settings controls and documentation

- [ ] Build `ProjectApiKeys` within the existing Project settings page. Reuse `WidgetSectionCard`, `Button`, `Input`, `Label`, and `Dialog` from the repository. These primitives already exist; do not add a component package. Match existing spacing and tokens, with no separators, divider borders, eyebrows, or all-caps labels.
- [ ] Show the section only for owner/admin roles from `useSubscription`, with server authorization as the source of truth. List label, prefix, and creation date. Provide `Create key` and a row action that opens key details; put `Revoke key` at the bottom left of that dialog and `Cancel` at the bottom right.
- [ ] Creation asks only for a label. On success, show the full key with `Copy key`, `Done`, and one short instruction: `Copy this key now. It will not be shown again.` A second short line states its permission: `This key can submit customer and teammate messages for this project.`
- [ ] Use query key `["project-api-keys", projectId]` for summaries only. Keep plaintext in component state, reset mutation data after consuming the creation result, and clear it on dialog close, project change, and unmount. Disable automatic creation retries; a lost response requires a replacement key and cleanup of the unusable entry.
- [ ] Show loading, empty, and failure states. Disable pending actions. Copy success and failure get feedback. Revocation requires confirmation, invalidates the list, and closes the dialog only after success. API errors remain visible and retryable.
- [ ] Replace OAuth setup in `docs/api/inbound-messages.md` with key creation and the `Authorization: Bearer <api_key>` example. Explain project scope, server-only use, one-time display, manual rotation, sender responsibility, teammate support, and the difference from widget customer-signing secrets. Update the earlier plan/spec so they no longer instruct an implementer to restore OAuth authentication.
- [ ] Browser click through owner/admin creation, copy, close/reopen, project switch, revocation, empty/error states, member visibility, and a narrow viewport. Confirm a full key cannot reappear after closing or switching projects. Do not put plaintext keys in screenshots.
- [ ] Run `bunx tsc -b --force`, `bun run lint`, and `bun run build`. Run `bun run widget:build` when finishing the original widget feature. Report unrelated warnings separately. No new tests.
- [ ] Commit locally as `Add API key controls and inbound API documentation`. Do not push, publish help articles, deploy, or run migrations.

## Review focus

1. **Cross-project access:** both key verification and revocation bind to the project, not merely the key ID or current team's role. Checked in checkpoints 1 and 2.
2. **Secret lifecycle:** list responses, query caches, screenshots, and project switches must not expose a full key. Checked in checkpoints 1 and 3.
3. **Teammate identity:** the backend asserts sender email; existing project membership and ownership still govern the message. No synthetic owner identity or customer-only restriction. Checked in checkpoint 2.
4. **Revocation and retry:** future requests fail after revoke; work already accepted can finish. A replacement key must not bypass event deduplication. Checked in checkpoint 2.
5. **Existing transports:** replacing the new adapter's auth must not alter MCP OAuth, email signatures, widget identity signing, or email processing. Checked in checkpoints 2 and 3.

## Implementation record

Implemented locally on 2026-09-30. The inbound endpoint now uses project API keys. MCP authentication is unchanged. The existing API-key schema needed no migration.

Verified against an isolated local Worker with synthetic owner/admin/member accounts and two projects:

- Owner and admin management succeeded; member management returned 403; anonymous management returned 401.
- Creation returned the plaintext once. List responses contained only safe summaries. The stored row had a 64-character hash and 14-character prefix, with no plaintext.
- Missing, invalid, OAuth, revoked, and wrong-project inbound credentials returned 401. A valid key reached required-email validation and returned 400.
- Cross-project revocation returned 404. An admin revoked an owner-created key. API keys did not authenticate management routes.
- Browser creation, copy feedback, closing the secret display, reopening without the secret, revocation, empty state, and member visibility were checked.
- API documentation now describes keys and trusted sender assertions. The user requested left-aligned dialog text, two-column buttons above mobile, and Create key in the section header; these replace the initial footer arrangement.

Forced TypeScript and widget build passed. After the final layout correction, the app build and lint passed again (zero errors, 17 existing warnings). Browser checks confirmed left-aligned headers, equal two-column buttons above 480px, and one column at 375px. Create key uses the existing section header action slot. The profile setup dialog title, description, and avatar were left-aligned at the user's request and checked in the browser.

Remaining verification limits: live Maven generation and email delivery were not run. The full disposable-conversation matrix above (thread references, reopening, teammate routing, and retries across keys) has not been exercised through HTTP. Shared processing was traced in source; do not represent those paths as live delivery checks. No new tests, migrations, push, or deployment.

The original uncommitted widget and inbound implementation is included in the checkpoint commits rather than discarded.
