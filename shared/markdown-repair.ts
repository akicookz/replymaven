/**
 * Repair markdown where a block-level image is glued to the block that
 * follows it on the same line (`![](url)## Heading`, `![](url)---`). The
 * editor's image serializer used to omit the trailing block separator, so
 * articles saved before the fix carry this corruption. Splitting gives the
 * image its own paragraph and lets the next block parse normally.
 *
 * Used by both the worker renderer (published pages) and the dashboard
 * editor (on load — so the article heals permanently on its next save).
 */
export function splitGluedImageBlocks(markdown: string): string {
  return markdown
    .replace(/^(!\[[^\]\n]*\]\([^()\n]*\))(?=\S)/gm, "$1\n\n")
    .replace(/^(<img\b[^>\n]*\/?>)(?=\S)/gm, "$1\n\n");
}
