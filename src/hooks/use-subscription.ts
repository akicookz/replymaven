import { useQuery } from "@tanstack/react-query";
import type { PlanLimits } from "@/lib/plan";

interface SubscriptionData {
  subscription: {
    id: string;
    plan: string;
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
  limits: PlanLimits | null;
  seats: {
    current: number;
    max: number;
  };
  role: "owner" | "admin" | "member";
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
