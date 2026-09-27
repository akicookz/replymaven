// Page frame for a Settings section: title, optional one-line description, actions on the right.
// Left-aligned like dashboard pages; `wide` drops the width cap for sections with a live preview.
import type { ReactNode } from "react";
import { MobileMenuButton } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

interface SettingsPageProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function SettingsPage({
  title,
  description,
  actions,
  wide = false,
  children,
}: SettingsPageProps) {
  return (
    <div className={cn("w-full space-y-6", !wide && "max-w-4xl")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-balance text-xl font-bold text-foreground md:text-2xl">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-pretty text-xs text-muted-foreground md:text-sm">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
