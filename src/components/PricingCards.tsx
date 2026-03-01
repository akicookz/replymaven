import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Pricing Data ─────────────────────────────────────────────────────────────

const pricingPlans = [
  {
    id: "essential" as const,
    name: "ReplyMaven Essential",
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
    id: "pro" as const,
    name: "ReplyMaven Pro",
    monthlyPrice: 49,
    annualPrice: 490,
    description: "For growing teams that need more power.",
    highlighted: true,
    badge: "Most Popular",
    features: [
      "Everything in Essential",
      "5 projects",
      "500 messages / month",
      "3 seats",
      "PDF indexing",
      "Telegram live agent handoff",
      "Custom tone of voice",
      "Tools & Booking",
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
      "Everything in Pro",
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

// ─── Billing Toggle ───────────────────────────────────────────────────────────

export function BillingToggle({
  interval,
  onChange,
}: {
  interval: "monthly" | "annual";
  onChange: (interval: "monthly" | "annual") => void;
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
  onCtaClick: () => void;
}

export function PricingCards({ onCtaClick }: PricingCardsProps) {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  return (
    <div className="space-y-8">
      <BillingToggle interval={interval} onChange={setInterval} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan) => {
          const price =
            interval === "monthly"
              ? plan.monthlyPrice
              : Math.floor(plan.annualPrice / 12);

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
              )}
            >
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
                  onClick={onCtaClick}
                  className={cn(
                    "w-full rounded-xl h-11 text-sm font-medium",
                    !plan.highlighted &&
                    "bg-white/[0.05] hover:bg-white/[0.08] border-white/[0.06]",
                  )}
                >
                  {plan.highlighted ? "Get started" : `Try ${plan.name.split(" ").pop()} free`}
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
  onSelectPlan: (plan: "essential" | "pro" | "business", interval: "monthly" | "annual") => void;
  loadingPlan: string | null;
  interval: "monthly" | "annual";
}

export function PricingCardsSelect({ onSelectPlan, loadingPlan, interval }: PricingCardsSelectProps) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pricingPlans.map((plan) => {
          const price =
            interval === "monthly"
              ? plan.monthlyPrice
              : Math.floor(plan.annualPrice / 12);
          const isLoading = loadingPlan === plan.id;

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
              )}
            >
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
                  onClick={() => onSelectPlan(plan.id, interval)}
                  disabled={loadingPlan !== null}
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
                    "Start 7-day free trial"
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
