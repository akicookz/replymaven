/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpIcon } from "./icons";
import { resolveHelpUploadUrl } from "./resolve-help-upload-url";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import { MobileCategoryNav } from "./mobile-category-nav";
import type { HelpThemeDefault } from "./help-theme-default";

interface RenderHelpCategoryProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  articles: HelpArticleNav[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
  themeDefault: HelpThemeDefault;
  noindex?: boolean;
}

export function renderHelpCategory(props: RenderHelpCategoryProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
    category: props.category.slug,
  });
  const title = props.category.name;
  const description = props.category.description?.trim() ?? "";

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      customCss={props.customCss}
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
          activeCategorySlug={props.category.slug}
          activeArticleSlug={null}
          helpCustomUrl={props.helpCustomUrl}
          widgetConfig={props.widgetConfig}
          topNav={props.topNav}
        />
      }
    >
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

        <MobileCategoryNav
          project={props.project}
          categories={props.categories}
          activeCategorySlug={props.category.slug}
          helpCustomUrl={props.helpCustomUrl}
        />

        {props.articles.length === 0 ? (
          <div class="help-empty">No articles yet in this category.</div>
        ) : (
          <ul class="help-doc-grid">
            {props.articles.map((article) => {
              const thumb = resolveHelpUploadUrl(article.ogImageUrl) ?? "";
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
                          src={thumb}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div class="help-doc-card-thumb help-doc-card-thumb-fallback">
                        <HelpIcon name={props.category.icon ?? "FileText"} />
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
