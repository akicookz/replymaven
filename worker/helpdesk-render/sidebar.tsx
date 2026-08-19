/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { buildHelpUrl } from "./build-help-url";
import { HelpIcon } from "./icons";
import { isHelpIconName, isImageIcon } from "../../shared/help-icons";
import { HelpTopNavLinks } from "./top-nav-links";

export interface HelpSidebarProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  activeCategorySlug: string | null;
  activeArticleSlug: string | null;
  helpCustomUrl: string | null;
  widgetConfig: WidgetConfigRow | null;
  topNav: HelpTopNavItem[];
}

export function HelpSidebar(props: HelpSidebarProps) {
  return (
    <aside class="help-sidebar" id="rm-help-sidebar" aria-label="Help menu">
      <HelpTopNavLinks items={props.topNav} class="help-sidebar-topnav" />
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
            <details open={true} class="help-sidebar-group">
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
        <a
          href="https://replymaven.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by
          <span class="help-sidebar-footer-brand">
            <ReplyMavenMark />
            ReplyMaven
          </span>
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

function ReplyMavenMark() {
  return (
    <svg
      class="help-sidebar-footer-mark"
      viewBox="0 0 28 32"
      fill="none"
      aria-hidden="true"
    >
      <mask id="rm-help-mark-mask">
        <rect width="28" height="32" fill="white" />
        <path
          d="M6 14C11.3333 19.3333 16.6667 19.3333 22 14"
          stroke="black"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </mask>
      <path
        mask="url(#rm-help-mark-mask)"
        d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z"
        fill="currentColor"
      />
    </svg>
  );
}
