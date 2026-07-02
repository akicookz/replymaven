import { UserRoundSearch } from "lucide-react";
import type { Message } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

// Full-width agent-facing callout for the escalation summary. Accent-tinted
// card (no divider borders); `highlight` pulses it when a deep link lands.
export default function ReviewSummaryCard({
  message,
  highlight,
}: {
  message: Message;
  highlight?: boolean;
}) {
  return (
    <div className="my-4">
      <div
        className={cn(
          "rounded-[14px] bg-brand/8 px-4 py-3.5 transition-shadow",
          highlight && "animate-pulse-once ring-2 ring-brand/40",
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <UserRoundSearch className="size-4 text-brand shrink-0" />
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-brand">
            Needs human review
          </span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-3 whitespace-pre-line">
          {message.content}
        </p>
      </div>
    </div>
  );
}
