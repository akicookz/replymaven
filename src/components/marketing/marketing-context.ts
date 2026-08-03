import { createContext, useContext } from "react";

export type MarketingPlanId = "starter" | "standard" | "business";
export type MarketingInterval = "monthly" | "annual";

export interface MarketingActionsValue {
  isLoggedIn: boolean;
  currentPlan: MarketingPlanId | null;
  currentInterval: MarketingInterval | null;
  startTrial: () => void;
  selectPlan: (plan: MarketingPlanId, interval: MarketingInterval) => void;
  managePlan: () => void;
}

export const MarketingActionsContext =
  createContext<MarketingActionsValue | null>(null);

export function useMarketingActions(): MarketingActionsValue {
  const value = useContext(MarketingActionsContext);
  if (!value) {
    throw new Error("useMarketingActions must be used inside MarketingLayout");
  }
  return value;
}
