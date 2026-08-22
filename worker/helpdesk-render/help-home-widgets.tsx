/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import { buildHelpUrl } from "./build-help-url";
import { CategoryCard } from "./category-card";
import { HelpIcon } from "./icons";

export interface CategoryWithCount extends HelpCategoryRow {
  articleCount: number;
}

export interface PopularArticleEntry {
  article: HelpArticleNav;
  category: HelpCategoryRow;
}

export function HelpSearchForm(props: { action: string }) {
  return (
    <form
      action={props.action}
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
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        type="search"
        name="q"
        placeholder="Search help center"
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
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </form>
  );
}

export function HelpCategoryGrid(props: {
  projectSlug: string;
  customUrl: string | null;
  categories: CategoryWithCount[];
}) {
  if (props.categories.length === 0) {
    return <div class="help-empty">No help articles yet.</div>;
  }
  return (
    <div class="help-index-grid">
      {props.categories.map((category) => (
        <CategoryCard
          category={category}
          articleCount={category.articleCount}
          href={buildHelpUrl({
            projectSlug: props.projectSlug,
            customUrl: props.customUrl,
            category: category.slug,
          })}
        />
      ))}
    </div>
  );
}

export function HelpPopularArticles(props: {
  projectSlug: string;
  customUrl: string | null;
  popularArticles: PopularArticleEntry[];
}) {
  if (props.popularArticles.length === 0) return null;
  return (
    <aside class="help-popular">
      <h2 class="help-popular-title">
        <HelpIcon name="TrendingUp" class="help-popular-icon" />
        Popular Articles
      </h2>
      <ul class="help-popular-list">
        {props.popularArticles.map(({ article, category }) => (
          <li>
            <a
              class="help-popular-link"
              href={buildHelpUrl({
                projectSlug: props.projectSlug,
                customUrl: props.customUrl,
                category: category.slug,
                article: article.slug,
              })}
            >
              <span>{article.title}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
