/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { buildHelpUrl } from "./build-help-url";
import { HelpIcon } from "./icons";
import { isHelpIconName, isImageIcon } from "../../shared/help-icons";

export interface HelpSidebarProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  activeCategorySlug: string | null;
  activeArticleSlug: string | null;
  helpCustomUrl: string | null;
  widgetConfig: WidgetConfigRow | null;
}

export function HelpSidebar(props: HelpSidebarProps) {
  return (
    <aside class="help-sidebar">
      <nav class="help-sidebar-nav" aria-label="Help categories">
        {props.categories.map((category) => {
          const articles = props.articlesByCategory.get(category.id) ?? [];
          const isActiveCategory =
            category.slug === props.activeCategorySlug;
          const categoryHref = buildHelpUrl({
            projectSlug: props.project.slug,
            customUrl: props.helpCustomUrl,
            category: category.slug,
          });
          return (
            <details open={isActiveCategory} class="help-sidebar-group">
              <summary class="help-sidebar-group-summary">
                <span class="help-sidebar-group-icon" aria-hidden="true">
                  {renderCategoryIcon(category.icon)}
                </span>
                <a class="help-sidebar-group-name" href={categoryHref}>
                  {category.name}
                </a>
                <span class="help-sidebar-chevron" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </summary>
              {articles.length > 0 && (
                <ul class="help-sidebar-leaves">
                  {articles.map((article) => {
                    const isActive =
                      isActiveCategory &&
                      article.slug === props.activeArticleSlug;
                    const href = buildHelpUrl({
                      projectSlug: props.project.slug,
                      customUrl: props.helpCustomUrl,
                      category: category.slug,
                      article: article.slug,
                    });
                    return (
                      <li>
                        <a
                          class={
                            isActive
                              ? "help-sidebar-leaf active"
                              : "help-sidebar-leaf"
                          }
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                        >
                          {article.title}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          );
        })}
      </nav>
      <footer class="help-sidebar-footer">
        Powered by{" "}
        <a
          href="https://replymaven.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          ReplyMaven
        </a>
      </footer>
    </aside>
  );
}

function renderCategoryIcon(icon: string | null) {
  if (!icon) return <HelpIcon name="BookOpen" />;
  if (isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        class="help-sidebar-group-icon-img"
        role="presentation"
        loading="lazy"
        decoding="async"
      />
    );
  }
  if (isHelpIconName(icon)) {
    return <HelpIcon name={icon} />;
  }
  return <HelpIcon name="BookOpen" />;
}
