/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";

export interface HelpSearchResult {
  article: HelpArticleRow;
  category: HelpCategoryRow;
  score: number | null;
}

interface RenderHelpSearchProps {
  project: ProjectRow;
  query: string;
  results: HelpSearchResult[];
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
}

export function renderHelpSearch(props: RenderHelpSearchProps) {
  const homeUrl = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const canonical = homeUrl;
  const title = props.query
    ? `Search: ${props.query} — ${props.project.name} Help`
    : `Search — ${props.project.name} Help`;
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
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
            </svg>
          </span>
          <input
            type="search"
            name="q"
            value={props.query}
            placeholder="Ask, search, or explain..."
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
              stroke-width="2"
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
            {props.results.length === 0
              ? `No results for "${props.query}".`
              : `${props.results.length} ${props.results.length === 1 ? "result" : "results"} for "${props.query}"`}
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
