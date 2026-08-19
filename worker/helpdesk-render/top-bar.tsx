/** @jsxImportSource hono/jsx */
import type { ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { buildHelpUrl } from "./build-help-url";
import { HelpTopNavLinks } from "./top-nav-links";

const MOON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const SUN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const MENU_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

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
    <header class="help-topbar">
      <div class="help-topbar-inner">
        <button
          id="rm-help-menu"
          type="button"
          class="help-menu-btn"
          aria-label="Open menu"
          aria-controls="rm-help-sidebar"
          aria-expanded="false"
        >
          <span
            class="help-menu-icon-open"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: MENU_SVG }}
          />
          <span
            class="help-menu-icon-close"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: CLOSE_SVG }}
          />
        </button>
        <a class="help-topbar-brand" href={homeHref}>
          {props.widgetConfig?.avatarUrl && (
            <img
              class="help-topbar-logo"
              src={props.widgetConfig.avatarUrl}
              alt=""
              role="presentation"
              loading="lazy"
              decoding="async"
            />
          )}
          <span class="help-topbar-name">{props.project.name}</span>
        </a>
        <div class="help-topbar-actions">
          <HelpTopNavLinks items={props.topNav} class="help-topbar-nav" />
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
