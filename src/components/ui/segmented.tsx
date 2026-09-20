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
        "inset-ring inset-ring-border bg-input-background flex shrink-0 overflow-hidden",
        size === "sm" ? "h-8 rounded-md" : "h-9 rounded-lg",
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
            "font-medium transition-colors",
            size === "sm" ? "px-2.5 text-xs" : "px-4 text-sm",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
