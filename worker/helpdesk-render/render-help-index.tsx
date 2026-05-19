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
import { CategoryCard } from "./category-card";
import { HelpIcon } from "./icons";

interface CategoryWithCount extends HelpCategoryRow {
  articleCount: number;
}

interface PopularArticleEntry {
  article: HelpArticleRow;
  category: HelpCategoryRow;
}

interface RenderHelpIndexProps {
  project: ProjectRow;
  categories: CategoryWithCount[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  popularArticles: PopularArticleEntry[];
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
}

export function renderHelpIndex(props: RenderHelpIndexProps) {
  const homeUrl = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const canonical = homeUrl;
  const title = `${props.project.name} Help Center`;
  const description = `Browse help articles and guides for ${props.project.name}.`;

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
      <div class="help-index">
        <header class="help-index-hero">
          <div class="help-index-hero-inner">
            <h1 class="help-index-title">How can we help?</h1>
            <p class="help-index-subtitle">{description}</p>
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
                placeholder="Ask, search, or explain..."
                autocomplete="off"
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
          </div>
        </header>

        <section class="help-index-body">
          <div
            class={
              props.popularArticles.length > 0
                ? "grid gap-8 lg:grid-cols-[1fr_320px]"
                : ""
            }
          >
            <div>
              {props.categories.length === 0 ? (
                <div class="help-empty">No help articles yet.</div>
              ) : (
                <div class="help-index-grid">
                  {props.categories.map((category) => (
                    <CategoryCard
                      category={category}
                      articleCount={category.articleCount}
                      href={buildHelpUrl({
                        projectSlug: props.project.slug,
                        customUrl: props.helpCustomUrl,
                        category: category.slug,
                      })}
                    />
                  ))}
                </div>
              )}
            </div>
            {props.popularArticles.length > 0 && (
              <aside class="hidden lg:block">
                <div class="rounded-xl border border-border bg-card p-4">
                  <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <HelpIcon name="Sparkles" class="h-4 w-4 text-primary" />
                    Popular Articles
                  </h2>
                  <ul class="space-y-1">
                    {props.popularArticles.map(({ article, category }) => (
                      <li>
                        <a
                          class="group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          href={buildHelpUrl({
                            projectSlug: props.project.slug,
                            customUrl: props.helpCustomUrl,
                            category: category.slug,
                            article: article.slug,
                          })}
                        >
                          <span class="truncate">{article.title}</span>
                          <span class="text-xs opacity-50 transition-opacity group-hover:opacity-100">
                            →
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
