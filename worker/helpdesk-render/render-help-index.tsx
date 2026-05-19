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
          activeCategorySlug={null}
          helpCustomUrl={props.helpCustomUrl}
        />
      }
    >
      <header class="help-index-hero">
        <p class="help-index-eyebrow">{props.project.name}</p>
        <h1 class="help-index-title">How can we help?</h1>
        <p class="help-index-subtitle">{description}</p>
      </header>

      {props.categories.length === 0 ? (
        <div class="help-page">
          <div class="help-empty">No help articles yet.</div>
        </div>
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
    </Layout>
  );
}
