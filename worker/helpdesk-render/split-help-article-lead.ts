/**
 * Cut published article HTML after the lead block so the mobile category
 * select can sit under the excerpt: H1 + the first paragraph that follows it.
 * If there is no paragraph, the cut is right after the H1.
 */
export function splitHelpArticleLead(html: string): { head: string; tail: string } {
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(html);
  if (h1 && h1.index !== undefined) {
    const afterH1 = h1.index + h1[0].length;
    const rest = html.slice(afterH1);
    const paragraph = /^\s*<p\b[^>]*>[\s\S]*?<\/p>/i.exec(rest);
    if (paragraph) {
      const cut = afterH1 + paragraph[0].length;
      return { head: html.slice(0, cut), tail: html.slice(cut).replace(/^\s+/, "") };
    }
    return { head: html.slice(0, afterH1), tail: rest.replace(/^\s+/, "") };
  }
  const paragraph = /<p\b[^>]*>[\s\S]*?<\/p>/i.exec(html);
  if (paragraph && paragraph.index !== undefined) {
    const cut = paragraph.index + paragraph[0].length;
    return { head: html.slice(0, cut), tail: html.slice(cut).replace(/^\s+/, "") };
  }
  return { head: html, tail: "" };
}
