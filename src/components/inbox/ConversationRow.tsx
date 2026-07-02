import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { countryFlag } from "@/lib/inbox/country-flag";
import type { Conversation } from "@/lib/inbox/types";
import PresenceDot from "./PresenceDot";

interface ConversationRowProps {
  conversation: Conversation;
  isSelected: boolean;
  /** Heuristic: lastMessage.role === "visitor" → visitor awaiting reply */
  isUnread: boolean;
  onSelect: (id: string) => void;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ConversationRow({
  conversation,
  isSelected,
  isUnread,
  onSelect,
  onResolve,
  onSnooze,
}: ConversationRowProps) {
  // Derive country from metadata JSON — guard parse errors so a malformed
  // value doesn't crash the list.
  let country: string | null = null;
  try {
    if (conversation.metadata) {
      const meta = JSON.parse(conversation.metadata) as Record<string, unknown>;
      country = typeof meta?.country === "string" ? meta.country : null;
    }
  } catch {
    // ignore
  }

  const flag = countryFlag(country);
  const name =
    conversation.visitorName ??
    conversation.visitorEmail?.split("@")[0] ??
    "Visitor";

  // Preview line: "<sender>: <content>" so it's clear who spoke last —
  // the visitor by first name, the bot by its configured name, you as "You".
  const last = conversation.lastMessage;
  let senderPrefix: string | null = null;
  if (last) {
    if (last.role === "visitor") {
      senderPrefix = name.split(/\s+/)[0];
    } else if (last.role === "bot") {
      senderPrefix = last.senderName ?? "Maven";
    } else if (last.role === "agent") {
      senderPrefix = "You";
    }
  }
  const preview = last
    ? senderPrefix
      ? `${senderPrefix}: ${last.content}`
      : last.content
    : "";

  const isResolved =
    conversation.status === "closed" && conversation.closeReason !== "spam";

  const timeStr = formatTime(
    conversation.lastMessage?.createdAt ??
      conversation.lastActivityAt ??
      conversation.updatedAt,
  );

  function handleClick() {
    onSelect(conversation.id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(conversation.id);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative rounded-row px-[10px] pt-[9px] pb-[11px] cursor-pointer flex items-start transition-colors",
        isSelected ? "bg-bubble-sent" : "hover:bg-glass-button",
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Left gutter — 9px wide, holds the 8px unread dot */}
      <div className="w-[9px] shrink-0 flex justify-center mt-[6px]">
        {isUnread && !isSelected && (
          <div className="w-2 h-2 rounded-full bg-dot-blue shrink-0" />
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Line 1: flag + name + presence + right-aligned resolved/time */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "text-[15px] font-semibold tracking-[-0.2px] truncate",
                isSelected ? "text-white" : "text-ink-2",
              )}
            >
              {flag ? `${flag} ` : ""}
              {name}
            </span>
            <PresenceDot
              visitorLastSeenAt={conversation.visitorLastSeenAt}
              visitorPresence={conversation.visitorPresence}
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isResolved && (
              <Check
                size={13}
                className={isSelected ? "text-white/80" : "text-emerald-400/90"}
                aria-label="Resolved"
              />
            )}
            <span
              className={cn(
                "text-[12px]",
                isSelected ? "text-white/70" : "text-ink-5",
              )}
            >
              {timeStr}
            </span>
          </div>
        </div>

        {/* Line 2: last-message preview with sender prefix (up to 2 lines) */}
        {preview && (
          <div
            className={cn(
              "text-[13px] line-clamp-2 mt-[3px] leading-[1.4]",
              isSelected ? "text-white/80" : "text-ink-6",
            )}
          >
            {preview}
          </div>
        )}
      </div>

      {/* Hover-reveal quick actions (top-right) */}
      <div className="absolute top-[9px] right-[10px] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
        <button
          className="glass-button w-[26px] h-[26px] rounded-[6px] flex items-center justify-center text-ink-4 hover:text-ink-1"
          onClick={(e) => {
            e.stopPropagation();
            onResolve(conversation.id);
          }}
          title="Resolve"
          tabIndex={-1}
        >
          <Check size={12} />
        </button>
        <button
          className="glass-button w-[26px] h-[26px] rounded-[6px] flex items-center justify-center text-ink-4 hover:text-ink-1"
          onClick={(e) => {
            e.stopPropagation();
            onSnooze(conversation.id, Date.now() + 24 * 60 * 60 * 1000);
          }}
          title="Snooze"
          tabIndex={-1}
        >
          <Clock size={12} />
        </button>
      </div>

      {/* Bottom hairline separator inset 28px — the ONLY divider; hidden on selected */}
      {!isSelected && (
        <div className="absolute bottom-0 left-[28px] right-0 h-[0.5px] bg-hairline" />
      )}
    </div>
  );
}
