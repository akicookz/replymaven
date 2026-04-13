import Stripe from "stripe";
import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, desc, asc, sql, inArray, isNotNull } from "drizzle-orm";
import {
  subscriptions,
  usage,
  projects,
  projectSettings,
  conversations,
  messages,
  type SubscriptionRow,
  type UsageRow,
} from "../db";
import { users } from "../db/auth.schema";
import {
  type AppEnv,
  type Plan,
  type BillingInterval,
  type PlanLimits,
} from "../types";
import {
  EmailService,
  type SubscriptionInactiveReason,
} from "./email-service";
import { TelegramService } from "./telegram-service";

// ─── Plan Limits Configuration ────────────────────────────────────────────────

const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    plan: "starter",
    maxProjects: 1,
    maxMessagesPerMonth: 100,
    maxKnowledgeSources: 50,
    maxSeats: 1,
    pdfIndexing: false,
    telegram: false,
    customTone: false,
    autoCannedDraft: false,
    autoRefinement: false,
    customCss: false,
    tools: false,
  },
  standard: {
    plan: "standard",
    maxProjects: 3,
    maxMessagesPerMonth: 500,
    maxKnowledgeSources: 50,
    maxSeats: 3,
    pdfIndexing: true,
    telegram: true,
    customTone: true,
    autoCannedDraft: false,
    autoRefinement: true,
    customCss: false,
    tools: true,
  },
  business: {
    plan: "business",
    maxProjects: 5,
    maxMessagesPerMonth: 2000,
    maxKnowledgeSources: 100,
    maxSeats: 5,
    pdfIndexing: true,
    telegram: true,
    customTone: true,
    autoCannedDraft: true,
    autoRefinement: true,
    customCss: true,
    tools: true,
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

    const newStatus = statusMap[stripeSub.status] ?? "active";
    const wasActive = this.isSubscriptionActive(existing);

    await this.updateSubscription(existing.id, {
      status: newStatus,
      plan: mapping?.plan ?? existing.plan,
      interval: mapping?.interval ?? existing.interval,
      trialEndsAt: stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000)
        : null,
      currentPeriodStart: periodDates.start,
      currentPeriodEnd: periodDates.end,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
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

  // ─── Usage Alerts ─────────────────────────────────────────────────────────

  private async checkAndSendUsageAlerts(
    userId: string,
    subscription: SubscriptionRow | null,
    currentCount: number,
    usageRow: UsageRow,
  ): Promise<void> {
    if (!subscription) return;

    try {
      const limits = BillingService.getPlanLimits(subscription.plan as Plan);
      const max = limits.maxMessagesPerMonth;
      const threshold80 = Math.floor(max * 0.8);

      // 100% alert
      if (currentCount >= max && !usageRow.alerted100) {
        await this.db
          .update(usage)
          .set({ alerted100: true })
          .where(eq(usage.id, usageRow.id));
        this.sendUsageAlert(
          userId,
          subscription.plan as Plan,
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
          subscription.plan as Plan,
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
          plan,
          used,
          max,
        );
      } else {
        await emailService.sendUsageLimitReachedEmail(
          user.email,
          name,
          plan,
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
    const currentUsage = await this.getUsage(userId, sub);
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

    const telegramService = new TelegramService(this.db);

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

    // Build WHERE conditions
    const conditions = [
      inArray(conversations.projectId, projectIds),
      sql`${conversations.createdAt} >= ${Math.floor(periodStart.getTime() / 1000)}`,
      sql`${conversations.createdAt} < ${Math.floor(periodEnd.getTime() / 1000)}`,
    ];

    if (options.status) {
      conditions.push(eq(conversations.status, options.status as "active" | "waiting_agent" | "agent_replied" | "closed"));
    }

    if (options.metaKey && options.metaValue) {
      conditions.push(
        sql`json_extract(${conversations.metadata}, '$.' || ${options.metaKey}) LIKE ${"%" + options.metaValue.replace(/%/g, "\\%").replace(/_/g, "\\_") + "%"} ESCAPE '\\'`,
      );
    }

    const whereClause = and(...conditions)!;

    // Bot message count subquery via LEFT JOIN + GROUP BY
    const orderExpr =
      options.sortBy === "botMessages"
        ? options.sortOrder === "asc"
          ? asc(sql`bot_count`)
          : desc(sql`bot_count`)
        : options.sortOrder === "asc"
          ? asc(conversations.createdAt)
          : desc(conversations.createdAt);

    const rows = await this.db
      .select({
        conversationId: conversations.id,
        projectId: conversations.projectId,
        visitorName: conversations.visitorName,
        visitorEmail: conversations.visitorEmail,
        status: conversations.status,
        metadata: conversations.metadata,
        createdAt: conversations.createdAt,
        botCount: sql<number>`count(case when ${messages.role} = 'bot' then 1 end)`.as(
          "bot_count",
        ),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversationId, conversations.id))
      .where(whereClause)
      .groupBy(conversations.id)
      .orderBy(orderExpr)
      .limit(options.limit)
      .offset(options.offset);

    // Total count
    const countResult = await this.db
      .select({ count: sql<number>`count(distinct ${conversations.id})` })
      .from(conversations)
      .where(whereClause);

    const total = countResult[0]?.count ?? 0;

    // Extract all metadata keys
    const metaRows = await this.db
      .select({ metadata: conversations.metadata })
      .from(conversations)
      .where(
        and(
          inArray(conversations.projectId, projectIds),
          sql`${conversations.createdAt} >= ${Math.floor(periodStart.getTime() / 1000)}`,
          sql`${conversations.createdAt} < ${Math.floor(periodEnd.getTime() / 1000)}`,
          isNotNull(conversations.metadata),
        ),
      )
      .limit(200);

    const keySet = new Set<string>();
    for (const row of metaRows) {
      if (!row.metadata) continue;
      try {
        const parsed = JSON.parse(row.metadata);
        if (parsed && typeof parsed === "object") {
          for (const key of Object.keys(parsed)) {
            keySet.add(key);
          }
        }
      } catch {
        // skip malformed JSON
      }
    }

    return {
      rows: rows.map((r) => ({
        conversationId: r.conversationId,
        projectId: r.projectId,
        projectName: projectNameMap.get(r.projectId) ?? "Unknown",
        visitorName: r.visitorName,
        visitorEmail: r.visitorEmail,
        status: r.status,
        botMessageCount: r.botCount ?? 0,
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt),
        metadata: r.metadata ? safeParseJson(r.metadata) : null,
      })),
      total,
      metaKeys: Array.from(keySet).sort(),
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

function safeParseJson(str: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
