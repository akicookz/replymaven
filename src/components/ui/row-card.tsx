// Single-row card that opens something: icon, title, one-line summary, right chevron.
// Pass `to` for a link or `onClick` for a drawer. <RowCard icon={<Icon />} title="Company" summary="Acme · acme.com" onClick={open} />
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface RowCardProps {
  icon: ReactNode;
  title: string;
  summary?: ReactNode;
  /** Shown just before the chevron, e.g. a status badge. */
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  className?: string;
}

export function RowCard({ icon, title, summary, trailing, to, onClick, className }: RowCardProps) {
  const classes = cn(
    "glass-card flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-glass-button",
    className,
  );
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-glass bg-glass-button text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {summary && (
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        )}
      </span>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}
