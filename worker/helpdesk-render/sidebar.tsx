/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import { buildHelpUrl } from "./build-help-url";
import { HelpIcon } from "./icons";
import { isImageIcon } from "../../shared/help-icons";

export interface HelpSidebarProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  widgetConfig?: WidgetConfigRow | null;
  activeCategorySlug?: string | null;
  helpCustomUrl: string | null;
}

export function HelpSidebar(props: HelpSidebarProps) {
  const homeHref = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const avatarUrl = props.widgetConfig?.avatarUrl ?? null;

  return (
    <aside class="help-sidebar">
      <div class="help-sidebar-inner">
        <div class="help-sidebar-header">
          <a class="help-sidebar-home" href={homeHref}>
            {avatarUrl && (
              <img
                class="help-sidebar-avatar"
                src={avatarUrl}
                alt=""
                role="presentation"
                loading="lazy"
                decoding="async"
              />
            )}
            <span class="help-sidebar-home-project">{props.project.name}</span>
          </a>
          <button
            type="button"
            class="help-sidebar-search"
            onclick="if(window.ReplyMaven)window.ReplyMaven.open()"
            aria-label="Search"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>

        {props.categories.length > 0 && (
          <nav class="help-sidebar-nav" aria-label="Help categories">
            <ul class="help-sidebar-list">
              {props.categories.map((category) => {
                const isActive = category.slug === props.activeCategorySlug;
                const itemClass = isActive
                  ? "help-sidebar-item help-sidebar-item-active"
                  : "help-sidebar-item";
                return (
                  <li>
                    <a
                      class={itemClass}
                      aria-current={isActive ? "page" : undefined}
                      href={buildHelpUrl({
                        projectSlug: props.project.slug,
                        customUrl: props.helpCustomUrl,
                        category: category.slug,
                      })}
                    >
                      {!isImageIcon(category.icon) && (
                        <HelpIcon
                          name={category.icon ?? "BookOpen"}
                          class="help-sidebar-item-icon"
                        />
                      )}
                      <span class="help-sidebar-item-label">{category.name}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div class="help-sidebar-footer">
          <a
            class="help-sidebar-poweredby"
            href="https://replymaven.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Powered by ReplyMaven
          </a>
        </div>
      </div>
    </aside>
  );
}
