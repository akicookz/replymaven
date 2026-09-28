/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow } from "../db/schema";
import { HelpIcon } from "./icons";
import { isImageIcon } from "../../shared/help-icons";
import { resolveHelpUploadUrl } from "./resolve-help-upload-url";

export interface CategoryCardProps {
  category: HelpCategoryRow;
  articleCount: number;
  href: string;
}

// Icon categories get a small tile; image categories use the picture as the card background.
export function CategoryCard(props: CategoryCardProps) {
  const iconValue = props.category.icon;
  const iconSrc = isImageIcon(iconValue)
    ? resolveHelpUploadUrl(iconValue)
    : null;

  const body = (
    <>
      <div class="help-category-card-content">
        <h2 class="help-category-card-title">{props.category.name}</h2>
        {props.category.description && (
          <p class="help-category-card-description">{props.category.description}</p>
        )}
      </div>
      <div class="help-category-card-meta">
        <span>
          {props.articleCount} {props.articleCount === 1 ? "article" : "articles"}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </>
  );

  if (iconSrc) {
    return (
      <a class="help-category-card help-category-card-image" href={props.href}>
        <img
          class="help-category-card-image-bg"
          src={iconSrc}
          alt=""
          role="presentation"
          loading="lazy"
          decoding="async"
        />
        <div class="help-category-card-image-overlay" />
        {body}
      </a>
    );
  }

  return (
    <a class="help-category-card" href={props.href}>
      <div class="help-category-card-icon-mark">
        <HelpIcon name={iconValue ?? "BookOpen"} class="help-category-card-icon-svg" />
      </div>
      {body}
    </a>
  );
}
