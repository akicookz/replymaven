import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FEATURE_LABELS,
  PLANS,
  pricingFeatures,
  type PlanId,
} from "../../shared/plans";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelfServePlanId = Exclude<PlanId, "enterprise">;
type Interval = "monthly" | "annual";

// ─── Pricing Data ─────────────────────────────────────────────────────────────

interface SelfServePricingPlan {
  id: SelfServePlanId;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  description: string;
  highlighted: boolean;
  badge?: string;
  features: string[];
}

function limitLine(value: number | null, unit: string): string {
  return `${(value ?? 0).toLocaleString("en-US")} ${unit}`;
}

function selfServePlan(
  id: SelfServePlanId,
  description: string,
  highlighted: boolean,
  features: string[],
  inherits?: string,
): SelfServePricingPlan {
  const plan = PLANS[id];
  return {
    id,
    name: plan.name,
    monthlyPrice: plan.monthlyPriceUsd ?? 0,
    annualPrice: plan.annualPriceUsd ?? 0,
    description,
    highlighted,
    features: [
      ...(inherits ? [inherits] : []),
      limitLine(plan.limits.aiMessagesPerMonth, "AI messages / month"),
      limitLine(plan.limits.seats, plan.limits.seats === 1 ? "seat included" : "seats included"),
      ...features,
    ],
  };
}

const pricingPlans: SelfServePricingPlan[] = [
  selfServePlan("business", "For teams looking to delegate support while keeping the quality bar high.", false, [
    "Train on web pages, FAQs, SOPs, and PDFs",
    "Omni-channel shared inbox",
    "AI Sidechat and Connectors",
    "Help center on your own domain",
    "Custom tools and MCP",
  ]),
];

const enterprisePlan = {
  name: PLANS.enterprise.name,
  description: "For security reviews and custom scale.",
  features: [
    "Everything in Business",
    "Custom limits",
    ...pricingFeatures("enterprise").map((key) => FEATURE_LABELS[key].label),
  ],
};

export { pricingPlans, enterprisePlan };

// ─── Plan Comparison Helper ───────────────────────────────────────────────────

const PLAN_RANK: Record<PlanId, number> = {
  business: 0,
  enterprise: 1,
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
        className="inline-flex items-center gap-1 p-1 rounded-xl bg-glass-button"
        role="group"
        aria-label="Billing interval"
      >
        <button
          type="button"
          onClick={() => onChange("monthly")}
          className={cn(
            "min-h-10 px-4 py-1.5 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.96]",
            interval === "monthly"
              ? "bg-glass-raised text-ink-1 shadow-[inset_0_1px_0_0_var(--hairline-strong)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => onChange("annual")}
          className={cn(
            "min-h-10 px-4 py-1.5 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.96]",
            interval === "annual"
              ? "bg-glass-raised text-ink-1 shadow-[inset_0_1px_0_0_var(--hairline-strong)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Annual
        </button>
      </div>
    </div>
  );
}

// ─── Pricing Cards (for Onboarding plan selection) ────────────────────────────

interface PricingCardsSelectProps {
  selectedPlan: SelfServePlanId;
  onSelectedPlanChange: (plan: SelfServePlanId) => void;
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
                      {plan.name}
                    </span>
                    {plan.badge && (
                      <span className="text-[11px] bg-brand/10 text-brand px-2 py-0.5 rounded-[6px] font-medium">
                        {plan.badge}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[11px] bg-brand text-white px-2 py-0.5 rounded-[6px] font-medium">
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
