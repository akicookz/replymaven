import { Marked, Renderer, type Tokens } from "marked";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const URL_BASE = "https://replymaven.invalid";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeLink(href: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href, URL_BASE).protocol);
  } catch {
    return false;
  }
}

class MessageMarkdownRenderer extends Renderer {
  override html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }

  override link({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    if (!isSafeLink(href)) return text;

    const titleAttribute = title
      ? ` title="${escapeHtml(title)}"`
      : "";
    return `<a href="${escapeHtml(href)}"${titleAttribute} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:opacity-70">${text}</a>`;
  }

  override image({ text }: Tokens.Image): string {
    return escapeHtml(text);
  }
}

const messageMarkdown = new Marked();
messageMarkdown.setOptions({
  breaks: true,
  gfm: true,
  renderer: new MessageMarkdownRenderer(),
});

export function renderMarkdown(text: string): string {
  return messageMarkdown.parse(text, { async: false });
}
