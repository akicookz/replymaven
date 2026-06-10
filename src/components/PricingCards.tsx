import { useState } from "react";
import { Check } from "lucide-react";
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
      "100 messages / month",
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
      "3 projects",
      "500 messages / month",
      "3 seats",
      "PDF indexing",
      "Telegram live agent handoff",
      "Custom tone of voice",
      "Auto knowledgebase refinement",
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
      "5 projects",
      "2,000 messages / month",
      "5 seats",
      "Auto canned response drafts",
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

export function getCtaLabel(
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
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <span className="text-xs text-brand font-medium">
        2 months free
      </span>
      <div
        className="inline-flex items-center gap-1 p-1 rounded-xl bg-muted/50"
        role="group"
        aria-label="Billing interval"
      >
        <button
          type="button"
          onClick={() => onChange("monthly")}
          className={cn(
            "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
            interval === "monthly"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => onChange("annual")}
          className={cn(
            "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
            interval === "annual"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Annual
        </button>
      </div>
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
  selectedPlan: PlanId;
  onSelectedPlanChange: (plan: PlanId) => void;
  interval: Interval;
  currentPlan?: PlanId | null;
  currentInterval?: Interval | null;
}

export function PricingCardsSelect({
  selectedPlan,
  onSelectedPlanChange,
  interval,
  currentPlan,
  currentInterval,
}: PricingCardsSelectProps) {
  return (
    <div className="space-y-3">
      {pricingPlans.map((plan) => {
        const price =
          interval === "monthly"
            ? plan.monthlyPrice
            : Math.floor(plan.annualPrice / 12);
        const isSelected = selectedPlan === plan.id;
        const isCurrent = isCurrentPlanCard(
          plan.id,
          interval,
          currentPlan,
          currentInterval,
        );

        return (
          <button
            key={plan.id}
            type="button"
            onClick={() => onSelectedPlanChange(plan.id)}
            className={cn(
              "w-full text-left rounded-2xl p-4 transition-all bg-input-background border",
              isSelected
                ? "ring-2 ring-brand/40 border-brand/30"
                : "border-border hover:border-brand/20",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors",
                    isSelected
                      ? "border-brand bg-brand"
                      : "border-muted-foreground/30",
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground text-sm">
                      {plan.name.replace("ReplyMaven ", "")}
                    </span>
                    {plan.badge && (
                      <span className="text-[11px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-medium">
                        {plan.badge}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[11px] bg-brand text-white px-2 py-0.5 rounded-full font-medium">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    {plan.features.slice(0, 3).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-baseline justify-end gap-0.5">
                  <span className="text-xl font-semibold text-foreground">
                    ${price}
                  </span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                {interval === "annual" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ${plan.annualPrice}/yr
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
