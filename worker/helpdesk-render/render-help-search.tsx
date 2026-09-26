/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { HelpSearchForm } from "./help-home-widgets";
import { HelpTopBar } from "./top-bar";
import type { HelpNav } from "./help-tabs";
import type { HelpThemeDefault } from "./help-theme-default";
import type { HelpAnalyticsEmbed } from "../lib/help-analytics";
import { type HelpSearchResult } from "./help-search";

export type { HelpSearchResult };

interface RenderHelpSearchProps {
  project: ProjectRow;
  nav: HelpNav;
  query: string;
  results: HelpSearchResult[];
  /** Category id to tab name, set only when tabs show in the top bar. */
  tabNames: Map<string, string>;
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
          nav={props.nav}
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
          nav={props.nav}
        />
      }
    >
      <div class="help-page">
        <HelpSearchForm
          action={`${homeUrl}/search`}
          query={props.query}
          autoFocus
        />

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
                    {searchResultBreadcrumb(
                      props.tabNames.get(result.category.id),
                      result.category.name,
                    )}
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

function searchResultBreadcrumb(
  tabName: string | undefined,
  categoryName: string,
): string {
  return tabName ? `${tabName} · ${categoryName}` : categoryName;
}

function searchResultLabel(query: string, count: number): string {
  if (count === 0) return `No results for "${query}".`;
  if (count === 1) return `1 result for "${query}"`;
  return `${count} results for "${query}"`;
}
