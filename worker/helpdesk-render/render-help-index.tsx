/** @jsxImportSource hono/jsx */
import type {
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { CategoryCard } from "./category-card";

interface CategoryWithCount extends HelpCategoryRow {
  articleCount: number;
}

interface RenderHelpIndexProps {
  project: ProjectRow;
  categories: CategoryWithCount[];
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
}

export function renderHelpIndex(props: RenderHelpIndexProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const title = `${props.project.name} Help Center`;
  const description = `Browse help articles and guides for ${props.project.name}.`;

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      sidebar={
        <HelpSidebar
          project={props.project}
          categories={props.categories}
          widgetConfig={props.widgetConfig}
          activeCategorySlug={null}
          helpCustomUrl={props.helpCustomUrl}
        />
      }
    >
      <div class="help-index">
        <header class="help-index-hero">
          <div class="help-index-hero-inner">
            <p class="help-index-eyebrow">{props.project.name}</p>
            <h1 class="help-index-title">How can we help?</h1>
            <p class="help-index-subtitle">{description}</p>
            <button
              type="button"
              class="help-index-search"
              onclick="if(window.ReplyMaven)window.ReplyMaven.open()"
              aria-label="Ask a question"
            >
              <svg
                class="help-index-search-icon"
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
              <span class="help-index-search-text">Ask a question…</span>
            </button>
          </div>
        </header>

        <section class="help-index-body">
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
        </section>
      </div>
    </Layout>
  );
}
