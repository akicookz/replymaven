import type { LucideIcon } from "lucide-react";
import {
  ChevronRight,
  History,
  Lightbulb,
  ListTree,
  PenLine,
  UserRoundSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidechatSuggestion {
  id: string;
  label: string;
  prompt: string;
  icon: LucideIcon;
  emphasized?: boolean;
}

const SIDECHAT_EMPTY_SUGGESTIONS: SidechatSuggestion[] = [
  {
    id: "help",
    label: "How can Maven help me?",
    prompt: "What can you help me with in this conversation?",
    icon: Lightbulb,
    emphasized: true,
  },
  {
    id: "draft",
    label: "Draft a reply",
    prompt: "Draft a visitor-ready reply for this conversation.",
    icon: PenLine,
  },
  {
    id: "catch-up",
    label: "Catch me up",
    prompt: "Summarize this conversation and what still needs an answer.",
    icon: ListTree,
  },
  {
    id: "lookup",
    label: "Look up this customer",
    prompt: "Look up this customer in connected tools if you can.",
    icon: UserRoundSearch,
  },
  {
    id: "timeline",
    label: "Give me their activity timeline",
    prompt: "Give me this customer's activity timeline from connected tools.",
    icon: History,
  },
];

interface SidechatEmptySuggestionsProps {
  disabled?: boolean;
  onSelect: (prompt: string) => void;
}

export default function SidechatEmptySuggestions({
  disabled = false,
  onSelect,
}: SidechatEmptySuggestionsProps) {
  return (
    <div className="px-5 pb-5" data-sidechat-suggestions>
      <h3 className="px-2 text-[13px] font-semibold text-ink-1">
        Suggestions
      </h3>
      <ul className="mt-1.5 flex flex-col">
        {SIDECHAT_EMPTY_SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          return (
            <li key={suggestion.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(suggestion.prompt)}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] leading-snug motion-safe:transition-[color,background-color,scale] motion-safe:duration-150 motion-safe:active:scale-[0.99]",
                  "hover:bg-glass-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-40",
                  suggestion.emphasized
                    ? "font-medium text-brand-soft hover:text-brand-soft"
                    : "text-ink-4 hover:text-ink-2",
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="size-4 shrink-0"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">{suggestion.label}</span>
                {suggestion.emphasized && (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 opacity-70"
                    strokeWidth={2}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
