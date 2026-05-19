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
    <header class="help-topbar">
      <a class="help-topbar-brand" href={homeHref}>
        {props.widgetConfig?.avatarUrl && (
          <img
            class="help-topbar-avatar"
            src={props.widgetConfig.avatarUrl}
            alt=""
            role="presentation"
            loading="lazy"
            decoding="async"
          />
        )}
        <span class="help-topbar-name">{props.project.name}</span>
      </a>
      {props.topNav.length > 0 && (
        <nav class="help-topbar-nav" aria-label="Top navigation">
          {props.topNav.map((item) => {
            const isExternal = item.href.startsWith("https://");
            return (
              <a
                href={item.href}
                class={
                  item.style === "button"
                    ? "help-topbar-cta"
                    : "help-topbar-link"
                }
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
