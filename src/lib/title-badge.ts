// Pure helper for the tab-title "(N) …" badge Layout applies while
// conversations wait for review. Extracted so the prefix-stacking /
// clean-restore behavior is unit-testable without a DOM.
//
// `currentTitle` may already carry a "(N) " prefix from a previous render of
// the same effect — strip it before recomputing so repeated renders never
// stack prefixes (e.g. "(2) (1) ReplyMaven"), and expose the stripped value
// as `base` so the caller can restore a clean title on unmount.
export interface TitleBadgeResult {
  title: string;
  base: string;
}

export function formatTitleWithBadge(
  currentTitle: string,
  count: number,
): TitleBadgeResult {
  const base = currentTitle.replace(/^\(\d+\)\s*/, "");
  return { base, title: count > 0 ? `(${count}) ${base}` : base };
}
