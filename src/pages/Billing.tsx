import { useMutation } from "@tanstack/react-query";
import {
  CreditCard,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { formatPlanName, usagePercent, getTrialDaysRemaining } from "@/lib/plan";
import { MobileMenuButton } from "@/components/PageHeader";

// ─── Usage Bar ────────────────────────────────────────────────────────────────

function UsageBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const percent = usagePercent(used, max);
  const isWarning = percent >= 80;
  const isDanger = percent >= 95;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {used.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isDanger
              ? "bg-destructive"
              : isWarning
                ? "bg-yellow-500"
                : "bg-primary"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
    active: { label: "Active", icon: CheckCircle2, className: "text-green-600 bg-green-50" },
    trialing: { label: "Trial", icon: Clock, className: "text-blue-600 bg-blue-50" },
    past_due: { label: "Past Due", icon: AlertTriangle, className: "text-yellow-600 bg-yellow-50" },
    canceled: { label: "Canceled", icon: XCircle, className: "text-red-600 bg-red-50" },
    unpaid: { label: "Unpaid", icon: AlertTriangle, className: "text-red-600 bg-red-50" },
    incomplete: { label: "Incomplete", icon: Clock, className: "text-gray-600 bg-gray-50" },
  };

  const c = config[status] ?? config.incomplete;
  const Icon = c.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.className}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

// ─── Billing Page ─────────────────────────────────────────────────────────────

function Billing() {
  const { data, isLoading } = useSubscription();

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/app/account`,
        }),
      });
      if (!res.ok) throw new Error("Failed to create portal session");
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: (result) => {
      if (result.url) window.location.href = result.url;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sub = data?.subscription;
  const limits = data?.limits;
  const usage = data?.usage;
  const seats = data?.seats;

  // No subscription
  if (!sub) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Billing</h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              Manage your subscription and billing details.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border p-8 text-center space-y-4">
          <CreditCard className="w-10 h-10 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">No active subscription</p>
            <p className="text-sm text-muted-foreground">
              Choose a plan to get started with ReplyMaven.
            </p>
          </div>
          <Button onClick={() => (window.location.href = "/app/onboarding?step=4")}>
            Choose a Plan
          </Button>
        </div>
      </div>
    );
  }

  const trialDays = getTrialDaysRemaining(sub.trialEndsAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage your subscription and billing details.
          </p>
        </div>
      </div>

      {/* Trial Banner */}
      {sub.status === "trialing" && trialDays > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200">
          <Clock className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              {trialDays} day{trialDays !== 1 ? "s" : ""} left in your trial
            </p>
            <p className="text-xs text-blue-700">
              Your card will be charged when the trial ends.
            </p>
          </div>
        </div>
      )}

      {/* Past Due Banner */}
      {sub.status === "past_due" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center px-4 py-3 rounded-xl bg-yellow-50 border border-yellow-200">
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900">
                Payment failed
              </p>
              <p className="text-xs text-yellow-700">
                Please update your payment method to keep your subscription active.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            className="w-full sm:w-auto shrink-0"
          >
            Update Payment
          </Button>
        </div>
      )}

      {/* Current Plan */}
      <div className="rounded-xl border border-border p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {formatPlanName(sub.plan)} Plan
            </h2>
            <p className="text-sm text-muted-foreground capitalize">
              Billed {sub.interval}
              {sub.cancelAtPeriodEnd && " (cancels at end of period)"}
            </p>
          </div>
          <StatusBadge status={sub.status} />
        </div>

        <Button
          onClick={() => portalMutation.mutate()}
          disabled={portalMutation.isPending}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {portalMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4 mr-2" />
          )}
          Manage Subscription
        </Button>
        <p className="text-xs text-muted-foreground">
          Change plan, update payment method, view invoices, or cancel.
        </p>
      </div>

      {/* Usage */}
      {limits && (
        <div className="rounded-xl border border-border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Usage</h2>

          <UsageBar
            label="Messages this month"
            used={usage?.messagesUsed ?? 0}
            max={limits.maxMessagesPerMonth}
          />

          <UsageBar
            label="Seats"
            used={seats?.current ?? 1}
            max={limits.maxSeats}
          />
        </div>
      )}
    </div>
  );
}

export default Billing;
