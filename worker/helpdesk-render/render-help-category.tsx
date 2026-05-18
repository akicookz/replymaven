/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";

interface RenderHelpCategoryProps {
  project: ProjectRow;
  category: HelpCategoryRow;
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
    >
      <div class="mx-auto max-w-3xl px-6 pt-16 pb-24">
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
          <span class="text-foreground">{props.category.name}</span>
        </nav>

        <header class="mb-10">
          <h1 class="text-4xl font-semibold tracking-tight">
            {props.category.name}
          </h1>
          {props.category.description && (
            <p class="mt-3 text-base text-muted-foreground">
              {props.category.description}
            </p>
          )}
        </header>

        {props.articles.length === 0 ? (
          <div class="rounded-2xl bg-card p-10 text-center text-muted-foreground">
            No articles yet in this category.
          </div>
        ) : (
          <ul class="space-y-3">
            {props.articles.map((article) => (
              <li>
                <a
                  href={buildHelpUrl({
                    projectSlug: props.project.slug,
                    customUrl: props.helpCustomUrl,
                    category: props.category.slug,
                    article: article.slug,
                  })}
                  class="group block rounded-2xl bg-card p-5 transition-colors hover:bg-accent"
                >
                  <h2 class="text-lg font-medium tracking-tight group-hover:text-brand">
                    {article.title}
                  </h2>
                  {article.excerpt && (
                    <p class="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                      {article.excerpt}
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
