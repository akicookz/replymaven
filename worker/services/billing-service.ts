import Stripe from "stripe";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  subscriptions,
  usage,
  projects,
  type SubscriptionRow,
  type UsageRow,
} from "../db";
import {
  type AppEnv,
  type Plan,
  type BillingInterval,
  type PlanLimits,
} from "../types";

// ─── Plan Limits Configuration ────────────────────────────────────────────────

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    plan: "starter",
    maxProjects: 1,
    maxMessagesPerMonth: 200,
    maxKnowledgeSources: 50,
    maxSeats: 1,
    pdfIndexing: false,
    telegram: false,
    customTone: false,
    autoCannedDraft: false,
    customCss: false,
    tools: false,
    booking: false,
  },
  standard: {
    plan: "standard",
    maxProjects: 5,
    maxMessagesPerMonth: 500,
    maxKnowledgeSources: 50,
    maxSeats: 3,
    pdfIndexing: true,
    telegram: true,
    customTone: true,
    autoCannedDraft: false,
    customCss: false,
    tools: true,
    booking: true,
  },
  business: {
    plan: "business",
    maxProjects: 10,
    maxMessagesPerMonth: 2000,
    maxKnowledgeSources: 100,
    maxSeats: 5,
    pdfIndexing: true,
    telegram: true,
    customTone: true,
    autoCannedDraft: true,
    customCss: true,
    tools: true,
    booking: true,
  },
};

// ─── Price Map Builder ────────────────────────────────────────────────────────

interface PriceMapping {
  plan: Plan;
  interval: BillingInterval;
}

function buildPriceMaps(env: AppEnv) {
  const entries: Array<{
    priceId: string;
    plan: Plan;
    interval: BillingInterval;
  }> = [
    {
      priceId: env.STRIPE_STARTER_MONTHLY_PRICE_ID,
      plan: "starter",
      interval: "monthly",
    },
    {
      priceId: env.STRIPE_STARTER_ANNUAL_PRICE_ID,
      plan: "starter",
      interval: "annual",
    },
    {
      priceId: env.STRIPE_STANDARD_MONTHLY_PRICE_ID,
      plan: "standard",
      interval: "monthly",
    },
    {
      priceId: env.STRIPE_STANDARD_ANNUAL_PRICE_ID,
      plan: "standard",
      interval: "annual",
    },
    {
      priceId: env.STRIPE_BUSINESS_MONTHLY_PRICE_ID,
      plan: "business",
      interval: "monthly",
    },
    {
      priceId: env.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
      plan: "business",
      interval: "annual",
    },
  ];

  const priceToMapping = new Map<string, PriceMapping>();
  const planIntervalToPrice = new Map<string, string>();

  for (const entry of entries) {
    priceToMapping.set(entry.priceId, {
      plan: entry.plan,
      interval: entry.interval,
    });
    planIntervalToPrice.set(`${entry.plan}:${entry.interval}`, entry.priceId);
  }

  return { priceToMapping, planIntervalToPrice };
}

// ─── Billing Service ──────────────────────────────────────────────────────────

export class BillingService {
  private stripe: Stripe;
  private priceToMapping: Map<string, PriceMapping>;
  private planIntervalToPrice: Map<string, string>;

  constructor(
    private db: DrizzleD1Database<Record<string, unknown>>,
    private env: AppEnv,
  ) {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    const maps = buildPriceMaps(env);
    this.priceToMapping = maps.priceToMapping;
    this.planIntervalToPrice = maps.planIntervalToPrice;
  }

  // ─── Price Resolution ─────────────────────────────────────────────────────

  resolvePriceId(priceId: string): PriceMapping | null {
    return this.priceToMapping.get(priceId) ?? null;
  }

  getPriceIdForPlan(plan: Plan, interval: BillingInterval): string | null {
    return this.planIntervalToPrice.get(`${plan}:${interval}`) ?? null;
  }

  // ─── Plan Limits ──────────────────────────────────────────────────────────

  static getPlanLimits(plan: Plan): PlanLimits {
    return PLAN_LIMITS[plan];
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
    plan: Plan,
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
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan as Plan | undefined;
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

    // Resolve plan/interval from the current price
    const priceId = stripeSub.items.data[0]?.price.id;
    const mapping = priceId ? this.resolvePriceId(priceId) : null;

    const statusMap: Record<string, SubscriptionRow["status"]> = {
      trialing: "trialing",
      active: "active",
      past_due: "past_due",
      canceled: "canceled",
      unpaid: "unpaid",
      incomplete: "incomplete",
    };

    const periodDates = await this.getSubscriptionPeriod(stripeSub);

    await this.updateSubscription(existing.id, {
      status: statusMap[stripeSub.status] ?? "active",
      plan: mapping?.plan ?? existing.plan,
      interval: mapping?.interval ?? existing.interval,
      trialEndsAt: stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000)
        : null,
      currentPeriodStart: periodDates.start,
      currentPeriodEnd: periodDates.end,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    });
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
    if (existing.status === "trialing" || existing.status === "past_due") {
      updates.status = "active";
    }

    await this.updateSubscription(existing.id, updates);
  }

  private async handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const stripeSubscriptionId = this.getSubscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return;

    const existing = await this.getSubscriptionByStripeId(stripeSubscriptionId);
    if (!existing) return;

    await this.updateSubscription(existing.id, { status: "past_due" });
  }

  // ─── Usage Tracking ───────────────────────────────────────────────────────

  private getCurrentPeriodStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  async getUsage(userId: string): Promise<UsageRow | null> {
    const periodStart = this.getCurrentPeriodStart();
    const rows = await this.db
      .select()
      .from(usage)
      .where(and(eq(usage.userId, userId), eq(usage.periodStart, periodStart)))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementMessageUsage(userId: string): Promise<number> {
    const periodStart = this.getCurrentPeriodStart();

    // Try to increment existing row
    const existing = await this.getUsage(userId);
    if (existing) {
      const newCount = existing.messagesUsed + 1;
      await this.db
        .update(usage)
        .set({ messagesUsed: newCount })
        .where(eq(usage.id, existing.id));
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
    return 1;
  }

  // ─── Plan Enforcement Checks ──────────────────────────────────────────────

  async checkProjectLimit(
    userId: string,
  ): Promise<{ allowed: boolean; current: number; max: number }> {
    const sub = await this.getSubscriptionByUserId(userId);
    if (!sub) return { allowed: false, current: 0, max: 0 };

    const limits = BillingService.getPlanLimits(sub.plan as Plan);
    const userProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, userId));

    return {
      allowed: userProjects.length < limits.maxProjects,
      current: userProjects.length,
      max: limits.maxProjects,
    };
  }

  async checkMessageLimit(
    userId: string,
  ): Promise<{ allowed: boolean; used: number; max: number }> {
    const sub = await this.getSubscriptionByUserId(userId);
    if (!sub) return { allowed: false, used: 0, max: 0 };

    const limits = BillingService.getPlanLimits(sub.plan as Plan);
    const currentUsage = await this.getUsage(userId);
    const used = currentUsage?.messagesUsed ?? 0;

    return {
      allowed: used < limits.maxMessagesPerMonth,
      used,
      max: limits.maxMessagesPerMonth,
    };
  }

  checkFeatureAccess(plan: Plan, feature: keyof PlanLimits): boolean {
    const limits = BillingService.getPlanLimits(plan);
    const value = limits[feature];
    return typeof value === "boolean" ? value : true;
  }

  isSubscriptionActive(sub: SubscriptionRow | null): boolean {
    if (!sub) return false;
    return sub.status === "active" || sub.status === "trialing";
  }
}
