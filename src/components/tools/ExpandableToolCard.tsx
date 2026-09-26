import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ExpandableToolCardProps {
  mark: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  titleAdornment?: ReactNode;
  status?: ReactNode;
  configured?: boolean;
  disabled?: boolean;
  mode?: "panel" | "action";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onActivate?: () => void;
  panelId?: string;
  trailing?: ReactNode;
  contentClassName?: string;
  children?: ReactNode;
}

function CardRow({
  mark,
  title,
  subtitle,
  titleAdornment,
  status,
}: Pick<
  ExpandableToolCardProps,
  "mark" | "title" | "subtitle" | "titleAdornment" | "status"
>) {
  return (
    <>
      <div className="flex shrink-0 items-center">
        {mark}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {title}
          </p>
          {titleAdornment}
        </div>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {status != null && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground"
        >
          {status}
          <ChevronRight className="size-4" />
        </span>
      )}
    </>
  );
}

const ROW_CLASS =
  "flex min-h-14 w-full min-w-0 items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-glass-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-70";

export function ExpandableToolCard({
  mark,
  title,
  subtitle,
  titleAdornment,
  status,
  configured = true,
  disabled = false,
  mode = "panel",
  open = false,
  onOpenChange,
  onActivate,
  panelId,
  trailing,
  contentClassName,
  children,
}: ExpandableToolCardProps) {
  const shell = cn(
    "box-border overflow-hidden rounded-card",
    configured ? "glass-card" : "border border-dashed border-hairline-strong",
  );
  const row = (
    <CardRow
      mark={mark}
      title={title}
      subtitle={subtitle}
      titleAdornment={titleAdornment}
      status={status}
    />
  );

  if (mode === "action") {
    return (
      <div className={shell}>
        <div className="flex items-stretch">
          <button
            type="button"
            disabled={disabled}
            onClick={onActivate}
            className={cn(ROW_CLASS, trailing && "flex-1")}
          >
            {row}
          </button>
          {trailing}
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <PopoverAnchor asChild>
        <div className={shell}>
          <div className="flex items-stretch">
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                disabled={disabled}
                className={cn(ROW_CLASS, trailing && "flex-1")}
              >
                {row}
              </button>
            </PopoverTrigger>
            {trailing}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        id={panelId}
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className={cn(
          "max-h-[min(34rem,70vh)] w-(--radix-popover-trigger-width) min-w-80 overflow-y-auto p-0",
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default ExpandableToolCard;
