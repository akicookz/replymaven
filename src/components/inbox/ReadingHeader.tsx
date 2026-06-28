import {
  CheckIcon,
  ClockIcon,
  FlagIcon,
  UserPlusIcon,
  ChevronDownIcon,
  ReplyIcon,
  SearchIcon,
  ShieldOffIcon,
  UserIcon,
} from "lucide-react";
import type { Conversation } from "@/lib/inbox/types";
import { countryFlag } from "@/lib/inbox/country-flag";
import PriorityMenu from "./PriorityMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMetadata(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name[0].toUpperCase();
}

// Deterministic tint from visitorId so it stays consistent across renders.
const AVATAR_TINTS = [
  "bg-blue-500/25 text-blue-200",
  "bg-purple-500/25 text-purple-200",
  "bg-emerald-500/25 text-emerald-200",
  "bg-amber-500/25 text-amber-200",
  "bg-rose-500/25 text-rose-200",
  "bg-cyan-500/25 text-cyan-200",
];

function avatarTint(id: string): string {
  const hash = [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function chatDuration(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 0) return "0m";
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const totalHours = Math.floor(totalMins / 60);
  if (totalHours < 24) {
    const mins = totalMins % 60;
    return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function statusInfo(status: string): { dotClass: string; label: string } {
  if (["active", "waiting_agent", "agent_replied"].includes(status)) {
    return { dotClass: "bg-dot-green", label: "Open" };
  }
  return { dotClass: "bg-dot-gray", label: "Resolved" };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReadingHeaderProps {
  conversation: Conversation;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
  onFlagSpam: (convId: string) => void;
  onPriority: (convId: string, priority: "low" | "medium" | "high") => void;
  onBlock: (convId: string) => void;
  onFocus: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReadingHeader({
  conversation,
  onResolve,
  onSnooze,
  onFlagSpam,
  onPriority,
  onBlock,
  onFocus,
}: ReadingHeaderProps) {
  const meta = parseMetadata(conversation.metadata);
  const country: string | undefined = meta.country;
  const city: string | undefined = meta.city ?? meta.location;
  const browser: string | undefined = meta.browser;

  const { dotClass, label: statusLabel } = statusInfo(conversation.status);
  const duration = chatDuration(conversation.createdAt);
  const flag = countryFlag(country);

  const displayName =
    conversation.visitorName ?? conversation.visitorEmail ?? conversation.visitorId;
  const initials = getInitials(conversation.visitorName ?? conversation.visitorEmail);
  const tint = avatarTint(conversation.visitorId);

  // Snooze until tomorrow (24h from now) as default toolbar action.
  const snoozeTomorrow = () => {
    onSnooze(conversation.id, Date.now() + 86_400_000);
  };

  // Build meta items for the user bar.
  const metaItems: string[] = [];
  if (flag && country) metaItems.push(`${flag} ${city ?? country}`);
  else if (city) metaItems.push(city);
  metaItems.push(`In chat ${duration}`);
  if (browser) metaItems.push(browser);

  return (
    <>
      {/* ── Toolbar row ── */}
      <div
        className="sticky top-0 z-[5] glass-bar flex items-center gap-2"
        style={{ padding: "11px 22px" }}
      >
        {/* Reply */}
        <button
          type="button"
          aria-label="Reply"
          className="glass-button rounded-glass flex items-center justify-center size-8 text-ink-3"
        >
          <ReplyIcon className="size-4" />
        </button>

        {/* Action capsule: Resolve · Snooze · Flag-as-spam */}
        <div className="flex items-center rounded-glass glass-button overflow-hidden">
          <button
            type="button"
            aria-label="Resolve"
            onClick={() => onResolve(conversation.id)}
            className="flex items-center justify-center size-8 text-ink-3 hover:bg-white/5 transition-colors"
          >
            <CheckIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Snooze"
            onClick={snoozeTomorrow}
            className="flex items-center justify-center size-8 text-ink-3 hover:bg-white/5 transition-colors"
          >
            <ClockIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Flag as spam"
            onClick={() => onFlagSpam(conversation.id)}
            className="flex items-center justify-center size-8 text-dot-orange hover:bg-white/5 transition-colors"
          >
            <FlagIcon className="size-4" />
          </button>
        </div>

        {/* Assign / overflow → Block visitor */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Assign or block visitor"
              className="glass-button rounded-glass flex items-center gap-1 px-2.5 h-8 text-ink-3"
            >
              <UserPlusIcon className="size-4" />
              <ChevronDownIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[160px]">
            <DropdownMenuItem
              onSelect={() => onBlock(conversation.id)}
              variant="destructive"
            >
              <ShieldOffIcon className="size-4" />
              Block visitor
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <UserIcon className="size-4" />
              Assign…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Focus button */}
        <button
          type="button"
          onClick={onFocus}
          className="glass-button rounded-glass flex items-center gap-1.5 px-3 h-8 text-ink-3 text-[13px]"
        >
          Focus
          <span className="keycap">F</span>
        </button>

        {/* Search field (visual) */}
        <div className="glass-button rounded-[8px] flex items-center gap-1.5 px-2.5 h-8 w-[170px]">
          <SearchIcon className="size-3.5 text-ink-7 shrink-0" />
          <input
            type="text"
            placeholder="Search…"
            className="bg-transparent flex-1 text-[13px] text-ink-3 placeholder:text-ink-7 outline-none min-w-0"
          />
        </div>
      </div>

      {/* ── User bar ── */}
      <div
        className="flex items-start justify-between"
        style={{ padding: "15px 30px 16px" }}
      >
        {/* Left: avatar + identity */}
        <div className="flex items-start gap-3">
          {/* 44px avatar */}
          <div
            className={`size-11 rounded-full flex items-center justify-center shrink-0 font-semibold text-sm select-none ${tint}`}
          >
            {initials}
          </div>

          {/* Identity block */}
          <div className="flex flex-col gap-0.5">
            {/* Name row */}
            <div className="flex items-center gap-1.5">
              {flag && (
                <span className="text-base leading-none">{flag}</span>
              )}
              <span className="text-[18px] font-semibold text-ink-1 leading-snug">
                {displayName}
              </span>
            </div>

            {/* Email */}
            {conversation.visitorEmail && (
              <span className="text-[12px] text-ink-7 leading-none">
                {conversation.visitorEmail}
              </span>
            )}

            {/* Meta line */}
            <div className="flex items-center gap-2 mt-1">
              {/* Status dot + label */}
              <div className="flex items-center gap-1">
                <span className={`size-2 rounded-full shrink-0 ${dotClass}`} />
                <span className="text-[12px] text-ink-7">{statusLabel}</span>
              </div>

              {metaItems.map((item, i) => (
                <span
                  key={i}
                  className="text-[12px] text-ink-7 before:content-['·'] before:mr-2"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Priority menu */}
        <div className="shrink-0 mt-0.5">
          <PriorityMenu
            value={conversation.priority ?? "medium"}
            onChange={(p) => onPriority(conversation.id, p)}
          />
        </div>
      </div>
    </>
  );
}
