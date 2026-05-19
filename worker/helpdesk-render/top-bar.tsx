/** @jsxImportSource hono/jsx */
import type { ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { buildHelpUrl } from "./build-help-url";

export interface HelpTopBarProps {
  project: ProjectRow;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
}

export function HelpTopBar(props: HelpTopBarProps) {
  const homeHref = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  return (
    <header class="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background px-6">
      <a
        class="flex items-center gap-2 font-semibold text-foreground transition-opacity hover:opacity-80"
        href={homeHref}
      >
        {props.widgetConfig?.avatarUrl && (
          <img
            class="h-7 w-7 rounded-md bg-muted object-cover"
            src={props.widgetConfig.avatarUrl}
            alt=""
            role="presentation"
            loading="lazy"
            decoding="async"
          />
        )}
        <span class="max-w-72 truncate text-sm">{props.project.name}</span>
      </a>
      {props.topNav.length > 0 && (
        <nav class="ml-auto flex items-center gap-1" aria-label="Top navigation">
          {props.topNav.map((item) => {
            const isExternal = item.href.startsWith("https://");
            if (item.style === "button") {
              return (
                <a
                  href={item.href}
                  class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                >
                  {item.label}
                </a>
              );
            }
            return (
              <a
                href={item.href}
                class="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
    </header>
  );
}
