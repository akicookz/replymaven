import { cn } from "@/lib/utils";
import {
  getVisitorPresenceState,
  type PresenceValue,
} from "@/lib/conversation-presence";

interface PresenceDotProps {
  visitorLastSeenAt: PresenceValue;
  visitorPresence: string | null | undefined;
  className?: string;
}

// Live presence dot (heartbeat-driven): pulsing green while the visitor is in
// the chat, steady amber when their tab is backgrounded, hidden when offline.
export default function PresenceDot({
  visitorLastSeenAt,
  visitorPresence,
  className,
}: PresenceDotProps) {
  const state = getVisitorPresenceState({ visitorLastSeenAt, visitorPresence });
  if (state === "offline") return null;

  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      title={state === "online" ? "Online now" : "Away"}
    >
      {state === "online" && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          state === "online" ? "bg-emerald-400" : "bg-amber-400",
        )}
      />
    </span>
  );
}
