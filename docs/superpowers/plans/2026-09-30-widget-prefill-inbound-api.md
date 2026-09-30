# Widget prefill and inbound API implementation plan

> **Authentication plan update:** The OAuth choice for the new inbound endpoint is superseded by `docs/superpowers/plans/2026-09-30-project-api-keys.md`. Project API-key authentication and owner/admin key management are implemented locally. MCP OAuth is unchanged.

**Goal:** Add widget drafts and a JSON adapter to existing inbound email processing.
**Execution:** Direct implementation in this session, without sub-agents or new tests.
**Spec:** ../specs/2026-09-30-widget-prefill-inbound-api-design.md

## Constraints

Required email. Validate project API keys against the existing api_keys table. Preserve inbound email routing and both sender roles. No migrations, new credential tables, external thread namespace, receipt service, or polling API. No push/deploy. Use Bun and browser click-through.

## Checkpoint 1: Existing inbound processing and JSON adapter

- Extract the existing post-parse email handler to `worker/services/process-inbound-message.ts`, keeping resolution, visitor and teammate branches, attachment storage, team forwarding, Maven, email delivery, and processed marker behavior.
- Pass existing request helpers for rate limiting and customer broadcasts; preserve the Resend adapter's signature check and parsing in `worker/index.ts`.
- Use project API-key authentication for `POST /api/v1/projects/:projectId/inbound/messages`. See the API-key plan for issuance and management.
- Validate required email, text, optional event ID, existing conversation/reply IDs, and existing customer fields in `worker/validation.ts`. The trusted project backend asserts sender email; preserve existing visitor/teammate classification.
- Pass JSON through the same processing function. Return existing conversation/message IDs when a message is stored. Keep email reply delivery.
- Verify compilation and reject missing credentials, email, invalid keys and unauthorized conversation senders before processing.

## Checkpoint 2: Widget prefill

- Extend `open("chat", { message })` and `open("form", formLabelSlug, fieldValues)` in `widget/index.ts`.
- Derive form labels from existing inquiry quick actions; derive field keys from labels. Reuse all existing controls and submission paths. No new UI controls.
- Add `ready()`, validate all prefill inputs before mutation, replace only supplied values, clear on reset, preserve drafts on close/failure.
- Include selected form label in existing form message content, resolved on the server from configuration.
- Keep old widget calls and label-based submissions compatible.

## Checkpoint 3: Documentation and verification

- Document the precise endpoint, project keys, IDs, email replies, and widget API examples.
- Run forced TypeScript check, lint, app build, and widget build. Report unrelated failures separately.
- Click through local widget normal/inline/mobile form and chat drafts, edits, reset, and submission payloads using browser control.
- Inspect the final diff and create local commit checkpoints only for verified work.
