/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow } from "../db/schema";
import { buildHelpUrl } from "./build-help-url";
import { HelpIcon } from "./icons";
import { isImageIcon } from "../../shared/help-icons";

export interface HelpSidebarProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  activeCategorySlug?: string | null;
  helpCustomUrl: string | null;
}

export function HelpSidebar(props: HelpSidebarProps) {
  const homeHref = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });

  return (
    <aside class="help-sidebar">
      <div class="help-sidebar-inner">
        <a class="help-sidebar-home" href={homeHref}>
          <span class="help-sidebar-home-label">Help Center</span>
          <span class="help-sidebar-home-project">{props.project.name}</span>
        </a>

        {props.categories.length > 0 && (
          <nav class="help-sidebar-nav" aria-label="Help categories">
            <p class="help-sidebar-heading">Categories</p>
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
