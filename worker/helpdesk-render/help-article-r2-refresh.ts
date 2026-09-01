import type { HelpArticleRow, HelpCategoryRow } from "../db/schema";
import { buildFrontmatterMarkdown } from "./build-frontmatter-md";

export type HelpArticleR2Refresh = "publish" | "unpublish" | "none";

export interface HelpArticleR2Snapshot {
  article: HelpArticleRow;
  category: HelpCategoryRow;
}

const PINNED_UPDATED_AT = new Date(0);

function searchProjection(snapshot: HelpArticleR2Snapshot): string {
  // updatedAt is in the markdown and changes on every D1 write, including
  // sortOrder. Pin it so only searchable fields trigger a republish.
  return buildFrontmatterMarkdown(
    { ...snapshot.article, updatedAt: PINNED_UPDATED_AT },
    snapshot.category,
  );
}

export function helpArticleR2RefreshAction(input: {
  existingStatus: "draft" | "published";
  nextStatus: "draft" | "published";
  before: HelpArticleR2Snapshot | null;
  after: HelpArticleR2Snapshot | null;
}): HelpArticleR2Refresh {
  if (input.existingStatus !== "published" && input.nextStatus === "published") {
    return input.after ? "publish" : "none";
  }
  if (input.existingStatus === "published" && input.nextStatus === "draft") {
    return "unpublish";
  }
  if (
    input.existingStatus === "published" &&
    input.nextStatus === "published" &&
    input.before &&
    input.after &&
    searchProjection(input.before) !== searchProjection(input.after)
  ) {
    return "publish";
  }
  return "none";
}
