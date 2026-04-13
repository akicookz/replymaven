export interface PlanLimits {
  plan: string;
  maxProjects: number;
  maxMessagesPerMonth: number;
  maxKnowledgeSources: number;
  maxSeats: number;
  pdfIndexing: boolean;
  telegram: boolean;
  customTone: boolean;
  autoCannedDraft: boolean;
  autoRefinement: boolean;
  customCss: boolean;
  tools: boolean;
}

type BooleanFeature = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

export function canAccessFeature(
  limits: PlanLimits | null,
  feature: BooleanFeature,
): boolean {
  if (!limits) return false;
  return limits[feature] === true;
}

export function isAtLimit(
  current: number,
  max: number,
): boolean {
  return current >= max;
}

export function usagePercent(used: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(Math.round((used / max) * 100), 100);
}

export function formatPlanName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function getTrialDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const now = Date.now();
  const end = new Date(trialEndsAt).getTime();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
