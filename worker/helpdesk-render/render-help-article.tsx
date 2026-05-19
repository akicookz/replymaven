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

interface RenderHelpArticleProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  article: HelpArticleRow;
  bodyHtml: string;
  prevArticle: HelpArticleRow | null;
  nextArticle: HelpArticleRow | null;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
}

export function renderHelpArticle(props: RenderHelpArticleProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
    category: props.category.slug,
    article: props.article.slug,
  });
  const title = `${props.article.title} — ${props.project.name} Help`;
  const description =
    props.article.excerpt ??
    `${props.article.title} — help article from ${props.project.name}.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: props.article.title,
    description: props.article.excerpt ?? "",
    url: canonical,
    datePublished:
      props.article.publishedAt instanceof Date
        ? props.article.publishedAt.toISOString()
        : new Date().toISOString(),
    dateModified:
      props.article.updatedAt instanceof Date
        ? props.article.updatedAt.toISOString()
        : new Date().toISOString(),
    author: { "@type": "Organization", name: props.project.name },
    publisher: { "@type": "Organization", name: props.project.name },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      jsonLd={jsonLd}
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

      <article class="help-page">
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
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
              category: props.category.slug,
            })}
          >
            {props.category.name}
          </a>
          <span class="help-breadcrumb-sep">/</span>
          <span class="help-breadcrumb-current">{props.article.title}</span>
        </nav>

        <header>
          <h1 class="help-page-title">{props.article.title}</h1>
          {props.article.excerpt && (
            <p class="help-page-subtitle">{props.article.excerpt}</p>
          )}
        </header>

        <div
          class="help-prose"
          style="margin-top: 2.5rem"
          dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
        />

        {(props.prevArticle || props.nextArticle) && (
          <nav class="help-article-nav" aria-label="Article pagination">
            {props.prevArticle ? (
              <a
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.prevArticle.slug,
                })}
              >
                <p class="help-article-nav-direction">Previous</p>
                <p class="help-article-nav-title">{props.prevArticle.title}</p>
              </a>
            ) : (
              <div />
            )}
            {props.nextArticle ? (
              <a
                class="help-article-nav-next"
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.nextArticle.slug,
                })}
              >
                <p class="help-article-nav-direction">Next</p>
                <p class="help-article-nav-title">{props.nextArticle.title}</p>
              </a>
            ) : (
              <div />
            )}
          </nav>
        )}
      </article>
    </Layout>
  );
}
