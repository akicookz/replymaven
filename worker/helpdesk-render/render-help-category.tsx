/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { MobileCategoryNav } from "./mobile-category-nav";

interface RenderHelpCategoryProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  articles: HelpArticleRow[];
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
}

export function renderHelpCategory(props: RenderHelpCategoryProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
    category: props.category.slug,
  });
  const title = `${props.category.name} — ${props.project.name} Help`;
  const description =
    props.category.description ??
    `Help articles in the ${props.category.name} category.`;

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
          activeCategorySlug={props.category.slug}
          helpCustomUrl={props.helpCustomUrl}
        />
      }
    >
      <MobileCategoryNav
        project={props.project}
        categories={props.categories}
        activeCategorySlug={props.category.slug}
        helpCustomUrl={props.helpCustomUrl}
      />

      <div class="help-page">
        <nav class="help-breadcrumb" aria-label="Breadcrumb">
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
            })}
          >
            {props.project.name}
          </a>
          <span class="help-breadcrumb-sep">/</span>
          <span class="help-breadcrumb-current">{props.category.name}</span>
        </nav>

        <header>
          <h1 class="help-page-title">{props.category.name}</h1>
          {props.category.description && (
            <p class="help-page-subtitle">{props.category.description}</p>
          )}
        </header>

        {props.articles.length === 0 ? (
          <div class="help-empty">No articles yet in this category.</div>
        ) : (
          <ul class="help-article-list">
            {props.articles.map((article) => (
              <li>
                <a
                  class="help-article-row"
                  href={buildHelpUrl({
                    projectSlug: props.project.slug,
                    customUrl: props.helpCustomUrl,
                    category: props.category.slug,
                    article: article.slug,
                  })}
                >
                  <p class="help-article-row-title">{article.title}</p>
                  {article.excerpt && (
                    <p class="help-article-row-excerpt">{article.excerpt}</p>
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

