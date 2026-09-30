import type { Context } from "hono";
import type { HonoAppContext } from "../types";
import { ApiKeyService } from "../services/api-key-service";
import { ProjectService } from "../services/project-service";
import { inboundMessageSchema } from "../validation";
import { createPublicConversationStore } from "../conversations/create-public-conversation-store";
import { BillingService } from "../services/billing-service";
import { BodyTooLargeError, readLimitedBody } from "../lib/read-limited-body";
import { CustomerService } from "../services/customer-service";
import { CustomerIdentityService } from "../services/customer-identity-service";
import { ChannelIdentityService } from "../services/channel-identity-service";
import { processInboundMessage, type InboundMessageInput } from "../services/process-inbound-message";

export async function handleInboundMessage(
  c: Context<HonoAppContext>,
  helpers: Pick<InboundMessageInput, "checkRateLimit" | "broadcastCustomerChanges">,
): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const db = c.get("db");
  const projectId = c.req.param("projectId");
  const authorization = c.req.header("authorization") ?? "";
  const key = authorization.length <= 520 ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
  const credential = key ? await new ApiKeyService(db).authenticate(projectId, key) : null;
  if (!credential) return c.json({ error: "Invalid or missing API key" }, 401);
  const project = await new ProjectService(db).getProjectById(projectId);
  if (!project) return c.json({ error: "Invalid or missing API key" }, 401);
  if (!helpers.checkRateLimit(`inbound-api:${project.id}:${credential.keyId}`, 30, 60_000)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  let body: unknown;
  try {
    const bytes = await readLimitedBody(c.req.raw.body, 512_000, c.req.header("content-length"));
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return c.json({ error: "Request is too large" }, 413);
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = inboundMessageSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const data = parsed.data;
  if (!c.env.RESEND_API_KEY) {
    return c.json({ error: "Email delivery is not configured" }, 503);
  }

  const store = createPublicConversationStore({ db: db, env: c.env });
  const identities = new CustomerIdentityService(db, store);
  const customers = new CustomerService(db, store);
  const teammate = await new ChannelIdentityService(db).resolveByEmail({
    projectId: project.id, ownerId: project.userId, email: data.email,
  });
  // The project key trusts this backend to assert the sender's email.
  // The shared email processor still checks teammate membership and ownership.
  if (!teammate) {
    const billing = new BillingService(db, c.env);
    const subscription = await billing.getSubscriptionByUserId(project.userId);
    if (!subscription || !billing.isSubscriptionActive(subscription)) {
      return c.json({ error: "Subscription is inactive" }, 503);
    }
    if (!(await billing.checkMessageLimit(project.userId, subscription)).allowed) {
      return c.json({ error: "Message limit reached" }, 429);
    }
  }
  const resolution = await identities.resolveCustomer(project.id, {
    email: data.email, externalId: data.externalId,
  });
  if (resolution.kind === "conflict") return c.json({ error: "Customer identity conflict" }, 409);
  if (data.customerId) {
    const customer = await customers.getCustomerDetail(project.id, data.customerId);
    if (!customer) return c.json({ error: "Customer not found" }, 404);
    if (
      (customer.email && customer.email.toLowerCase() !== data.email) ||
      (resolution.kind === "resolved" && resolution.customerId !== customer.id) ||
      (data.externalId && customer.externalId && data.externalId !== customer.externalId)
    ) return c.json({ error: "Customer identity conflict" }, 409);
  }

  // Supply direct references to the existing email resolver. JSON bodies are
  // already message text, so they must not go through email quote stripping.
  const emailId = `api:${project.id}:${data.messageId ?? crypto.randomUUID()}`;
  const idempotencyKey = `inbound-email:${emailId}`;
  if (await c.env.CONVERSATIONS_CACHE.get(idempotencyKey)) {
    return c.json({ ok: true, duplicate: true });
  }
  const formLines = data.form
    ? [`Form: ${data.form.label}`, ...Object.entries(data.form.fields).map(([label, value]) => `${label}: ${value}`)]
    : [];
  const content = [data.text, ...formLines, "[Submitted via API]"].join("\n\n");
  return processInboundMessage(c, {
    ...helpers,
    project, emailId, senderEmail: data.email, senderName: data.name ?? null,
    envelopeRecipient: {
      raw: `${project.slug}@updates.replymaven.com`,
      slug: project.slug,
      conversationId: data.conversationId ?? null,
    },
    emailText: data.text,
    cleanedText: data.text,
    headers: {},
    replyToMessageId: data.replyToMessageId,
    subject: data.subject ?? null,
    rfcMessageId: null,
    inboundAttachments: [],
    originatingAddress: null,
    inboundAddress: `${project.slug}@updates.replymaven.com`,
    idempotencyKey,
    api: {
      customer: {
        id: data.customerId, email: data.email, name: data.name,
        phone: data.phone, externalId: data.externalId,
        customFields: data.customFields ?? {},
      },
      visitorText: content,
      async prepareVisitor(conversation) {
        let customerId = data.customerId ??
          (resolution.kind === "resolved" ? resolution.customerId : conversation.customerId);
        if (!customerId) {
          const created = await identities.createCustomer(project.id, {
            email: data.email, name: data.name, phone: data.phone,
            externalId: data.externalId, customFields: data.customFields ?? {},
          });
          if (created.kind === "created") customerId = created.customer.id;
          else if (created.kind === "existing_customer") customerId = created.customerId;
          else return c.json({ error: "Customer identity conflict" }, 409);
        }
        if (conversation.customerId && conversation.customerId !== customerId) {
          return c.json({ error: "Conversation belongs to a different customer" }, 409);
        }
        const existing = await customers.getCustomerDetail(project.id, customerId);
        if (!existing) return c.json({ error: "Customer not found" }, 404);
        if (data.externalId && existing.externalId && data.externalId !== existing.externalId) {
          return c.json({ error: "Customer identity conflict" }, 409);
        }
        const linked = await identities.linkConversation(project.id, conversation.id, customerId);
        if (linked.kind !== "linked") return c.json({ error: "Customer identity conflict" }, 409);
        const updated = await identities.updateCustomer(project.id, customerId, {
          name: data.name,
          email: data.email,
          phone: data.phone,
          externalId: data.externalId,
          customFields: data.customFields,
        });
        if (updated.kind !== "updated") return c.json({ error: "Customer identity conflict" }, 409);
        conversation.customerId = customerId;
        helpers.broadcastCustomerChanges(c, project.id, [customerId]);
        return null;
      },
    },
  });
}
