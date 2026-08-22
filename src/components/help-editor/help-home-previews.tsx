import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryIcon } from "@/components/icon-picker";
import {
  HELP_ICON_SVGS,
  isImageIcon,
} from "../../../shared/help-icons";
import {
  MAX_POPULAR_ARTICLES,
  parsePopularArticleIds,
} from "../../../shared/help-home-markdown";
import "./help-home-previews.css";

interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
}

interface ArticleRow {
  id: string;
  title: string;
  status: "draft" | "published";
  publishedAt: string | null;
}

const SEARCH_ARROW = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

function SearchPreview() {
  return (
    <div className="help-hero-search" aria-hidden="true">
      <span className="help-hero-search-icon">
        <Search size={20} />
      </span>
      <input
        type="search"
        placeholder="Search help center"
        readOnly
        tabIndex={-1}
      />
      <button type="button" tabIndex={-1} aria-hidden="true">
        {SEARCH_ARROW}
      </button>
    </div>
  );
}

function CategoryCardPreview(props: { category: CategoryRow }) {
  const icon = props.category.icon;
  if (icon && isImageIcon(icon)) {
    return (
      <div className="help-category-card help-category-card-image">
        <img
          className="help-category-card-image-bg"
          src={icon}
          alt=""
        />
        <div className="help-category-card-image-overlay" />
        <div className="help-category-card-image-content">
          <p className="help-category-card-title">{props.category.name}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="help-category-card help-category-card-icon">
      <div className="help-category-card-icon-mark">
        <CategoryIcon icon={icon} className="help-category-card-icon-svg" />
      </div>
      <div className="help-category-card-content">
        <p className="help-category-card-title">{props.category.name}</p>
        {props.category.description ? (
          <p className="help-category-card-description">
            {props.category.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function pickerEmptyLabel(loading: boolean, publishedCount: number): string {
  if (loading) return "Loading…";
  if (publishedCount === 0) return "No published articles";
  return "All articles added";
}

function CategoriesPreview(props: { categories: CategoryRow[] }) {
  if (props.categories.length === 0) {
    return <div className="help-empty">No help articles yet.</div>;
  }
  return (
    <div className="help-index-grid">
      {props.categories.map((category) => (
        <CategoryCardPreview key={category.id} category={category} />
      ))}
    </div>
  );
}

function PopularEditor(props: {
  articleIds: string[];
  onArticleIdsChange: (ids: string[]) => void;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const articlesQuery = useQuery<ArticleRow[]>({
    queryKey: ["help-articles", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
    enabled: !!projectId,
  });

  const articleIds = parsePopularArticleIds(props.articleIds.join(","));
  const articles = articlesQuery.data ?? [];
  const byId = new Map<string, ArticleRow>();
  for (const article of articles) byId.set(article.id.toLowerCase(), article);

  const selected = articleIds.map((id) => {
    const article = byId.get(id);
    return {
      id,
      title: article?.title ?? "Article unavailable",
    };
  });

  const published = articles.filter((article) => article.status === "published");
  const available = published.filter(
    (article) => !articleIds.includes(article.id.toLowerCase()),
  );
  const canAdd = articleIds.length < MAX_POPULAR_ARTICLES;

  function addArticle(id: string) {
    const next = parsePopularArticleIds([...articleIds, id].join(","));
    if (next.length === articleIds.length) return;
    props.onArticleIdsChange(next);
  }

  function removeArticle(id: string) {
    props.onArticleIdsChange(articleIds.filter((item) => item !== id));
  }

  return (
    <aside className="help-popular">
      <p className="help-popular-title">
        <span
          className="help-popular-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: HELP_ICON_SVGS.TrendingUp }}
        />
        Popular Articles
      </p>
      {selected.length > 0 ? (
        <ul className="help-popular-list">
          {selected.map((article) => (
            <li key={article.id}>
              <span className="help-popular-link">
                <span>{article.title}</span>
                <span className="help-popular-arrow" aria-hidden="true">
                  →
                </span>
                <button
                  type="button"
                  className="help-popular-remove"
                  aria-label={`Remove ${article.title}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => removeArticle(article.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {canAdd ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="help-popular-add"
              onMouseDown={(event) => event.preventDefault()}
            >
              <Plus className="h-4 w-4" />
              List an article
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="max-h-72 w-(--radix-dropdown-menu-trigger-width)"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {available.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {pickerEmptyLabel(articlesQuery.isLoading, published.length)}
              </div>
            ) : (
              available.map((article) => (
                <DropdownMenuItem
                  key={article.id}
                  onSelect={() => addArticle(article.id)}
                >
                  <span className="truncate">{article.title}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </aside>
  );
}

export function HelpHomeBlockPreview(props: {
  kind: "search" | "categories" | "popular";
  articleIds?: string[];
  onArticleIdsChange?: (ids: string[]) => void;
}) {
  const { projectId } = useParams<{ projectId: string }>();

  const categoriesQuery = useQuery<CategoryRow[]>({
    queryKey: ["help-categories", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/help/categories`);
      if (!res.ok) throw new Error("Failed to load categories");
      return res.json();
    },
    enabled: !!projectId && props.kind === "categories",
  });

  const categories = useMemo(() => {
    const rows = categoriesQuery.data ?? [];
    return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categoriesQuery.data]);

  if (props.kind === "search") return <SearchPreview />;
  if (props.kind === "categories") {
    return <CategoriesPreview categories={categories} />;
  }
  return (
    <PopularEditor
      articleIds={props.articleIds ?? []}
      onArticleIdsChange={props.onArticleIdsChange ?? (() => undefined)}
    />
  );
}
