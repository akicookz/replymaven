import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanId = "starter" | "standard" | "business";
type Interval = "monthly" | "annual";

// ─── Pricing Data ─────────────────────────────────────────────────────────────

const pricingPlans = [
  {
    id: "starter" as const,
    name: "ReplyMaven Starter",
    monthlyPrice: 19,
    annualPrice: 190,
    description: "For personal projects and small sites.",
    highlighted: false,
    features: [
      "1 project",
      "200 messages / month",
      "50 knowledge sources",
      "1 seat",
      "Web page & FAQ indexing",
      "Widget customization",
      "Email support",
    ],
  },
  {
    id: "standard" as const,
    name: "ReplyMaven Standard",
    monthlyPrice: 49,
    annualPrice: 490,
    description: "For growing teams that need more power.",
    highlighted: true,
    badge: "Most Popular",
    features: [
      "Everything in Starter",
      "5 projects",
      "500 messages / month",
      "3 seats",
      "PDF indexing",
      "Telegram live agent handoff",
      "Custom tone of voice",
      "Tools",
    ],
  },
  {
    id: "business" as const,
    name: "ReplyMaven Business",
    monthlyPrice: 99,
    annualPrice: 990,
    description: "For teams that run on customer experience.",
    highlighted: false,
    features: [
      "Everything in Standard",
      "10 projects",
      "2,000 messages / month",
      "5 seats",
      "Auto-drafted canned responses",
      "Custom CSS & branding",
      "Priority support",
    ],
  },
];

export { pricingPlans };

// ─── Plan Comparison Helper ───────────────────────────────────────────────────

const PLAN_RANK: Record<PlanId, number> = {
  starter: 0,
  standard: 1,
  business: 2,
};

function getCtaLabel(
  cardPlan: PlanId,
  cardInterval: Interval,
  currentPlan?: PlanId | null,
  currentInterval?: Interval | null,
): string {
  if (!currentPlan || !currentInterval) return "Start 7-day free trial";

  const isSamePlan = cardPlan === currentPlan;
  const isSameInterval = cardInterval === currentInterval;

  if (isSamePlan && isSameInterval) return "Manage Plan";
  if (isSamePlan && !isSameInterval) {
    return cardInterval === "annual" ? "Switch to annual" : "Switch to monthly";
  }

  const cardRank = PLAN_RANK[cardPlan];
  const currentRank = PLAN_RANK[currentPlan];
  return cardRank > currentRank ? "Upgrade" : "Downgrade";
}

function isCurrentPlanCard(
  cardPlan: PlanId,
  cardInterval: Interval,
  currentPlan?: PlanId | null,
  currentInterval?: Interval | null,
): boolean {
  return cardPlan === currentPlan && cardInterval === currentInterval;
}

// ─── Billing Toggle ───────────────────────────────────────────────────────────

export function BillingToggle({
  interval,
  onChange,
}: {
  interval: Interval;
  onChange: (interval: Interval) => void;
}) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/[0.06] w-fit">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={cn(
          "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
          interval === "monthly"
            ? "glow-surface text-card-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={cn(
          "px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-start gap-1",
          interval === "annual"
            ? "glow-surface text-card-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Annual
        <span className="ml-1.5 text-[11px] text-brand font-semibold">
          2 months free
        </span>
      </button>
    </div>
  );
}

// ─── Pricing Cards (for Landing page) ─────────────────────────────────────────

interface PricingCardsProps {
  onCtaClick: (planId: PlanId, interval: Interval) => void;
  currentPlan?: PlanId | null;
  currentInterval?: Interval | null;
  onManagePlan?: () => void;
}

export function PricingCards({
  onCtaClick,
  currentPlan,
  currentInterval,
  onManagePlan,
}: PricingCardsProps) {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <div className="space-y-8">
      <BillingToggle interval={interval} onChange={setInterval} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan) => {
          const price =
            interval === "monthly"
              ? plan.monthlyPrice
              : Math.floor(plan.annualPrice / 12);

          const ctaLabel = getCtaLabel(plan.id, interval, currentPlan, currentInterval);
          const isCurrent = isCurrentPlanCard(plan.id, interval, currentPlan, currentInterval);

          return (
            <div
              key={plan.id}
              className={cn(
                cardVariants({
                  variant: plan.highlighted ? "glow-primary" : "glow-secondary",
                }),
                "relative flex flex-col rounded-3xl",
                plan.highlighted
                  ? "bg-black/80 backdrop-blur-2xl border border-primary/20"
                  : "bg-black/80 backdrop-blur-2xl border border-primary/15",
                isCurrent && "ring-2 ring-brand/40",
              )}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] bg-brand text-white px-3 py-1 rounded-full font-medium">
                    Current Plan
                  </span>
                </div>
              )}

              <div className="p-7 pb-0 space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-muted-foreground">{plan.name}</h3>
                  {plan.highlighted && plan.badge && (
                    <span className="text-[11px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-medium">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold text-foreground tracking-tight">
                    ${price}
                  </span>
                  <span className="text-quaternary text-sm">
                    /mo
                    {interval === "annual" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (${plan.annualPrice}/yr)
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              <ul className="p-7 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <span className="text-secondary-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="p-7 pt-0">
                <Button
                  variant={plan.highlighted ? "glow-primary" : "glow-secondary"}
                  onClick={() => {
                    if (ctaLabel === "Manage Plan" && onManagePlan) {
                      onManagePlan();
                    } else {
                      onCtaClick(plan.id, interval);
                    }
                  }}
                  className={cn(
                    "w-full rounded-xl h-11 text-sm font-medium",
                    !plan.highlighted &&
                    "bg-white/[0.05] hover:bg-white/[0.08] border-white/[0.06]",
                  )}
                >
                  {ctaLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pricing Cards (for Onboarding plan selection) ────────────────────────────

interface PricingCardsSelectProps {
  onSelectPlan: (plan: PlanId, interval: Interval) => void;
  loadingPlan: string | null;
  interval: Interval;
  currentPlan?: PlanId | null;
  currentInterval?: Interval | null;
  onManagePlan?: () => void;
}

export function PricingCardsSelect({
  onSelectPlan,
  loadingPlan,
  interval,
  currentPlan,
  currentInterval,
  onManagePlan,
}: PricingCardsSelectProps) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan) => {
          const price =
            interval === "monthly"
              ? plan.monthlyPrice
              : Math.floor(plan.annualPrice / 12);
          const isLoading = loadingPlan === plan.id;

          const ctaLabel = getCtaLabel(plan.id, interval, currentPlan, currentInterval);
          const isCurrent = isCurrentPlanCard(plan.id, interval, currentPlan, currentInterval);

          return (
            <div
              key={plan.id}
              className={cn(
                cardVariants({
                  variant: plan.highlighted ? "glow-primary" : "glow-secondary",
                }),
                "relative flex flex-col rounded-3xl",
                plan.highlighted
                  ? "bg-black/80 backdrop-blur-2xl border border-primary/20"
                  : "bg-black/80 backdrop-blur-2xl border border-primary/15",
                isCurrent && "ring-2 ring-brand/40",
              )}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] bg-brand text-white px-3 py-1 rounded-full font-medium">
                    Current Plan
                  </span>
                </div>
              )}

              <div className="p-7 pb-0 space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm text-muted-foreground">{plan.name}</h3>
                  {plan.highlighted && plan.badge && (
                    <span className="text-[11px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-medium">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold text-foreground tracking-tight">
                    ${price}
                  </span>
                  <span className="text-quaternary text-sm">
                    /mo
                    {interval === "annual" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (${plan.annualPrice} billed annually)
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              <ul className="p-7 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <Check className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <span className="text-secondary-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="p-7 pt-0">
                <Button
                  variant={plan.highlighted ? "glow-primary" : "glow-secondary"}
                  onClick={() => {
                    if (ctaLabel === "Manage Plan" && onManagePlan) {
                      onManagePlan();
                    } else {
                      onSelectPlan(plan.id, interval);
                    }
                  }}
                  disabled={isCurrent || loadingPlan !== null}
                  className={cn(
                    "w-full rounded-xl h-11 text-sm font-medium",
                    !plan.highlighted &&
                    "bg-white/[0.05] hover:bg-white/[0.08] border-white/[0.06]",
                  )}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    ctaLabel
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
