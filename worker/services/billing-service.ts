import Stripe from "stripe";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, asc, gt, sql } from "drizzle-orm";
import {
  subscriptions,
  usage,
  messageUsageCredits,
  messageCreditGrants,
  projects,
  projectSettings,
  type SubscriptionRow,
  type UsageRow,
  type MessageCreditGrantRow,
} from "../db";
import { createPublicConversationStore } from "../conversations/create-public-conversation-store";
import type { PublicConversationStore } from "../conversations/public-conversation-store";
import { users } from "../db/auth.schema";
import {
  type AppEnv,
  type Plan,
  type BillingInterval,
  type Entitlements,
} from "../types";
import {
  MESSAGE_PACKS,
  MESSAGE_PACK_VALID_MONTHS,
  PLANS,
  TRIAL_AI_MESSAGES,
  isPlanId,
  parseLimitOverrides,
  planLimits,
  type MessagePack,
  type PlanId,
} from "../../shared/plans";
import {
  EmailService,
  type SubscriptionInactiveReason,
} from "./email-service";
import { TelegramService } from "./telegram-service";

// ─── Plan Resolution ──────────────────────────────────────────────────────────

/** Maps stored plan ids, including pre-v2 "starter" and "standard", to a catalog plan. */
export function normalizePlanId(stored: string): PlanId {
  if (isPlanId(stored)) return stored;
  return "business";
}

/** Entitlements for a subscription row; Enterprise reads its contract overrides. */
export function entitlementsFor(sub: SubscriptionRow): Entitlements {
  const plan = normalizePlanId(sub.plan);
  const overrides = plan === "enterprise" ? parseLimitOverrides(sub.limitOverrides) : null;
  const limits = planLimits(plan, overrides);
  if (plan !== "enterprise" && limits.seats !== null) {
    limits.seats += Math.max(0, sub.extraSeats);
  }
  return {
    plan,
    trialing: sub.status === "trialing",
    limits,
    features: PLANS[plan].features,
  };
}

/** Monthly AI messages before packs; null means not enforced. Trials are capped. */
export function messageAllowance(entitlements: Entitlements): number | null {
  const limit = entitlements.limits.aiMessagesPerMonth;
  if (!entitlements.trialing) return limit;
  return limit === null ? TRIAL_AI_MESSAGES : Math.min(limit, TRIAL_AI_MESSAGES);
}

// ─── Price Map Builder ────────────────────────────────────────────────────────

interface PriceMapping {
  plan: Plan;
  interval: BillingInterval;
}

function buildPriceMaps(env: AppEnv) {
  const entries: Array<{
    priceId: string | undefined;
    plan: Plan;
    interval: BillingInterval;
  }> = [
    { priceId: env.STRIPE_BUSINESS_MONTHLY_PRICE_ID, plan: "business", interval: "monthly" },
    { priceId: env.STRIPE_BUSINESS_ANNUAL_PRICE_ID, plan: "business", interval: "annual" },
  ];

  const priceToMapping = new Map<string, PriceMapping>();
  const planIntervalToPrice = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.priceId) continue;
    priceToMapping.set(entry.priceId, {
      plan: entry.plan,
      interval: entry.interval,
    });
    planIntervalToPrice.set(`${entry.plan}:${entry.interval}`, entry.priceId);
  }

  const packPrices = new Map<MessagePack["id"], string>();
  const packEnv: Record<MessagePack["id"], string | undefined> = {
    pack_500: env.STRIPE_PACK_500_PRICE_ID,
    pack_1100: env.STRIPE_PACK_1100_PRICE_ID,
    pack_5500: env.STRIPE_PACK_5500_PRICE_ID,
  };
  for (const pack of MESSAGE_PACKS) {
    const priceId = packEnv[pack.id];
    if (priceId) packPrices.set(pack.id, priceId);
  }

  const seatPrices = new Map<BillingInterval, string>([
    ["monthly", env.STRIPE_SEAT_MONTHLY_PRICE_ID],
    ["annual", env.STRIPE_SEAT_ANNUAL_PRICE_ID],
  ]);

  return { priceToMapping, planIntervalToPrice, packPrices, seatPrices };
}

// ─── Billing Service ──────────────────────────────────────────────────────────

export class BillingService {
  private stripe: Stripe;
  private priceToMapping: Map<string, PriceMapping>;
  private planIntervalToPrice: Map<string, string>;
  private packPrices: Map<MessagePack["id"], string>;
  private seatPrices: Map<BillingInterval, string>;
  private conversationStore: PublicConversationStore;

  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private env: AppEnv,
    conversationStore?: PublicConversationStore,
  ) {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    const maps = buildPriceMaps(env);
    this.priceToMapping = maps.priceToMapping;
    this.planIntervalToPrice = maps.planIntervalToPrice;
    this.packPrices = maps.packPrices;
    this.seatPrices = maps.seatPrices;
    this.conversationStore = conversationStore ??
      createPublicConversationStore({ db, env });
  }

  // ─── Price Resolution ─────────────────────────────────────────────────────

  resolvePriceId(priceId: string): PriceMapping | null {
    return this.priceToMapping.get(priceId) ?? null;
  }

  getPriceIdForPlan(plan: Plan, interval: BillingInterval): string | null {
    return this.planIntervalToPrice.get(`${plan}:${interval}`) ?? null;
  }


  // ─── Stripe Customer ─────────────────────────────────────────────────────

  async getOrCreateStripeCustomer(
    userId: string,
    email: string,
    name: string | null,
  ): Promise<string> {
    // Check if user already has a subscription with a stripeCustomerId
    const existing = await this.getSubscriptionByUserId(userId);
    if (existing) return existing.stripeCustomerId;

    // Reuse an existing Stripe customer for this user when available
    const existingCustomerId = await this.findStripeCustomerByEmailAndUserId(
      email,
      userId,
    );
    if (existingCustomerId) return existingCustomerId;

    // Create a new Stripe customer
    const customer = await this.stripe.customers.create({
      email,
      name: name ?? undefined,
      metadata: { userId },
    });

    return customer.id;
  }

  private async findStripeCustomerByEmailAndUserId(
    email: string,
    userId: string,
  ): Promise<string | null> {
    let startingAfter: string | undefined;

    while (true) {
      const customers = await this.stripe.customers.list({
        email,
        limit: 100,
        starting_after: startingAfter,
      });

      for (const customer of customers.data) {
        if ("deleted" in customer && customer.deleted) continue;
        if (customer.metadata.userId === userId) return customer.id;
      }

      if (!customers.has_more || customers.data.length === 0) return null;
      startingAfter = customers.data[customers.data.length - 1]?.id;
      if (!startingAfter) return null;
    }
  }

  // ─── Subscription CRUD ────────────────────────────────────────────────────

  async getSubscriptionByUserId(
    userId: string,
  ): Promise<SubscriptionRow | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getSubscriptionByStripeId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getSubscriptionByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<SubscriptionRow | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return rows[0] ?? null;
  }

  async createSubscription(data: {
    userId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    plan: Plan;
    interval: BillingInterval;
    status: SubscriptionRow["status"];
    trialEndsAt?: Date | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
  }): Promise<SubscriptionRow> {
    const id = crypto.randomUUID();
    await this.db.insert(subscriptions).values({
      id,
      userId: data.userId,
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      plan: data.plan,
      interval: data.interval,
      status: data.status,
      trialEndsAt: data.trialEndsAt,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
    });
    return (await this.getSubscriptionByUserId(data.userId))!;
  }

  async updateSubscription(
    id: string,
    updates: Partial<
      Pick<
        SubscriptionRow,
        | "stripeSubscriptionId"
        | "plan"
        | "interval"
        | "status"
        | "trialEndsAt"
        | "currentPeriodStart"
        | "currentPeriodEnd"
        | "cancelAtPeriodEnd"
        | "extraSeats"
      >
    >,
  ): Promise<void> {
    await this.db
      .update(subscriptions)
      .set(updates)
      .where(eq(subscriptions.id, id));
  }

  // ─── Checkout & Portal ────────────────────────────────────────────────────

  async createCheckoutSession(
    userId: string,
    email: string,
    name: string | null,
    plan: Exclude<Plan, "enterprise">,
    interval: BillingInterval,
    successUrl: string,
    cancelUrl: string,
  ): Promise<Stripe.Checkout.Session> {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(
      userId,
      email,
      name,
    );
    const priceId = this.getPriceIdForPlan(plan, interval);
    if (!priceId) throw new Error(`Invalid plan/interval: ${plan}/${interval}`);

    return this.stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
        metadata: { userId, plan, interval },
      },
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, plan, interval },
    });
  }

  async createPackCheckoutSession(
    userId: string,
    email: string,
    name: string | null,
    packId: MessagePack["id"],
    successUrl: string,
    cancelUrl: string,
  ): Promise<Stripe.Checkout.Session> {
    const priceId = this.packPrices.get(packId);
    if (!priceId) throw new Error(`Pack not configured: ${packId}`);
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId, email, name);
    return this.stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, kind: "message_pack", packId },
    });
  }

  /** Ends a trial now so the plan is charged and the full allowance unlocks. */
  async startPlanNow(sub: SubscriptionRow): Promise<void> {
    if (sub.status !== "trialing" || !sub.stripeSubscriptionId) return;
    await this.stripe.subscriptions.update(sub.stripeSubscriptionId, { trial_end: "now" });
  }

  /**
   * Sets the number of seats bought on top of the plan. The seat item uses the
   * plan's interval, and Stripe prorates the change on the next invoice.
   */
  async setExtraSeats(sub: SubscriptionRow, extraSeats: number): Promise<void> {
    if (!sub.stripeSubscriptionId) throw new Error("No Stripe subscription");
    const seatPriceIds = new Set(this.seatPrices.values());
    const stripeSub = await this.stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const seatItem = stripeSub.items.data.find((item) => seatPriceIds.has(item.price.id));

    if (extraSeats === 0) {
      if (seatItem) await this.stripe.subscriptionItems.del(seatItem.id);
    } else if (seatItem) {
      await this.stripe.subscriptionItems.update(seatItem.id, { quantity: extraSeats });
    } else {
      const price = this.seatPrices.get(sub.interval);
      if (!price) throw new Error(`Seat price not configured: ${sub.interval}`);
      await this.stripe.subscriptionItems.create({
        subscription: sub.stripeSubscriptionId,
        price,
        quantity: extraSeats,
      });
    }

    await this.updateSubscription(sub.id, { extraSeats });
  }

  async createPortalSession(
    stripeCustomerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    return this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
  }

  // ─── Webhook Handling ─────────────────────────────────────────────────────

  async constructEvent(
    rawBody: string,
    signature: string,
  ): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "customer.subscription.updated":
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "invoice.paid":
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await this.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
    }
  }

  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    if (session.metadata?.kind === "message_pack") {
      await this.grantMessagePack(session);
      return;
    }
    const userId = session.metadata?.userId;
    const metadataPlan = session.metadata?.plan;
    const plan = isPlanId(metadataPlan) ? metadataPlan : undefined;
    const interval = session.metadata?.interval as BillingInterval | undefined;
    if (!userId || !plan || !interval) return;

    const stripeCustomerId = session.customer as string;
    const stripeSubscriptionId = session.subscription as string;

    // Fetch the Stripe subscription for trial/status details
    const stripeSub =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

    // In Clover API, period info is on the latest invoice
    const periodDates = await this.getSubscriptionPeriod(stripeSub);

    const existing = await this.getSubscriptionByUserId(userId);
    if (existing) {
      await this.updateSubscription(existing.id, {
        stripeSubscriptionId,
        plan,
        interval,
        status: stripeSub.status === "trialing" ? "trialing" : "active",
        trialEndsAt: stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000)
          : null,
        currentPeriodStart: periodDates.start,
        currentPeriodEnd: periodDates.end,
      });
    } else {
      await this.createSubscription({
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        plan,
        interval,
        status: stripeSub.status === "trialing" ? "trialing" : "active",
        trialEndsAt: stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000)
          : null,
        currentPeriodStart: periodDates.start,
        currentPeriodEnd: periodDates.end,
      });
    }
  }

  /**
   * In Stripe Clover API, current_period_start/end are no longer on the
   * Subscription object. We derive period from the latest invoice or
   * fall back to billing_cycle_anchor + start_date.
   */
  private async getSubscriptionPeriod(
    stripeSub: Stripe.Subscription,
  ): Promise<{ start: Date; end: Date }> {
    // Try to get period from the latest invoice
    const latestInvoiceId =
      typeof stripeSub.latest_invoice === "string"
        ? stripeSub.latest_invoice
        : stripeSub.latest_invoice?.id;

    if (latestInvoiceId) {
      const invoice = await this.stripe.invoices.retrieve(latestInvoiceId);
      return {
        start: new Date(invoice.period_start * 1000),
        end: new Date(invoice.period_end * 1000),
      };
    }

    // Fallback: use start_date and billing_cycle_anchor
    return {
      start: new Date(stripeSub.start_date * 1000),
      end: new Date(stripeSub.billing_cycle_anchor * 1000),
    };
  }

  private async handleSubscriptionUpdated(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const existing = await this.getSubscriptionByStripeId(stripeSub.id);
    if (!existing) return;

    // Resolve plan/interval from the plan item; the seat item only sets a quantity.
    const seatPriceIds = new Set(this.seatPrices.values());
    const planItem = stripeSub.items.data.find((item) => !seatPriceIds.has(item.price.id));
    const seatItem = stripeSub.items.data.find((item) => seatPriceIds.has(item.price.id));
    const mapping = planItem ? this.resolvePriceId(planItem.price.id) : null;

    const statusMap: Record<string, SubscriptionRow["status"]> = {
      trialing: "trialing",
      active: "active",
      past_due: "past_due",
      canceled: "canceled",
      unpaid: "unpaid",
      incomplete: "incomplete",
    };

    const periodDates = await this.getSubscriptionPeriod(stripeSub);

    const newStatus = statusMap[stripeSub.status] ?? "active";
    const wasActive = this.isSubscriptionActive(existing);

    // Self-serve prices map to a plan. Contract prices are not in the map, so an
    // Enterprise row keeps its plan unless the subscription metadata says otherwise.
    const metadataPlan = stripeSub.metadata?.plan;
    const plan = mapping?.plan ?? (isPlanId(metadataPlan) ? metadataPlan : existing.plan);

    await this.updateSubscription(existing.id, {
      status: newStatus,
      plan,
      interval: mapping?.interval ?? existing.interval,
      trialEndsAt: stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000)
        : null,
      currentPeriodStart: periodDates.start,
      currentPeriodEnd: periodDates.end,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      extraSeats: seatItem?.quantity ?? 0,
    });

    // Notify user if subscription became inactive
    const isNowActive = newStatus === "active" || newStatus === "trialing";
    if (wasActive && !isNowActive) {
      const reason: SubscriptionInactiveReason =
        newStatus === "past_due"
          ? "payment_failed"
          : newStatus === "canceled"
            ? "canceled"
            : "other";
      await this.notifySubscriptionInactive(existing.userId, reason);
    } else if (!wasActive && isNowActive) {
      await this.notifySubscriptionRecovered(existing.userId);
    }
  }

  private async handleSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const existing = await this.getSubscriptionByStripeId(stripeSub.id);
    if (!existing) return;

    await this.updateSubscription(existing.id, {
      status: "canceled",
      cancelAtPeriodEnd: false,
    });

    await this.notifySubscriptionInactive(existing.userId, "canceled");
  }

  /**
   * Extract the subscription ID from an Invoice in the Clover API.
   * In Clover, invoice.subscription is replaced by invoice.parent.subscription_details.subscription.
   */
  private getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
    const subDetails = invoice.parent?.subscription_details;
    if (!subDetails) return null;
    return typeof subDetails.subscription === "string"
      ? subDetails.subscription
      : (subDetails.subscription?.id ?? null);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const stripeSubscriptionId = this.getSubscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return;

    const existing = await this.getSubscriptionByStripeId(stripeSubscriptionId);
    if (!existing) return;

    // Update period dates from the paid invoice
    const updates: Partial<
      Pick<
        SubscriptionRow,
        "status" | "currentPeriodStart" | "currentPeriodEnd"
      >
    > = {
      currentPeriodStart: new Date(invoice.period_start * 1000),
      currentPeriodEnd: new Date(invoice.period_end * 1000),
    };

    // Only update to active if currently trialing or past_due
    const wasPastDue = existing.status === "past_due";
    if (existing.status === "trialing" || wasPastDue) {
      updates.status = "active";
    }

    await this.updateSubscription(existing.id, updates);

    // Notify recovery if subscription was past_due (payment issue resolved)
    if (wasPastDue) {
      await this.notifySubscriptionRecovered(existing.userId);
    }
  }

  private async handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const stripeSubscriptionId = this.getSubscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return;

    const existing = await this.getSubscriptionByStripeId(stripeSubscriptionId);
    if (!existing) return;

    await this.updateSubscription(existing.id, { status: "past_due" });

    await this.notifySubscriptionInactive(existing.userId, "payment_failed");
  }

  // ─── Message Packs ────────────────────────────────────────────────────────

  private async grantMessagePack(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.userId;
    const pack = MESSAGE_PACKS.find((p) => p.id === session.metadata?.packId);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!userId || !pack || !paymentIntentId || session.payment_status !== "paid") return;

    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + MESSAGE_PACK_VALID_MONTHS);
    await this.db
      .insert(messageCreditGrants)
      .values({
        id: crypto.randomUUID(),
        userId,
        packId: pack.id,
        messages: pack.messages,
        remaining: pack.messages,
        stripePaymentIntentId: paymentIntentId,
        purchasedAt,
        expiresAt,
      })
      .onConflictDoNothing({ target: messageCreditGrants.stripePaymentIntentId });
  }

  async listMessagePacks(userId: string): Promise<MessageCreditGrantRow[]> {
    return this.db
      .select()
      .from(messageCreditGrants)
      .where(eq(messageCreditGrants.userId, userId))
      .orderBy(asc(messageCreditGrants.expiresAt));
  }

  async getPackBalance(userId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${messageCreditGrants.remaining}), 0)` })
      .from(messageCreditGrants)
      .where(
        and(
          eq(messageCreditGrants.userId, userId),
          gt(messageCreditGrants.remaining, 0),
          gt(messageCreditGrants.expiresAt, new Date()),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  /** Spends one message from the oldest unexpired pack; returns its id, or null if none. */
  private async spendFromPack(userId: string): Promise<string | null> {
    const candidates = await this.db
      .select({ id: messageCreditGrants.id })
      .from(messageCreditGrants)
      .where(
        and(
          eq(messageCreditGrants.userId, userId),
          gt(messageCreditGrants.remaining, 0),
          gt(messageCreditGrants.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(messageCreditGrants.expiresAt))
      .limit(3);
    for (const candidate of candidates) {
      const updated = await this.db
        .update(messageCreditGrants)
        .set({ remaining: sql`${messageCreditGrants.remaining} - 1` })
        .where(and(eq(messageCreditGrants.id, candidate.id), gt(messageCreditGrants.remaining, 0)))
        .returning({ id: messageCreditGrants.id });
      if (updated.length > 0) return candidate.id;
    }
    return null;
  }

  // ─── Usage Tracking ───────────────────────────────────────────────────────

  /**
   * Compute the start of the current usage period based on the subscription.
   * Monthly plans: use Stripe's currentPeriodStart directly.
   * Annual plans: rolling 30-day window from the annual period start.
   * Fallback: first of the current UTC month.
   */
  getUsagePeriodStart(subscription: SubscriptionRow | null): Date {
    if (!subscription?.currentPeriodStart) {
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }

    if (subscription.interval === "monthly") {
      return subscription.currentPeriodStart;
    }

    // Annual plans: rolling 30-day window from period start
    const anchor = subscription.currentPeriodStart.getTime();
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const elapsed = now - anchor;
    const windowIndex = Math.max(0, Math.floor(elapsed / THIRTY_DAYS_MS));
    return new Date(anchor + windowIndex * THIRTY_DAYS_MS);
  }

  /**
   * Compute the end of the current usage period.
   * Monthly plans: use Stripe's currentPeriodEnd.
   * Annual plans: usage period start + 30 days.
   */
  getUsagePeriodEnd(subscription: SubscriptionRow | null): Date {
    if (!subscription?.currentPeriodEnd) {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );
    }

    if (subscription.interval === "monthly") {
      return subscription.currentPeriodEnd;
    }

    const start = this.getUsagePeriodStart(subscription);
    return new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  async getUsage(
    userId: string,
    subscription: SubscriptionRow | null,
  ): Promise<UsageRow | null> {
    const periodStart = this.getUsagePeriodStart(subscription);
    const rows = await this.db
      .select()
      .from(usage)
      .where(and(eq(usage.userId, userId), eq(usage.periodStart, periodStart)))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementMessageUsage(
    userId: string,
    subscription: SubscriptionRow | null,
  ): Promise<number> {
    const periodStart = this.getUsagePeriodStart(subscription);

    // Try to increment existing row
    const existing = await this.getUsage(userId, subscription);
    if (existing) {
      const newCount = existing.messagesUsed + 1;
      await this.db
        .update(usage)
        .set({ messagesUsed: newCount })
        .where(eq(usage.id, existing.id));
      await this.checkAndSendUsageAlerts(
        userId,
        subscription,
        newCount,
        existing,
      );
      return newCount;
    }

    // Create new usage row for this period
    const id = crypto.randomUUID();
    await this.db.insert(usage).values({
      id,
      userId,
      periodStart,
      messagesUsed: 1,
    });

    // Check alerts even for count=1 (in case limit is 1)
    const newRow = await this.getUsage(userId, subscription);
    if (newRow) {
      await this.checkAndSendUsageAlerts(userId, subscription, 1, newRow);
    }

    return 1;
  }

  async incrementMessageUsageOnce(
    messageId: string,
    userId: string,
    subscription: SubscriptionRow | null,
  ): Promise<number> {
    const periodStart = this.getUsagePeriodStart(subscription);
    const inserted = await this.db
      .insert(messageUsageCredits)
      .values({ messageId, userId, periodStart })
      .onConflictDoNothing({ target: messageUsageCredits.messageId })
      .returning({ messageId: messageUsageCredits.messageId });
    const current = await this.getUsage(userId, subscription);
    const count = current?.messagesUsed ?? 0;
    if (inserted.length > 0 && subscription) {
      const allowance = messageAllowance(entitlementsFor(subscription));
      if (allowance !== null && count > allowance) {
        const grantId = await this.spendFromPack(userId);
        if (grantId) {
          await this.db
            .update(messageUsageCredits)
            .set({ grantId })
            .where(eq(messageUsageCredits.messageId, messageId));
        }
      }
    }
    if (inserted.length > 0 && current) {
      await this.checkAndSendUsageAlerts(
        userId,
        subscription,
        count,
        current,
      );
    }
    return count;
  }

  // ─── Usage Alerts ─────────────────────────────────────────────────────────

  private async checkAndSendUsageAlerts(
    userId: string,
    subscription: SubscriptionRow | null,
    currentCount: number,
    usageRow: UsageRow,
  ): Promise<void> {
    if (!subscription) return;

    try {
      const entitlements = entitlementsFor(subscription);
      const max = messageAllowance(entitlements);
      if (max === null) return;
      const threshold80 = Math.floor(max * 0.8);

      // "Limit reached" means nothing left: the allowance is used and no pack remains.
      const outOfMessages =
        currentCount >= max && (await this.getPackBalance(userId)) === 0;
      if (outOfMessages && !usageRow.alerted100) {
        await this.db
          .update(usage)
          .set({ alerted100: true })
          .where(eq(usage.id, usageRow.id));
        this.sendUsageAlert(
          userId,
          entitlements.plan,
          currentCount,
          max,
          "limit_reached",
        );
      }

      // 80% alert (independent check — both can fire if user jumps from <80% to >=100%)
      if (currentCount >= threshold80 && !usageRow.alerted80) {
        await this.db
          .update(usage)
          .set({ alerted80: true })
          .where(eq(usage.id, usageRow.id));
        this.sendUsageAlert(
          userId,
          entitlements.plan,
          currentCount,
          max,
          "warning",
        );
      }
    } catch (err) {
      console.error("[BillingService] Usage alert check failed:", err);
    }
  }

  private async sendUsageAlert(
    userId: string,
    plan: Plan,
    used: number,
    max: number,
    type: "warning" | "limit_reached",
  ): Promise<void> {
    try {
      const user = await this.db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!user?.email) return;

      const emailService = new EmailService(this.env.RESEND_API_KEY);
      const name = user.name ?? "there";

      if (type === "warning") {
        await emailService.sendUsageWarningEmail(
          user.email,
          name,
          PLANS[plan].name,
          used,
          max,
        );
      } else {
        await emailService.sendUsageLimitReachedEmail(
          user.email,
          name,
          PLANS[plan].name,
          max,
        );
      }
    } catch (err) {
      console.error("[BillingService] Usage alert email failed:", err);
    }
  }

  // ─── Plan Enforcement Checks ──────────────────────────────────────────────

  async checkProjectLimit(
    userId: string,
  ): Promise<{ allowed: boolean; current: number; max: number | null }> {
    const sub = await this.getSubscriptionByUserId(userId);
    if (!sub) return { allowed: false, current: 0, max: 0 };

    const max = entitlementsFor(sub).limits.projects;
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    return {
      allowed: max === null || userProjects.length < max,
      current: userProjects.length,
      max,
    };
  }

  async checkMessageLimit(
    userId: string,
    prefetchedSub?: SubscriptionRow | null,
  ): Promise<{ allowed: boolean; used: number; max: number | null; packBalance: number }> {
    const sub =
      prefetchedSub !== undefined
        ? prefetchedSub
        : await this.getSubscriptionByUserId(userId);
    if (!sub) return { allowed: false, used: 0, max: 0, packBalance: 0 };

    const entitlements = entitlementsFor(sub);
    const max = messageAllowance(entitlements);
    const currentUsage = await this.getUsage(userId, sub);
    const used = currentUsage?.messagesUsed ?? 0;
    if (max === null || used < max) {
      return { allowed: true, used, max, packBalance: 0 };
    }
    // Packs are not sold during a trial; a leftover balance still does not lift the cap.
    const packBalance = entitlements.trialing ? 0 : await this.getPackBalance(userId);
    return { allowed: packBalance > 0, used, max, packBalance };
  }

  isSubscriptionActive(sub: SubscriptionRow | null): boolean {
    if (!sub) return false;
    return sub.status === "active" || sub.status === "trialing";
  }

  // ─── Subscription Status Notifications ──────────────────────────────────────

  private async notifySubscriptionInactive(
    userId: string,
    reason: SubscriptionInactiveReason,
  ): Promise<void> {
    try {
      const user = await this.db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!user) return;

      // Send email
      const emailService = new EmailService(this.env.RESEND_API_KEY);
      await emailService.sendSubscriptionInactiveEmail(
        user.email,
        user.name,
        reason,
      );

      // Send Telegram notifications to all configured projects
      await this.notifyTelegramAllProjects(userId, reason);
    } catch (err) {
      console.error("Failed to send subscription inactive notification:", err);
    }
  }

  private async notifySubscriptionRecovered(userId: string): Promise<void> {
    try {
      const user = await this.db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!user) return;

      // Send email
      const emailService = new EmailService(this.env.RESEND_API_KEY);
      await emailService.sendSubscriptionRecoveredEmail(user.email, user.name);

      // Send Telegram notifications to all configured projects
      await this.notifyTelegramAllProjects(userId, "recovered");
    } catch (err) {
      console.error(
        "Failed to send subscription recovered notification:",
        err,
      );
    }
  }

  private async notifyTelegramAllProjects(
    userId: string,
    type: SubscriptionInactiveReason | "recovered",
  ): Promise<void> {
    const userProjects = await this.db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        telegramBotToken: projectSettings.telegramBotToken,
        telegramChatId: projectSettings.telegramChatId,
      })
      .from(projects)
      .innerJoin(projectSettings, eq(projects.id, projectSettings.projectId))
      .where(eq(projects.userId, userId));

    const telegramService = new TelegramService(this.db, this.env.ENCRYPTION_KEY);

    const messages: Record<SubscriptionInactiveReason | "recovered", string> = {
      payment_failed:
        "⚠️ Payment failed — your chatbot is paused. Visitors will see an unavailable message until payment is resolved.",
      canceled:
        "⚠️ Subscription canceled — your chatbot is no longer active. Visitors will see an unavailable message.",
      other:
        "⚠️ Subscription inactive — your chatbot is currently unavailable to visitors.",
      recovered:
        "✅ Subscription active — your chatbot is back online and available to visitors.",
    };

    for (const proj of userProjects) {
      if (!proj.telegramBotToken || !proj.telegramChatId) continue;
      try {
        await telegramService.sendMessage(
          proj.telegramBotToken,
          proj.telegramChatId,
          `<b>${proj.projectName}</b>\n\n${messages[type]}`,
        );
      } catch (err) {
        console.error(
          `Telegram notification failed for project ${proj.projectId}:`,
          err,
        );
      }
    }
  }

  // ─── Usage Log ──────────────────────────────────────────────────────────────

  async getUsageLog(
    userId: string,
    subscription: SubscriptionRow | null,
    options: {
      limit: number;
      offset: number;
      sortBy: "botMessages" | "createdAt";
      sortOrder: "asc" | "desc";
      status?: string;
      metaKey?: string;
      metaValue?: string;
    },
  ): Promise<{
    rows: UsageLogRow[];
    total: number;
    metaKeys: string[];
  }> {
    const periodStart = this.getUsagePeriodStart(subscription);
    const periodEnd = this.getUsagePeriodEnd(subscription);

    // Get user's project IDs
    const userProjects = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId));

    if (userProjects.length === 0) {
      return { rows: [], total: 0, metaKeys: [] };
    }

    const projectIds = userProjects.map((p) => p.id);
    const projectNameMap = new Map(userProjects.map((p) => [p.id, p.name]));

    const result = await this.conversationStore.queryUsageConversations({
      projectIds,
      periodStart: periodStart.getTime(),
      periodEnd: periodEnd.getTime(),
      ...options,
    });

    return {
      rows: result.rows.map(({ conversation, botMessageCount }) => ({
        conversationId: conversation.id,
        projectId: conversation.projectId,
        projectName: projectNameMap.get(conversation.projectId) ?? "Unknown",
        visitorName: conversation.visitorName,
        visitorEmail: conversation.visitorEmail,
        status: conversation.status,
        botMessageCount,
        createdAt: new Date(conversation.createdAt).toISOString(),
        metadata: toStringRecord(conversation.metadata),
      })),
      total: result.total,
      metaKeys: result.metaKeys,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface UsageLogRow {
  conversationId: string;
  projectId: string;
  projectName: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: string;
  botMessageCount: number;
  createdAt: string;
  metadata: Record<string, string> | null;
}

function toStringRecord(
  value: Record<string, unknown>,
): Record<string, string> | null {
  return Object.keys(value).length > 0
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, String(entry)]),
      )
    : null;
}
