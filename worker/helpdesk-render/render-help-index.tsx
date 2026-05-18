import type {
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";

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
    >
      <div class="mx-auto max-w-5xl px-6 pt-20 pb-24">
        <header class="mb-12 text-center">
          <p class="text-sm uppercase tracking-widest text-muted-foreground">
            {props.project.name}
          </p>
          <h1 class="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            How can we help?
          </h1>
          <p class="mt-4 text-base text-muted-foreground">
            {description}
          </p>
        </header>

        {props.categories.length === 0 ? (
          <div class="rounded-2xl bg-card p-12 text-center text-muted-foreground">
            No help articles yet.
          </div>
        ) : (
          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {props.categories.map((category) => (
              <a
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: category.slug,
                })}
                class="group block rounded-2xl bg-card p-6 transition-colors hover:bg-accent"
              >
                <h2 class="text-lg font-semibold tracking-tight group-hover:text-brand">
                  {category.name}
                </h2>
                {category.description && (
                  <p class="mt-2 text-sm text-muted-foreground line-clamp-3">
                    {category.description}
                  </p>
                )}
                <p class="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
                  {category.articleCount}{" "}
                  {category.articleCount === 1 ? "article" : "articles"}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
