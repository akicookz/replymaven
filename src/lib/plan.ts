import { PLANS, isPlanId } from "../../shared/plans";

export function usagePercent(used: number, max: number | null): number {
  if (!max) return 0;
  return Math.min(Math.round((used / max) * 100), 100);
}

export function formatPlanName(plan: string): string {
  return isPlanId(plan) ? PLANS[plan].name : PLANS.business.name;
}

export function getTrialDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const now = Date.now();
  const end = new Date(trialEndsAt).getTime();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
