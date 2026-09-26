import { cn } from "@/lib/utils";

// Single-select control for a handful of short options that should all stay
// visible. Use instead of Select when the choice is 2-4 one-word values.
// Height and radius track the Button/Input scale so it lines up in a row.

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onValueChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "default";
  className?: string;
}

function Segmented<T extends string>({
  value,
  options,
  onValueChange,
  label,
  size = "default",
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "glass-control hover:bg-glass-button flex shrink-0 items-center gap-0.5 p-0.5",
        size === "sm" ? "h-8 rounded-[10px]" : "h-9 rounded-[11px]",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            "h-full font-medium transition-colors focus-visible:outline-none focus-visible:inset-ring focus-visible:inset-ring-hairline-strong",
            size === "sm" ? "rounded-[8px] px-2.5 text-xs" : "rounded-glass px-3 text-[13px]",
            value === option.value
              ? "bg-glass-raised text-ink-1 shadow-[inset_0_1px_0_0_var(--hairline-strong)]"
              : "text-ink-6 hover:text-ink-2",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
