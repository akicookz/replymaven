import {
  CheckIcon,
  ClockIcon,
  FlagIcon,
  ArrowLeftIcon,
  SearchIcon,
  ShieldOffIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XIcon,
} from "lucide-react";
import type { Conversation } from "@/lib/inbox/types";
import { countryFlag } from "@/lib/inbox/country-flag";
import { cn } from "@/lib/utils";
import PriorityMenu from "./PriorityMenu";
import AssigneeMenu from "./AssigneeMenu";

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

function isSnoozedNow(c: Conversation): boolean {
  return !!c.snoozedUntil && new Date(c.snoozedUntil).getTime() > Date.now();
}

// Single source of truth for "what state is this thread in" — drives the dot +
// label shown once under the avatar.
function conversationState(c: Conversation): { label: string; dotClass: string } {
  if (c.visitorBlocked) return { label: "Blocked", dotClass: "bg-red-400" };
  if (c.status === "closed") {
    if (c.closeReason === "spam") return { label: "Spam", dotClass: "bg-dot-orange" };
    return { label: "Resolved", dotClass: "bg-dot-gray" };
  }
  if (isSnoozedNow(c)) return { label: "Snoozed", dotClass: "bg-amber-400" };
  return { label: "Open", dotClass: "bg-dot-green" };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReadingHeaderProps {
  conversation: Conversation;
  onResolve: (convId: string) => void;
  onSnooze: (convId: string, until: number | null) => void;
  onFlagSpam: (convId: string) => void;
  onPriority: (convId: string, priority: "low" | "medium" | "high") => void;
  onBlock: (convId: string) => void;
  onAssign: (convId: string, assigneeId: string | null) => void;
  onFocus: () => void;
  /** Mobile: go back to the conversation list. */
  onBack?: () => void;
  // Desktop: inline search field (highlight + jump between matches).
  search: string;
  onSearchChange: (q: string) => void;
  matchCount: number;
  matchIndex: number;
  onMatchNext: () => void;
  onMatchPrev: () => void;
  /** Mobile: open the full-page search modal. */
  onOpenSearch: () => void;
  /** A search query is currently active (tints the mobile search icon). */
  searchActive: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReadingHeader({
  conversation,
  onResolve,
  onSnooze,
  onFlagSpam,
  onPriority,
  onBlock,
  onAssign,
  onFocus,
  onBack,
  search,
  onSearchChange,
  matchCount,
  matchIndex,
  onMatchNext,
  onMatchPrev,
  onOpenSearch,
  searchActive,
}: ReadingHeaderProps) {
  const meta = parseMetadata(conversation.metadata);
  const country: string | undefined = meta.country;
  const city: string | undefined = meta.city ?? meta.location;
  const browser: string | undefined = meta.browser;

  const state = conversationState(conversation);
  const duration = chatDuration(conversation.createdAt);
  const flag = countryFlag(country);

  // Active states reflected on the toolbar icons.
  const isResolved =
    conversation.status === "closed" && conversation.closeReason !== "spam";
  const isSnoozed = isSnoozedNow(conversation);
  const isSpam = conversation.closeReason === "spam";
  const isBlocked = !!conversation.visitorBlocked;

  const displayName =
    conversation.visitorName ?? conversation.visitorEmail ?? conversation.visitorId;
  const initials = getInitials(conversation.visitorName ?? conversation.visitorEmail);
  const tint = avatarTint(conversation.visitorId);

  // Toggle: when already snoozed, the lit clock un-snoozes (until=null);
  // otherwise snooze until tomorrow (24h from now).
  const snoozeTomorrow = () => {
    onSnooze(conversation.id, isSnoozed ? null : Date.now() + 86_400_000);
  };

  // Build meta items for the user bar.
  const metaItems: string[] = [];
  if (flag && country) metaItems.push(`${flag} ${city ?? country}`);
  else if (city) metaItems.push(city);
  metaItems.push(`In chat ${duration}`);
  if (browser) metaItems.push(browser);

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onMatchPrev();
      else onMatchNext();
    } else if (e.key === "Escape") {
      onSearchChange("");
    }
  }

  return (
    <div className="glass-bar shrink-0">
      {/* ── Toolbar row ── */}
      <div className="flex items-center gap-2 px-3 md:px-[22px] py-[11px]">
        {/* Back (mobile only) — returns to the conversation list */}
        {onBack && (
          <button
            type="button"
            aria-label="Back to conversations"
            onClick={onBack}
            className="glass-button rounded-glass flex items-center justify-center size-8 text-ink-2 md:hidden shrink-0"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        )}

        {/* Action capsule: Resolve · Snooze · Flag-as-spam. Each icon lights up
            when that state is active (status itself is also shown under avatar). */}
        <div className="flex items-center rounded-glass glass-button overflow-hidden shrink-0">
          <button
            type="button"
            aria-label="Resolve"
            aria-pressed={isResolved}
            onClick={() => onResolve(conversation.id)}
            className={cn(
              "flex items-center justify-center size-8 transition-colors hover:bg-white/5",
              isResolved ? "text-emerald-300 bg-emerald-400/15" : "text-ink-3",
            )}
            title={isResolved ? "Resolved — click to reopen" : "Resolve"}
          >
            <CheckIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Snooze"
            aria-pressed={isSnoozed}
            onClick={snoozeTomorrow}
            className={cn(
              "flex items-center justify-center size-8 transition-colors hover:bg-white/5",
              isSnoozed ? "text-amber-300 bg-amber-400/15" : "text-ink-3",
            )}
            title={isSnoozed ? "Snoozed — click to un-snooze" : "Snooze until tomorrow"}
          >
            <ClockIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Flag as spam"
            aria-pressed={isSpam}
            onClick={() => onFlagSpam(conversation.id)}
            className={cn(
              "flex items-center justify-center size-8 transition-colors hover:bg-white/5",
              isSpam ? "text-dot-orange bg-dot-orange/15" : "text-ink-3",
            )}
            title={
              isSpam
                ? "Flagged as spam — click to un-flag"
                : "Mark as spam (silent — stays under Flagged, no notify)"
            }
          >
            <FlagIcon className="size-4" />
          </button>
        </div>

        {/* Assign to a teammate (lights up when assigned) */}
        <AssigneeMenu
          value={conversation.assigneeId ?? null}
          onChange={(id) => onAssign(conversation.id, id)}
        />

        {/* Block visitor — lights up red when the visitor is banned */}
        <button
          type="button"
          aria-label="Block visitor"
          aria-pressed={isBlocked}
          onClick={() => onBlock(conversation.id)}
          className={cn(
            "glass-button rounded-glass flex items-center justify-center size-8 transition-colors shrink-0",
            isBlocked ? "text-red-400 bg-red-400/15" : "text-ink-3 hover:text-red-400",
          )}
          title={
            isBlocked
              ? "Visitor blocked — click to unblock"
              : "Block visitor (can't message again)"
          }
        >
          <ShieldOffIcon className="size-4" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Focus button (desktop) */}
        <button
          type="button"
          onClick={onFocus}
          className="glass-button rounded-glass hidden md:flex items-center gap-1.5 px-3 h-8 text-ink-3 text-[13px] shrink-0"
        >
          Focus
          <span className="keycap">F</span>
        </button>

        {/* Desktop: full inline search field — highlight + jump between matches */}
        <div className="hidden md:flex glass-button rounded-[8px] items-center gap-1.5 px-2.5 h-8 w-[210px] shrink-0">
          <SearchIcon className="size-3.5 text-ink-7 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Search chat…"
            className="bg-transparent flex-1 text-[13px] text-ink-3 placeholder:text-ink-7 outline-none min-w-0"
          />
          {search && (
            <>
              <span className="text-[11px] text-ink-6 tabular-nums shrink-0">
                {matchCount ? `${matchIndex}/${matchCount}` : "0/0"}
              </span>
              <button
                type="button"
                aria-label="Previous match"
                onClick={onMatchPrev}
                disabled={matchCount === 0}
                className="text-ink-6 hover:text-ink-2 disabled:opacity-30 shrink-0"
              >
                <ChevronUpIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next match"
                onClick={onMatchNext}
                disabled={matchCount === 0}
                className="text-ink-6 hover:text-ink-2 disabled:opacity-30 shrink-0"
              >
                <ChevronDownIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchChange("")}
                className="text-ink-6 hover:text-ink-2 shrink-0"
              >
                <XIcon className="size-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Mobile: search icon → full-page modal */}
        <button
          type="button"
          aria-label="Search conversation"
          onClick={onOpenSearch}
          className={cn(
            "glass-button rounded-glass flex md:hidden items-center justify-center size-8 transition-colors shrink-0",
            searchActive ? "text-[--brand] bg-glass-raised" : "text-ink-3 hover:text-ink-1",
          )}
          title="Search conversation"
        >
          <SearchIcon className="size-4" />
        </button>
      </div>

      {/* ── User bar ── */}
      <div className="flex items-start justify-between gap-4 px-4 md:px-[30px] pt-[15px] pb-4">
        {/* Left: avatar + identity (takes the available width so the meta line
            doesn't wrap prematurely) */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* 44px avatar */}
          <div
            className={`size-11 rounded-full flex items-center justify-center shrink-0 font-semibold text-sm select-none ${tint}`}
          >
            {initials}
          </div>

          {/* Identity block */}
          <div className="flex flex-col gap-0.5 min-w-0">
            {/* Name row */}
            <div className="flex items-center gap-1.5 min-w-0">
              {flag && <span className="text-base leading-none shrink-0">{flag}</span>}
              <span className="text-[18px] font-semibold text-ink-1 leading-snug truncate">
                {displayName}
              </span>
            </div>

            {/* Email */}
            {conversation.visitorEmail && (
              <span className="text-[12px] text-ink-7 leading-none truncate">
                {conversation.visitorEmail}
              </span>
            )}

            {/* Meta line — single row; stays put while there's width to spare */}
            <div className="flex items-center gap-2 mt-1 whitespace-nowrap">
              {/* Status dot + label */}
              <div className="flex items-center gap-1">
                <span className={`size-2 rounded-full shrink-0 ${state.dotClass}`} />
                <span className="text-[12px] text-ink-7">{state.label}</span>
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
    </div>
  );
}
