/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow } from "../db/schema";
import { buildHelpUrl } from "./build-help-url";

export interface MobileCategoryNavProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  activeCategorySlug: string | null;
  helpCustomUrl: string | null;
}

export function MobileCategoryNav(props: MobileCategoryNavProps) {
  if (props.categories.length === 0) return null;
  return (
    <div class="help-mobile-cats">
      <label class="sr-only" for="help-mobile-cat-select">
        Jump to category
      </label>
      <select
        id="help-mobile-cat-select"
        aria-label="Jump to category"
        onchange="if(this.value)window.location.href=this.value"
      >
        {props.categories.map((cat) => {
          const href = buildHelpUrl({
            projectSlug: props.project.slug,
            customUrl: props.helpCustomUrl,
            category: cat.slug,
          });
          const isActive = cat.slug === props.activeCategorySlug;
          return (
            <option value={href} selected={isActive}>
              {cat.name}
            </option>
          );
        })}
      </select>
    </div>
  );
}
