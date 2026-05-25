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
import { extractFirstImage } from "./extract-first-image";
import { HelpIcon } from "./icons";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import { MobileCategoryNav } from "./mobile-category-nav";

interface RenderHelpCategoryProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  articles: HelpArticleRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
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
          activeCategorySlug={props.category.slug}
          activeArticleSlug={null}
          helpCustomUrl={props.helpCustomUrl}
          widgetConfig={props.widgetConfig}
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
          <ul class="help-doc-grid">
            {props.articles.map((article) => {
              const thumb = extractFirstImage(article.content ?? "");
              return (
                <li>
                  <a
                    class="help-doc-card"
                    href={buildHelpUrl({
                      projectSlug: props.project.slug,
                      customUrl: props.helpCustomUrl,
                      category: props.category.slug,
                      article: article.slug,
                    })}
                  >
                    {thumb ? (
                      <div class="help-doc-card-thumb">
                        <img
                          src={thumb.url}
                          alt={thumb.alt}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div class="help-doc-card-thumb help-doc-card-thumb-fallback">
                        <HelpIcon name="FileText" />
                      </div>
                    )}
                    <div class="help-doc-card-body">
                      <p class="help-doc-card-title">{article.title}</p>
                      {article.excerpt && (
                        <p class="help-doc-card-excerpt">{article.excerpt}</p>
                      )}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Layout>
  );
}
