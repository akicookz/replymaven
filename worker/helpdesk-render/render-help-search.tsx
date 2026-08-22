/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import type { HelpThemeDefault } from "./help-theme-default";
import type { HelpAnalyticsEmbed } from "../lib/help-analytics";
import { type HelpSearchResult } from "./help-search";

export type { HelpSearchResult };

interface RenderHelpSearchProps {
  project: ProjectRow;
  query: string;
  results: HelpSearchResult[];
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
  analytics: HelpAnalyticsEmbed[];
  themeDefault: HelpThemeDefault;
  noindex?: boolean;
}

export function renderHelpSearch(props: RenderHelpSearchProps) {
  const homeUrl = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const canonical = homeUrl;
  const title = props.query ? `Search: ${props.query}` : "Search";
  const description = props.query
    ? `Search results for "${props.query}".`
    : "Search the help center.";

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      customCss={props.customCss}
      analytics={props.analytics}
      helpCustomUrl={props.helpCustomUrl}
      themeDefault={props.themeDefault}
      noindex={props.noindex}
      topBar={
        <HelpTopBar
          project={props.project}
          widgetConfig={props.widgetConfig}
          helpCustomUrl={props.helpCustomUrl}
          topNav={props.topNav}
        />
      }
      sidebar={
        <HelpSidebar
          project={props.project}
          categories={props.categories}
          articlesByCategory={props.articlesByCategory}
          activeCategorySlug={null}
          activeArticleSlug={null}
          helpCustomUrl={props.helpCustomUrl}
          widgetConfig={props.widgetConfig}
          topNav={props.topNav}
        />
      }
    >
      <div class="help-page">
        <form
          action={`${homeUrl}/search`}
          method="get"
          class="help-hero-search"
          role="search"
        >
          <span class="help-hero-search-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            type="search"
            name="q"
            value={props.query}
            placeholder="Search help center"
            autocomplete="off"
            autofocus
            aria-label="Search help center"
          />
          <button type="submit" aria-label="Search">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>

        {props.query && (
          <p class="help-search-meta">
            {searchResultLabel(props.query, props.results.length)}
          </p>
        )}

        {props.results.length > 0 && (
          <ul class="help-search-results">
            {props.results.map((result) => (
              <li>
                <a
                  class="help-search-result"
                  href={buildHelpUrl({
                    projectSlug: props.project.slug,
                    customUrl: props.helpCustomUrl,
                    category: result.category.slug,
                    article: result.article.slug,
                  })}
                >
                  <p class="help-search-result-breadcrumb">
                    {result.category.name}
                  </p>
                  <h2 class="help-search-result-title">
                    {result.article.title}
                  </h2>
                  {result.article.excerpt && (
                    <p class="help-search-result-excerpt">
                      {result.article.excerpt}
                    </p>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}

function searchResultLabel(query: string, count: number): string {
  if (count === 0) return `No results for "${query}".`;
  if (count === 1) return `1 result for "${query}"`;
  return `${count} results for "${query}"`;
}
