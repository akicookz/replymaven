/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow } from "../db/schema";
import { HelpIcon } from "./icons";
import { isImageIcon } from "../../shared/help-icons";

export interface CategoryCardProps {
  category: HelpCategoryRow;
  articleCount: number;
  href: string;
}

export function CategoryCard(props: CategoryCardProps) {
  const iconValue = props.category.icon;

  if (isImageIcon(iconValue)) {
    return (
      <a class="help-category-card help-category-card-image" href={props.href}>
        <img
          class="help-category-card-image-bg"
          src={iconValue!}
          alt=""
          role="presentation"
          loading="lazy"
          decoding="async"
        />
        <div class="help-category-card-image-overlay" />
        <div class="help-category-card-image-content">
          <h2 class="help-category-card-title">{props.category.name}</h2>
        </div>
      </a>
    );
  }

  return (
    <a class="help-category-card help-category-card-icon" href={props.href}>
      <div class="help-category-card-icon-mark">
        <HelpIcon
          name={iconValue ?? "BookOpen"}
          class="help-category-card-icon-svg"
        />
      </div>
      <div class="help-category-card-content">
        <h2 class="help-category-card-title">{props.category.name}</h2>
        {props.category.description && (
          <p class="help-category-card-description">{props.category.description}</p>
        )}
      </div>
    </a>
  );
}
