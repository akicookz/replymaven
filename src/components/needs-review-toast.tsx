import { toast } from "sonner";
import { MessageSquareWarning, X } from "lucide-react";

const TOAST_DURATION_MS = 60_000;

interface NeedsReviewToastProps {
  who: string;
  summary: string | null;
  onDismiss: () => void;
}

function NeedsReviewToast({ who, summary, onDismiss }: NeedsReviewToastProps) {
  return (
    <div className="w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <MessageSquareWarning aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 text-foreground">
            {who} needs your review
          </p>
          {summary && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// Imperative helper so the ping hook (a .ts file) can fire the styled toast.
export function showNeedsReviewToast(options: {
  who: string;
  summary: string | null;
}): void {
  toast.custom(
    (t) => (
      <NeedsReviewToast
        who={options.who}
        summary={options.summary}
        onDismiss={() => toast.dismiss(t)}
      />
    ),
    { duration: TOAST_DURATION_MS },
  );
}
