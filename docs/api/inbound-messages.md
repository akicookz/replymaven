# Inbound messages API

`POST /api/v1/projects/:projectId/inbound/messages`

This JSON endpoint calls the same processing function as inbound email. It uses existing customers, conversations, public transcripts, teammate routing, Maven, and outbound email. It adds no tables or migrations.

## Authentication

Create a key in **Project settings → API keys** using an owner or admin dashboard account. Give it a label and copy the full key when it appears. It is shown once. Lists show only its label, prefix, and creation date; storage contains its SHA-256 hash.

Send `Authorization: Bearer <api_key>` from your backend. Keys work only for their project and this inbound endpoint. Browser sessions and MCP OAuth tokens are not accepted here. MCP keeps its existing OAuth flow.

Keep keys on your server, never in widget code. A key represents a trusted project integration. Your backend must authenticate the sender before submitting their email. It can submit customer messages or messages from an existing authorized teammate; existing email membership, project access, ownership, and Sidechat rules still apply. The key creator is not the message author.

Keys do not expire automatically. To rotate one, create a replacement, update your integration, then revoke the old key. Revocation stops subsequent authentication; work already accepted may finish. Widget customer-signing secrets remain separate: they sign browser identity tokens and cannot authenticate this endpoint.

```sh
curl https://replymaven.com/api/v1/projects/PROJECT_ID/inbound/messages \
  -H "Authorization: Bearer $REPLYMAVEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"sam@example.com","text":"The parcel has not arrived"}'
```

## Request

```json
{
  "email": "sam@example.com",
  "text": "The parcel has not arrived",
  "name": "Sam Lee",
  "externalId": "customer-123",
  "customFields": { "order_id": "ORD-123" },
  "messageId": "delivery-event-123",
  "form": {
    "label": "Order support",
    "fields": { "Order number": "ORD-123" }
  }
}
```

Only `email` and `text` are required. Email is normalized to lowercase. Text is trimmed, must not be empty, and has a 20,000-character limit. JSON bodies are limited to 512,000 bytes.

| Field | Meaning |
| --- | --- |
| `name`, `phone` | Existing customer profile fields. Omission preserves a stored value; null clears it. |
| `externalId` | Existing project-scoped customer external ID. Optional, 1–255 characters. |
| `customerId` | Optional existing customer ID from this project. It must agree with the email and external ID. It does not create a caller-chosen customer ID. |
| `customFields` | Existing customer custom fields: string, finite number, boolean, or null values. A supplied object replaces the stored object; omission preserves it. |
| `messageId` | Optional caller event ID, 1–100 characters, reused for retries. It is not the returned public message ID or a new thread ID. Omission generates an event ID. |
| `conversationId` | Optional existing ReplyMaven conversation UUID, equivalent to the reference in an email reply address. |
| `replyToMessageId` | Optional existing public message ID, equivalent to an email reply reference. |
| `subject` | Optional email subject, up to 200 characters. |
| `form` | Optional sender-provided form label and field-label/value pairs. At most ten fields. Label limits are 100 characters; values are strings up to 5,000 characters. This does not change widget configuration. |

Visitor transcript content includes the supplied form label/values and an API source marker. Form context is customer content, not a private instruction. Teammate text remains unchanged so existing bot-name commands keep working. Teammate submissions do not update customer profiles.

## Threading and replies

Resolution follows inbound email: reply-to message, explicit conversation, a recognized conversation reference in the text, then the latest open conversation for this sender email active within seven days. An unresolved reference falls through. An archived explicit match returns 410. With no match, the existing store generates a new conversation ID. The fallback can find a conversation that started in the widget. Subject and form label do not partition threads.

The sender must be the conversation's visitor or an authorized teammate. Existing closed conversations can reopen. Customer identity conflicts return 409. Visitor messages use the normal public transcript. Teammate messages use existing ownership and Sidechat routing, including forwarded messages that start a customerless conversation.

The API checks active subscription/message allowance and blocked visitors. Human-owned conversations follow existing joined-human routing. Otherwise Maven runs through the existing channel turn and replies by email. A submission alone does not request escalation. Email delivery must be configured.

## Response and retries

A processed request returns HTTP 202:

```json
{
  "ok": true,
  "conversationId": "existing-or-created-conversation-uuid",
  "messageId": "stored-public-message-id"
}
```

For teammate ingestion, `messageId` is null because the shared teammate flow may route into Sidechat or handle a command rather than append a public visitor message. HTTP 202 does not mean Maven or email delivery has finished.

Duplicate requests return HTTP 200 with `ok: true, duplicate: true`. A transcript duplicate can also include `conversationId`; the KV duplicate response does not include IDs. Reuse the same caller `messageId` on retries. The shared email flow uses a 24-hour KV processed marker plus transcript deduplication. Recent equal content can be treated as a duplicate even under a different event ID. These checks do not provide an atomic concurrent lock or exactly-once Maven/tool execution. Background delivery can fail after acknowledgement, as it can for inbound email.

Errors use `{ "error": "..." }`: 400 invalid input, 401 missing/invalid/revoked key or wrong project, 403 sender permission or blocked customer, 404 customer not found, 409 identity conflict, 410 archived conversation, 413 oversized body, 429 request/creation/message limit, 503 inactive subscription or missing email configuration. The request limit is 30/minute per project and key; email's new-conversation limit is eight/hour per sender and project.

## Verification, 2026-09-30

Ran the real built Worker locally with isolated D1, KV, R2, and conversation Agents. The database contained only synthetic projects, accounts, and customer data. Maven used the configured real Gemini model. Email used the real Resend API and its [documented test recipients](https://resend.com/docs/dashboard/emails/send-test-emails), `delivered+inbound-customer@resend.dev` and `delivered+inbound-owner@resend.dev`. Resend simulates mailbox delivery for these addresses; this does not prove delivery to a normal Gmail or Outlook inbox.

| Check | Observed result |
| --- | --- |
| Initial inbound request with email, name, phone, external ID, custom fields, and form context | 202; one customer and public conversation created; visitor message stored with the form label, order number, and API marker. |
| Maven response and outbound email | Real model reply stored and marked emailed; Resend reported `delivered`. |
| Reply using the returned public message ID | 202 in the same conversation; Maven correctly recalled `SYNTHETIC-123` from the original form; its second email was delivered. |
| Retry using the same event ID under a replacement API key | 200 with `duplicate: true`; no extra visitor message or Maven reply. |
| Recent-email fallback, explicit conversation ID, and body reference | All returned the existing conversation ID. |
| Customer update | Name changed; explicit null cleared phone; supplied custom fields replaced the object; later omitted fields remained unchanged. |
| Unrelated sender on an existing conversation | 403; no message added. |
| Conflicting customer ID and email | 409; no profile reassignment. |
| Human ownership | Customer messages stored without Maven replies. A closed thread reopened with its human assignment retained. |
| Human takeover during an in-flight Maven turn | The ownership check suppressed the pending public bot reply. |
| Teammate plain reply | Stored as an agent message with the verified teammate user ID; existing Sidechat offered email delivery privately. |
| Named teammate command | With the bot name configured, `@Maven` entered Sidechat, stayed out of the public transcript, and received a delivered private email. Customer name and custom fields were unchanged. |
| Joined-human forwarding | A later customer message was delivered by email to the joined synthetic teammate; Maven did not answer publicly. |
| Teammate starting a thread | Created a customerless conversation with an empty public transcript; Sidechat handled the note and sent a delivered private response. |
| Blocked visitor | 403. |
| Explicit archived reference | 410. A later message without the archived reference created a new conversation for the same customer. |
| Revocation cleanup | Both verification keys revoked; a valid inbound payload using the revoked key returned 401. |

Delivery evidence: initial customer reply `01a0f242-2dad-72bd-9fa1-f31566e00b9e`; context follow-up `01a0f243-25f9-77c0-9c77-83d98c5831bf`; private teammate reply `01a0f246-628b-7608-a7b9-434e6cbe1a06`; joined-human forward `01a0f247-389f-7dbf-a554-fe8d598fe204`; customerless-thread reply `01a0f247-5550-7627-980a-7c1b86c59c75`. Each was retrieved from Resend with `last_event: delivered` and the expected recipient, content, subject, and conversation reply address. Public reply records also retained their resolved RFC message IDs.

Fixture correction: the clean database initially omitted default project settings. Setting a bot name against that missing row did not persist it, so the first `@Maven` checks followed the ordinary human-reply path. After adding the default settings rows created by normal project setup, the named-command check passed. No application code change was needed.

This run did not verify production deployment, normal mailbox placement, provider webhook round-trips back into the local Worker, concurrent exactly-once execution, or all time/rate-limit boundaries. No production customer records were used. No migrations, deployment, or new automated tests were part of this run.
