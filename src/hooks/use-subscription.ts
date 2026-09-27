import { useQuery } from "@tanstack/react-query";
import type { FeatureKey, PlanId, PlanLimits } from "../../shared/plans";

export interface MessagePackGrant {
  id: string;
  packId: string;
  messages: number;
  remaining: number;
  purchasedAt: string;
  expiresAt: string;
}

export interface SubscriptionData {
  subscription: {
    id: string;
    plan: PlanId;
    interval: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  usage: {
    messagesUsed: number;
  };
  usagePeriodStart: string | null;
  usagePeriodEnd: string | null;
  limits: PlanLimits | null;
  features: FeatureKey[];
  /** AI messages allowed this period; null = no limit. */
  messageAllowance: number | null;
  packs: {
    balance: number;
    grants: MessagePackGrant[];
  };
  knowledgePages: {
    used: number;
    max: number | null;
  };
  seats: {
    current: number;
    max: number | null;
    /** Seats bought on top of the included ones. */
    extra: number;
    /** Seats the plan includes; null on Enterprise. */
    included: number | null;
  };
  role: "owner" | "admin" | "member";
  pendingInvite: { id: string } | null;
}

export function useSubscription() {
  return useQuery<SubscriptionData>({
    queryKey: ["subscription"],
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription");
      if (!res.ok) throw new Error("Failed to fetch subscription");
      return res.json();
    },
  });
}
