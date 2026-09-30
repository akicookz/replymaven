# Widget prefill and inbound message API

> **Authentication plan update:** The OAuth choice for the new inbound endpoint is superseded by `docs/superpowers/plans/2026-09-30-project-api-keys.md`. Project API-key authentication and owner/admin key management are implemented locally. MCP OAuth is unchanged.

Status: Implemented locally on 2026-09-30. Not deployed. The JSON adapter reuses project API-key authentication and inbound email processing. See `docs/api/inbound-messages.md` for the implemented request and response contract. Live API-to-Maven/email delivery remains unverified.

## Outcome

A website can open the widget with a message draft or selected form fields filled in. A backend can send an initial customer message, create or resolve the customer, and create or continue a thread in one request. ReplyMaven creates new conversation IDs. Callers can reference existing conversations/messages and existing customer identities; separate caller-defined thread IDs are not required.

Confirmed: Maven answers inbound messages when allowed, using the same rules as chat. Receiving a form or API message does not by itself escalate the thread.

## Baseline behavior and gaps before implementation

- `open()` selects a widget screen. Its current extra argument selects a greeting; it cannot prefill fields.
- `sendMessage()` sends immediately. A draft needs a separate behavior.
- The project has one configured contact form. Fields currently use labels as keys. The proposed API derives form and field identifiers from their labels.
- Form submissions become public visitor messages. The text includes submitted labels and values, but there is no structured form name or form identity in the message context.
- Customers already have project-scoped `externalId`, name, email, phone, and `customFields`. Email and external ID conflicts are detected by the customer identity service.
- Conversation creation generates internal IDs. There is no general external thread/message mapping.
- Public transcripts belong to conversation Agents. Appending a record alone does not start the normal chat turn.

These describe the baseline inspected before implementation.

## Verified inbound email behavior

The baseline is `/api/webhooks/inbound-mail` in `worker/index.ts`, not a new integration-owned conversation system.

### Receive and locate

1. Verify the Resend webhook signature. Read the provider's `email_id`, sender, and recipients. Check a 24-hour KV processed marker.
2. Resolve the project from the recipient's slug or `slug+c<conversation UUID>` address. Fetch the full email from Resend; read text/HTML, headers, subject, RFC Message-ID, and attachments. Ignore auto-generated mail and strip quoted replies/signatures from visitor content.
3. Find a ReplyMaven message ID encoded in `In-Reply-To`; otherwise use the last recognized ReplyMaven ID in `References`. This parser recognizes `<msg-<UUID>@updates.replymaven.com>`, not any arbitrary RFC Message-ID. The stored provider email ID, RFC Message-ID, and ReplyMaven message ID have different purposes.
4. `resolveInboundConversation()` tries the referenced public message's conversation, the reply-address conversation UUID, a conversation reference in the original body, then the recent-open sender-email lookup, in that order. A missing reference falls through. An archived explicit match stops processing; it does not fall through to another conversation.
5. Recent-open lookup is project-wide. It compares normalized sender email with **conversation.visitorEmail**, requires a nonempty visitor ID, excludes closed and archived conversations, requires activity in the last seven days, and orders by last activity descending then conversation ID descending. It does not filter by original channel, subject, form, integration, or customer ID. It can select a conversation that began in the widget.

### Create or authorize the sender

6. If no conversation matches and the sender is an authorized teammate, create a customerless conversation for the forwarded email. Its visitor ID derives from `forward:<email_id>`. The quoted content is retained for Maven. This is a separate branch from customer ingestion.
7. Otherwise, for a new customer conversation, derive a visitor ID from the project and sender email, check the visitor/email ban and creation rate, resolve/create the existing customer profile by email, and create the ordinary conversation with `channel: email`, subject, and inbound address. Link it through `CustomerIdentityService.linkConversation()`.
8. That linking method attaches the visitor identity and updates that visitor's conversations. It is not a single-row foreign-key assignment; conflicting existing customer links must be handled.
9. Check recent transcript content for duplicates within five minutes, in addition to the provider-event marker. For a text message the comparison is content equality, not sender or external ID.
10. On an existing conversation, classify the sender: matching stored visitor email means a visitor; otherwise require an owner/member account with access to this project. An unrelated sender is rejected even if they know the conversation reference. The handler does not resolve or update a customer profile on every existing-thread reply.
11. An authorized sender can reopen a closed, non-archived conversation via `reopen()`. This uses stored ownership state. The seven-day limit applies only to the fallback search, not to an explicit reference.

### Store, process, and deliver

12. A visitor message goes through `addPublicMessage()` → `appendVisitor()` → the existing conversation child's serialized append. It carries `origin: email`, `idempotencyKey: email:<provider email_id>`, the referenced ReplyMaven message ID in `externalReplyTo`, the received RFC Message-ID, sender name, and stored attachments.
13. The child stores the public transcript and publishes the existing project inbox projection. An append does not by itself invoke Maven. The handler separately updates linked customer activity and checks that the conversation is still operational.
14. If `aiParticipation` is `human_only`, forward to joined human routes when any exist. With no joined routes, the message remains in the inbox; Maven is not invoked.
15. Otherwise call `runChannelTurn()` with the latest conversation state. This loads public history, guidelines and tools, runs `runMavenTurn()`, strips internal tokens, and checks the saved ownership snapshot before appending the public bot reply. This check currently happens in the store before the child append; the API must not mistake it for an atomic ownership-and-append transaction. A team-help request has a narrow ownership transition allowance. Usage is incremented once for the committed bot message. Standard turns with no visible output return no reply; the contact-form holding response is not used.
16. The email handler then sends that bot reply by email to the conversation's visitor email. It sets reply headers using the incoming RFC Message-ID and stored RFC references, uses the conversation reply address, and records delivery with `markEmailed()`. It does this even when the resolved conversation originally came from the widget. Original conversation metadata is not rewritten to `email` on each inbound message.
17. An authorized teammate goes through `ingestTeammateMessage()`. This may enter Sidechat, post a human reply, or handle a bot-name command according to ownership. It is not automatically a public visitor message.
18. The processed KV marker is written after synchronous work. Maven and outgoing email run in `waitUntil`; they can still fail after the webhook returns success. The current code explicitly documents manual resend in this case.

### Existing differences from widget chat

Do not describe email as already sharing all widget guards. The inspected email visitor path gates Maven on `aiParticipation`, but does not run the widget's subscription/message-limit checks before generation. Its ban check is in new-conversation creation, not every existing-thread reply. `runChannelTurn()` accounts for usage after a reply; it does not perform those admission checks. Email also does not run the widget's visitor bot-name invocation or idle-handback path.

The API must reuse email's conversation resolution and processing structure while explicitly adding the required chat eligibility checks. These additions are proposed work, not verified current email behavior. Changes to existing email behavior require their own review; extracting shared code must not silently change it.

## Design choice

Use two interfaces with different permissions:

1. Extend the browser widget API for local drafts. It cannot establish trusted customer identity or open arbitrary threads.
2. Add a versioned, authenticated HTTP adapter for the existing inbound customer-message flow. It accepts JSON instead of reading a Resend email. It resolves into the same project conversations, appends through the same public store, and uses the existing channel-turn and joined-human delivery functions.

Do not reuse the anonymous form endpoint for trusted ingestion. The implemented adapter accepts a project API key in the bearer header. Owner/admin dashboard sessions create and revoke keys using the existing `api_keys` table; only hashes are stored. The trusted backend asserts sender email. No MCP client, OAuth consent, or tool call is needed to submit JSON. Provider-specific parsing stays in the email adapter. Preserve the existing email reply-delivery path. A new non-email reply transport is separate scope.

## 1. Widget API

Implemented examples:

```js
await ReplyMaven.ready();

ReplyMaven.open("chat", {
  message: "I need help with order ORD-123",
});

ReplyMaven.open("form", "order-support", {
  name: "Sam Lee",
  email: "sam@example.com",
  "order-number": "ORD-123",
  message: "The parcel has not arrived",
});
```

`ready()` resolves after configuration and controls are ready. It rejects if widget initialization fails. It does not create a conversation. Calls with prefill before readiness return `false`; they are not silently queued. Existing screen-only calls keep their current behavior.

`open("chat", { message })` fills the active chat composer, including the inline layout. It does not submit, create a customer or thread, notify the team, or start Maven. The visitor can edit the draft and press Send. `sendMessage(text)` retains its existing immediate-send behavior.

`open("form", formId, fields)` fills the configured contact form. `formId` is the slugified form label. The fields object directly maps slugified field labels to values, with no `fields` wrapper. Values are strings. Omitted fields stay unchanged. Partial prefilling is valid even when other required fields are empty. Required-field checks run when the visitor submits.

Both calls keep the current boolean return type. Validate before changing any draft or screen. Return `false` for a disabled form, unknown key, invalid value, or unavailable configuration. Emit one diagnostic with an error code and field keys, never field values. Return `true` after opening and applying all values.

Supplied values replace existing values, including visitor edits. Omitted fields stay unchanged. An empty string clears a supplied field or chat draft. There is no replacement option or draft-conflict check.

Closing and reopening retains drafts. Successful submission clears the submitted draft. Failed submission preserves it. `reset()` clears drafts and identity state through the existing reset path. Switching layout must not lose or duplicate the chat draft.

Existing `open()`, greeting `{ id }`, `toggle()`, `close()`, `identify()`, and `sendMessage()` remain compatible. Prefill options are supported only by `open()`. They cannot include internal customer IDs, thread IDs, tokens, or arbitrary hidden form fields. Signed `identify({ token })` remains the trusted identity mechanism.

### Form and field identifiers

Use labels as the source of identifiers. Do not add editable IDs, persistent field keys, or customer-field mapping controls.

- Form label `Order support` becomes form ID `order-support`.
- Field label `Order number` becomes field key `order-number`.
- Use the same slug function in configuration, the widget, and the server: normalize Unicode with NFKC, trim, lowercase, replace runs of characters other than Unicode letters or numbers with one hyphen, and remove leading/trailing hyphens.
- Reject empty slugs and duplicate field slugs within a form when saving configuration. Do not silently add suffixes.
- Renaming a label changes its identifier. Existing integration calls must use the new slug. Reordering fields does not change identifiers.
- Use the existing contact-form quick-action label, default `Contact form` when no such action exists. Keep the existing description and field type/required settings. This does not add a multi-form builder.
- The server derives identifiers and resolves labels from configuration. Store labels and values with each submission so later edits do not change old messages.
- Browser-entered profile details remain unverified. A supplied email must not link the visitor to another customer's history. Keep existing profile extraction behavior; no new mapping setting.
- Prefill calls use slug/value pairs. Submissions retain the existing label/value body and add the selected form slug; the server resolves its label from configuration. Old bundles can omit the form slug.

## 2. Inbound API: another interface to email inbound

Extract the existing inbound processing from the email handler so the email adapter and a JSON adapter can call it. Preserve both visitor and teammate branches. This is a refactor of existing behavior, not an additional conversation runtime.

```text
Resend event                         Backend request
  verify provider signature            authenticate caller
  fetch and parse email                validate JSON and sender authority
                 \                     /
                  normalized inbound message
                            |
                  existing conversation resolver
                            |
                  existing sender/role checks
                     /                 \
               visitor               teammate
                 |                      |
         existing public append   ingestTeammateMessage
                 |                      |
         joined humans or Maven   existing ownership / Sidechat routing
                     \                 /
                    existing reply delivery
```

### Inputs and their existing counterparts

| Requested input | Existing behavior to use |
| --- | --- |
| Submission/event ID | Email receives `email_id` from Resend and uses it for duplicate delivery checks. This is not a caller-chosen conversation ID. A backend retry identifier serves the same delivery purpose. |
| Thread ID | The existing conversation ID carried by email reply addresses/body references. Pass it to the same resolver. |
| Reply-to message ID | The public message ID extracted from email reply headers. Resolve through `getPublicMessageById()`. |
| Customer ID | Resolve the existing customer profile, not a new API customer entity. |
| Name, email, phone, custom fields | Existing customer validation, creation, update, and identity-conflict methods. |
| Sender | Verified customer identity or authorized teammate identity, corresponding to the existing email sender classification. |
| Form | JSON submissions accept a form label and field-label/value pairs as bounded message context. Widget prefilling resolves slugified labels against widget configuration. |

Do not introduce `thread.externalId`, an integration-owned namespace, or an external-thread mapping table as part of this baseline. Thread references route to the same public conversation and private Sidechat already used by email and the widget.

Inbound email does not accept an arbitrary caller-defined thread ID for creating a conversation. It recognizes existing ReplyMaven conversation UUIDs in reply addresses/body references and existing public message IDs in reply headers. When nothing resolves, the existing create method generates the conversation UUID. Keep that behavior in the API. Do not add a new-ID creation option or alias mapping as a prerequisite.

### Resolution and sender checks

Reuse the ordered email resolver: referenced public message, explicit conversation reference, body reference when present, recent open conversation by sender email, then create. Use the same seven-day constant, project scope, archived-stop behavior, and closed-thread reopening path. Do not add form-, subject-, or integration-based threading.

Keep sender classification after resolution. A conversation reference is not permission to write to it. An authorized teammate must remain able to use the existing teammate route; do not force their message into the customer transcript. Preserve forwarding behavior for a verified teammate starting a new conversation without a customer.

Use API authentication for the JSON endpoint. The authenticated backend submits the sender email; the existing project owner/member and conversation visitor checks determine routing, as for email inbound. API authorization must cover this project and submitting on behalf of that sender. A public unauthenticated email or role field grants no access. Key management uses the existing table and a section in Project settings, as defined in the API-key plan.

Email is required in the API request. If a customer ID is also supplied, resolve the existing profile and validate it against the supplied email using the existing identity conflict rules. Requests without email fail validation. There is no email-less threading or delivery path in this feature.

### Customer fields

Expose the existing writable fields: name, email, phone, external ID, and custom fields. Reuse their current validation limits and conflict rules. Do not introduce new merge semantics for this endpoint without a demonstrated need.

Use the existing customer linking service. Its operation links the visitor identity and can update that visitor's other conversations; preserve its conflict checks. Validate sender and conversation before changing identity information. A teammate's sender details must not overwrite the customer profile.

### Store, process, and reply

Visitor messages use the existing public conversation store and child Agent. Keep the same inbox projection, customer activity updates, joined-human routing, Maven channel turn, ownership rules, and team-help behavior.

Teammate messages use `ingestTeammateMessage()` and the existing adapter/Sidechat path. This includes human replies and bot-name commands where the existing ownership rules allow them.

Keep existing email reply delivery as the baseline, including public reply storage, RFC references, conversation reply address, and `markEmailed()`. Do not replace this with a new polling API, receipt service, or callback delivery system merely because the input arrived over HTTP. A separate non-email reply transport is additional scope, not implied by the new input endpoint.

The HTTP response acknowledges inbound processing; it does not claim that the background Maven turn or email delivery has completed. Reuse the existing event-ID and message-level duplicate handling. Document its actual limitations: the KV marker is not an atomic concurrent lock, and background work can fail after acknowledgment. Do not promise durable retries or exactly-once tool execution that the existing path does not provide.

### Maven context

Maven must receive the form label and submitted field labels/values, and know the request came through the API. Prefer a bounded submission block using the existing content path. Treat it as sender-provided data. Do not create new message columns or a new conversation channel solely to carry that context without checking the existing content/metadata contract.

The confirmed requirement is that Maven answers when allowed. The email path and widget path currently differ in their admission checks, as documented above. Review that gap explicitly; do not describe a full gate refactor as an automatic part of exposing the input interface.

## 3. Scope and implementation boundary

Included:

- Widget prefilling, using slugified labels and direct field values.
- A JSON input adapter into the existing inbound flow.
- Existing customer fields exposed through that adapter.
- Existing conversation/message references and visitor/teammate routing.
- Existing public storage, inbox, Maven, Sidechat, and email delivery.

Removed from the proposal:

- Separate integration-owned conversations or thread aliases.
- New API credential storage as an assumed requirement.
- New receipt endpoints, polling endpoints, delivery queues, or turn journals.
- New customer/conversation tables or message columns without a specific proven gap.
- The customer-only restriction.

No database migration is prescribed. This is not a promise that no schema or type change will be needed. Establish the exact existing-contract gap before proposing one.

Confirmed scope: required email, API authentication, existing email threading and sender classification, and server-generated IDs for new conversations. Existing IDs are optional routing references. Event IDs serve duplicate delivery handling, not a separate thread identity system.

## 4. Verification and checkpoints

Implementation is authorized. Use local commit checkpoints. Do not push, deploy, or migrate.

Use browser click-through for prefilling and submission. Verify unchanged email behavior alongside API behavior: referenced-message routing, seven-day fallback into widget conversations, archived stops, closed-thread reopening, unrelated sender rejection, authorized teammate messages, joined-human forwarding, Maven replies, and actual email reply headers/delivery. Check duplicate delivery against the guarantees actually implemented.

Run the required build/lint checks for implementation. Do not write tests under the repository instructions.

## Source map

- `widget/index.ts`: screen opening, contact form controls/submission, message sending, identify/reset.
- `worker/index.ts`: Resend verification and parsing, plus JSON route mounting.
- `worker/services/process-inbound-message.ts`: extracted resolution, customer creation, visitor/teammate routing, Maven and email delivery.
- `worker/routes/inbound-message-handlers.ts`: authenticated JSON adapter and profile updates.
- `worker/services/inbound-email-routing.ts:224`: ordered resolver and archived-stop behavior; seven-day constant at 33.
- `worker/services/email-service.ts:269`: recognized ReplyMaven message references; outbound reply headers at 539.
- `worker/agents/maven/conversation-directory.ts:367`: exact sender-email fallback query.
- `worker/services/ingest-teammate-message.ts`: teammate ownership and Sidechat routing.
- `worker/services/run-agent-channel-outbound.ts`: delivery only to joined human routes.
- `worker/agents/maven/public/public-turn.ts`: widget turn gates and idle takeover.
- `shared/maven-conversation.ts`: channel/origin contracts and channel fallback.
- `worker/validation.ts`: customer, form, and conversation validation.
- `worker/services/widget-service.ts` and `contact-form-service.ts`: configured form payload and persistence.
- `worker/services/customer-identity-service.ts` and `customer-service.ts`: identity resolution, conflict handling, profiles and links.
- `worker/db/schema.ts` and `shared/customer-types.ts`: stored customer fields and current API shapes.
- `worker/conversations/agent-public-conversation-store.ts`: public creation and append operations.
- `worker/agents/maven/maven-project-agent.ts`, `conversation-directory.ts`, and `maven-chat-agent.ts`: registry, directory, serialized public state, and chat turns.
- `worker/chat-runtime/contact-support/contact-support.ts` and `orchestration/run-channel-turn.ts`: form message context and existing channel-turn behavior.
