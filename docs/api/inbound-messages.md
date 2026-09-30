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

## Local verification

Forced TypeScript, app build, widget build, lint, and browser draft checks are recorded in the implementation plan. Live Maven generation and outbound email delivery have not been exercised for this endpoint. No production requests, migrations, or deployment are part of this change.
