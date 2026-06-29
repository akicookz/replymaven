/** @jsxImportSource hono/jsx */
import type { ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { buildHelpUrl } from "./build-help-url";

const MOON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const SUN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

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
    <header class="sticky top-0 z-30 h-14 border-b border-border bg-background">
      <div class="mx-auto flex h-full max-w-[80rem] items-center gap-4 px-6">
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
        <div class="ml-auto flex items-center gap-1.5">
          {props.topNav.length > 0 && (
            <nav class="flex items-center gap-2" aria-label="Top navigation">
              {props.topNav.map((item) => {
                const isExternal = item.href.startsWith("https://");
                const classes =
                  item.classes?.trim() ||
                  "inline-flex h-9 items-center justify-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
                return (
                  <a
                    href={item.href}
                    class={classes}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
          )}
          <button
            id="rm-theme-toggle"
            type="button"
            aria-label="Toggle dark mode"
            title="Toggle theme"
            class="help-theme-toggle inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span
              class="rm-icon-moon inline-flex"
              dangerouslySetInnerHTML={{ __html: MOON_SVG }}
            />
            <span
              class="rm-icon-sun inline-flex"
              dangerouslySetInnerHTML={{ __html: SUN_SVG }}
            />
          </button>
        </div>
      </div>
    </header>
  );
}
