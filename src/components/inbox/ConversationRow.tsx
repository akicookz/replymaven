import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { countryFlag } from "@/lib/inbox/country-flag";
import type { Conversation } from "@/lib/inbox/types";
import PresenceDot from "./PresenceDot";

interface ConversationRowProps {
  conversation: Conversation;
  isSelected: boolean;
  /** Heuristic: lastMessage.role === "visitor" → visitor awaiting reply */
  isUnread: boolean;
  onSelect: (id: string, options: { shiftKey: boolean }) => void;
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

  function handleClick(e: React.MouseEvent) {
    onSelect(conversation.id, { shiftKey: e.shiftKey });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(conversation.id, { shiftKey: e.shiftKey });
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative rounded-row px-[10px] pt-[9px] pb-[11px] cursor-pointer flex items-start outline-none transition-colors",
        isSelected
          ? "bg-bubble-sent"
          : "hover:bg-glass-button focus-visible:bg-glass-button",
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
    </div>
  );
}
