/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";

interface RenderHelpArticleProps {
  project: ProjectRow;
  category: HelpCategoryRow;
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
  const description = props.article.excerpt ?? `${props.article.title} — help article from ${props.project.name}.`;

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
    >
      <article class="mx-auto max-w-3xl px-6 pt-16 pb-24">
        <nav class="mb-6 text-sm text-muted-foreground">
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
            })}
            class="hover:text-foreground"
          >
            {props.project.name} Help
          </a>
          <span class="mx-2">/</span>
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
              category: props.category.slug,
            })}
            class="hover:text-foreground"
          >
            {props.category.name}
          </a>
        </nav>

        <header class="mb-10">
          <h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">
            {props.article.title}
          </h1>
          {props.article.excerpt && (
            <p class="mt-4 text-lg text-muted-foreground">
              {props.article.excerpt}
            </p>
          )}
        </header>

        <div
          class="help-prose"
          dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
        />

        {(props.prevArticle || props.nextArticle) && (
          <nav class="mt-16 grid gap-4 sm:grid-cols-2">
            {props.prevArticle ? (
              <a
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.prevArticle.slug,
                })}
                class="rounded-2xl bg-card p-5 transition-colors hover:bg-accent"
              >
                <p class="text-xs uppercase tracking-wide text-muted-foreground">
                  Previous
                </p>
                <p class="mt-1 text-base font-medium">
                  {props.prevArticle.title}
                </p>
              </a>
            ) : (
              <div />
            )}
            {props.nextArticle ? (
              <a
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.nextArticle.slug,
                })}
                class="rounded-2xl bg-card p-5 text-right transition-colors hover:bg-accent"
              >
                <p class="text-xs uppercase tracking-wide text-muted-foreground">
                  Next
                </p>
                <p class="mt-1 text-base font-medium">
                  {props.nextArticle.title}
                </p>
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
