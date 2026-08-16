import {
  Lexer,
  Marked,
  type Token,
  type Tokens,
  type MarkedExtension,
} from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import sanitizeHtml from "sanitize-html";
import { buildHelpUrl } from "./build-help-url";
import { splitGluedImageBlocks } from "../../shared/markdown-repair";

interface RenderMarkdownOptions {
  projectSlug: string;
  customUrl: string | null | undefined;
}

const ALLOWED_PROTOCOLS = /^(https?:|mailto:|tel:)/i;

const HLJS_REGISTERED = (() => {
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("js", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("ts", typescript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("sh", bash);
  hljs.registerLanguage("shell", bash);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("py", python);
  hljs.registerLanguage("sql", sql);
  return true;
})();

type CalloutVariant = "info" | "warning" | "tip" | "danger";

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export { splitGluedImageBlocks };

/** Deepest heading level the "On this page" rail lists. */
const TOC_MAX_LEVEL = 3;

/**
 * Articles authored in the new editor carry their title as the first H1 in the
 * body. Legacy articles stored the title separately with no H1 in the body.
 * Guarantee a leading H1 so the published page always shows the title once.
 *
 * Detection lexes the body rather than matching `#`, so a setext title
 * (`Title` over `=====`) is recognized as the H1 marked will render.
 */
export function ensureArticleTitle(markdown: string, title: string): string {
  const safeTitle = title.trim();
  if (!safeTitle) return markdown;
  if (startsWithH1(markdown ?? "")) return markdown;
  return `# ${safeTitle}\n\n${markdown ?? ""}`;
}

function startsWithH1(markdown: string): boolean {
  if (!markdown.trim()) return false;
  try {
    const tokens = new Lexer({ gfm: true, breaks: false }).lex(markdown);
    const first = tokens.find((token) => token.type !== "space");
    return first?.type === "heading" && (first as Tokens.Heading).depth === 1;
  } catch {
    return /^#[ \t]/.test(markdown.trimStart());
  }
}

/**
 * Hover-revealed permalink beside a section heading. The article page turns a
 * click into a clipboard copy; without JS it stays an ordinary fragment link.
 */
function sectionAnchor(id: string): string {
  return `<a class="help-anchor" href="#${escapeAttr(id)}" aria-label="Copy link to this section">#</a>`;
}

/** TOC labels carry no inline markup, so drop the emphasis/code markers. */
function tocText(headingText: string): string {
  return headingText.replace(/[*_`]/g, "").trim();
}

function calloutExtension(): MarkedExtension {
  return {
    walkTokens(token) {
      if (token.type !== "blockquote") return;
      const bq = token as Tokens.Blockquote;
      const firstChild = bq.tokens?.[0];
      if (!firstChild || firstChild.type !== "paragraph") return;
      const para = firstChild as Tokens.Paragraph;
      const text = para.text ?? "";
      const match = /^\[!(INFO|WARNING|TIP|DANGER)\]\s*(\r?\n)?([\s\S]*)$/i.exec(
        text,
      );
      if (!match) return;
      const variant = match[1].toLowerCase() as CalloutVariant;
      const remainder = (match[3] ?? "").replace(/^\r?\n/, "");

      (bq as unknown as { calloutVariant: CalloutVariant }).calloutVariant =
        variant;
      if (remainder.trim() === "") {
        bq.tokens = bq.tokens?.slice(1) ?? [];
      } else {
        para.text = remainder;
        if (para.tokens) {
          para.tokens = [{ type: "text", raw: remainder, text: remainder }];
        }
      }
    },
    renderer: {
      blockquote(token: Tokens.Blockquote) {
        const variant = (token as unknown as { calloutVariant?: CalloutVariant })
          .calloutVariant;
        if (!variant) return false;
        const inner = (this as unknown as {
          parser: { parse: (tokens: Tokens.Generic[]) => string };
        }).parser.parse(token.tokens ?? []);
        return `<div class="callout callout-${variant}" data-callout="${variant}">${inner}</div>`;
      },
    },
  };
}

/**
 * A heading inside a callout, blockquote, list item, or step is body content,
 * not a section of the article, so the rail skips it. Only headings at the
 * document root stay unmarked: every other heading is a child of some
 * container token, and walkTokens visits all of them before rendering starts.
 */
function nestedHeadingExtension(nested: WeakSet<Token>): MarkedExtension {
  return {
    walkTokens(token) {
      if (token.type === "heading") return;
      const container = token as { tokens?: Token[]; items?: Token[] };
      markChildHeadings(container.tokens, nested);
      markChildHeadings(container.items, nested);
    },
  };
}

function markChildHeadings(
  children: Token[] | undefined,
  nested: WeakSet<Token>,
): void {
  if (!children) return;
  for (const child of children) {
    if (child.type === "heading") nested.add(child);
  }
}

/**
 * Assigns heading IDs and records the TOC entries in the same pass, so an
 * anchor in the rail can never point at a different heading than the one that
 * carries the ID. `collect` receives entries in document order. Nested
 * headings still get IDs — and still advance the slug counter — they just do
 * not appear in the rail.
 */
function headingIdExtension(
  collect: TocEntry[],
  nested: WeakSet<Token>,
): MarkedExtension {
  return {
    renderer: {
      heading(this: unknown, token: Tokens.Heading) {
        const self = this as {
          parser: { parseInline: (tokens: Tokens.Generic[]) => string };
          headingSeen?: Map<string, number>;
        };
        const inner = self.parser.parseInline(token.tokens ?? []);
        const plain = token.text ?? "";
        const base = slugifyHeading(plain);
        if (!base) return `<h${token.depth}>${inner}</h${token.depth}>`;
        if (!self.headingSeen) self.headingSeen = new Map();
        const n = self.headingSeen.get(base) ?? 0;
        self.headingSeen.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        const isSection = token.depth <= TOC_MAX_LEVEL && !nested.has(token);
        if (isSection) {
          collect.push({ level: token.depth, id, text: tocText(plain) });
        }
        // The h1 is the article title, and the page URL already points there.
        const anchor = isSection && token.depth > 1 ? sectionAnchor(id) : "";
        return `<h${token.depth} id="${id}">${inner}${anchor}</h${token.depth}>`;
      },
    },
  };
}

interface StepToken {
  type: "step";
  raw: string;
  titleTokens: Token[];
  tokens: Token[];
}

/**
 * `:::steps` container with `::step <title>` items, each holding arbitrary
 * nested block markdown:
 *
 *   :::steps
 *   ::step First step title
 *   any markdown blocks...
 *   ::step Second step title
 *   ...
 *   :::
 *
 * Each step becomes its own token (with child `tokens`) so marked's
 * walkTokens — and therefore code highlighting and callouts — reaches the
 * nested content.
 */
function stepsExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: "steps",
        level: "block",
        start(src: string) {
          const i = src.indexOf(":::steps");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const match = /^:::steps[ \t]*\n([\s\S]*?)\n:::[ \t]*(?=\n|$)/.exec(
            src,
          );
          if (!match) return undefined;
          const steps: StepToken[] = [];
          let current: { title: string; body: string[] } | null = null;
          const flush = () => {
            if (!current) return;
            const body = current.body.join("\n").trim();
            const titleTokens: Token[] = [];
            this.lexer.inline(current.title, titleTokens);
            steps.push({
              type: "step",
              raw: "",
              titleTokens,
              tokens: body ? this.lexer.blockTokens(`${body}\n`, []) : [],
            });
            current = null;
          };
          for (const line of match[1].split("\n")) {
            const sm = /^::step\b[ \t]*(.*)$/.exec(line);
            if (sm) {
              flush();
              current = { title: sm[1].trim(), body: [] };
            } else if (current) {
              current.body.push(line);
            }
          }
          flush();
          if (steps.length === 0) return undefined;
          return { type: "steps", raw: match[0], tokens: steps };
        },
        childTokens: ["tokens"],
        renderer(token) {
          const items = this.parser.parse(token.tokens ?? []);
          return `<ol class="help-steps">${items}</ol>`;
        },
      },
      {
        name: "step",
        level: "block",
        childTokens: ["tokens"],
        renderer(token) {
          const step = token as unknown as StepToken;
          const title = this.parser.parseInline(step.titleTokens ?? []);
          const body = this.parser.parse(step.tokens ?? []);
          return `<li class="help-step"><div class="help-step-title">${title}</div><div class="help-step-body">${body}</div></li>`;
        },
      },
    ],
  };
}

/* ─── API doc blocks: fenced code with api-* langs holding JSON ──────────── */

const API_LANGS = new Set([
  "api-endpoint",
  "api-status",
  "api-params",
  "api-examples",
]);

const API_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/**
 * Pull the body back out of `token.raw` — markedHighlight's walkTokens has
 * already HTML-escaped `token.text` by render time, so the raw fence is the
 * only reliable source of the original JSON.
 */
function extractFenceBody(raw: string): string {
  const lines = raw.replace(/\n+$/, "").split("\n");
  if (lines.length < 2) return "";
  return lines.slice(1, /^(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]) ? -1 : undefined).join("\n");
}

function apiBlocksExtension(): MarkedExtension {
  return {
    renderer: {
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").trim().toLowerCase();
        if (!API_LANGS.has(lang)) return false;
        let data: unknown;
        try {
          data = JSON.parse(extractFenceBody(token.raw));
        } catch {
          return false; // corrupt JSON → fall back to a plain code block
        }
        if (typeof data !== "object" || data === null) return false;
        const obj = data as Record<string, unknown>;
        switch (lang) {
          case "api-endpoint":
            return renderApiEndpoint(obj);
          case "api-status":
            return renderApiStatus(obj);
          case "api-params":
            return renderApiParams(obj);
          case "api-examples":
            return renderApiExamples(obj);
        }
        return false;
      },
    },
  };
}

/** Inline markdown (bold, `code`, links…) for short description strings. */
function renderInlineMd(text: string): string {
  const value = String(text ?? "");
  if (!value) return "";
  try {
    const lexer = new Lexer({ gfm: true, breaks: false });
    const tokens = lexer.inlineTokens(value);
    let out = "";
    for (const t of tokens) {
      switch (t.type) {
        case "strong":
          out += `<strong>${renderInlineMd(t.text)}</strong>`;
          break;
        case "em":
          out += `<em>${renderInlineMd(t.text)}</em>`;
          break;
        case "codespan":
          out += `<code>${t.text}</code>`;
          break;
        case "link":
          out += `<a href="${escapeAttr(t.href)}">${renderInlineMd(t.text)}</a>`;
          break;
        default:
          out += escapeHtml("raw" in t ? t.raw : "");
      }
    }
    return out;
  } catch {
    return escapeHtml(value);
  }
}

function renderApiEndpoint(data: Record<string, unknown>): string {
  const rawMethod = String(data.method ?? "GET").toUpperCase();
  const method = API_METHODS.has(rawMethod) ? rawMethod : "GET";
  const path = String(data.path ?? "");
  const description = String(data.description ?? "");
  const desc = description
    ? `<p class="help-api-desc">${renderInlineMd(description)}</p>`
    : "";
  return (
    `<div class="help-api-endpoint">` +
    `<div class="help-api-endpoint-row">` +
    `<span class="help-api-method is-${method.toLowerCase()}">${method}</span>` +
    `<code class="help-api-path">${escapeHtml(path)}</code>` +
    `</div>${desc}</div>`
  );
}

function statusClass(code: string): string {
  const c = code.charAt(0);
  if (c === "2") return "is-2xx";
  if (c === "4") return "is-4xx";
  if (c === "5") return "is-5xx";
  return "is-other";
}

function renderApiStatus(data: Record<string, unknown>): string {
  if (!Array.isArray(data.rows)) return "";
  const rows = data.rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => {
      const code = String(r.code ?? "");
      const description = String(r.description ?? "");
      return (
        `<div class="help-api-status-row">` +
        `<span class="help-api-status-badge ${statusClass(code)}">${escapeHtml(code)}</span>` +
        `<span class="help-api-status-desc">${renderInlineMd(description)}</span>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="help-api-status">${rows}</div>`;
}

function renderApiParams(data: Record<string, unknown>): string {
  if (!Array.isArray(data.rows)) return "";
  const rows = data.rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => {
      const name = String(r.name ?? "");
      const type = String(r.type ?? "");
      const required = r.required === true;
      const description = String(r.description ?? "");
      const requiredBadge = required
        ? `<span class="help-api-param-required">required</span>`
        : "";
      const typeBadge = type
        ? `<span class="help-api-param-type">${escapeHtml(type)}</span>`
        : "";
      const dd = description
        ? `<dd>${renderInlineMd(description)}</dd>`
        : "";
      return (
        `<div class="help-api-param">` +
        `<dt><code>${escapeHtml(name)}</code>${typeBadge}${requiredBadge}</dt>` +
        `${dd}</div>`
      );
    })
    .join("");
  return `<dl class="help-api-params">${rows}</dl>`;
}

function renderApiExamples(data: Record<string, unknown>): string {
  if (!Array.isArray(data.examples)) return "";
  const blocks = data.examples
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => {
      const label = String(e.label ?? "");
      const language = String(e.language ?? "");
      const code = String(e.code ?? "");
      const labelHtml = label
        ? `<div class="help-api-example-label">${escapeHtml(label)}</div>`
        : "";
      return (
        `<div class="help-api-example">${labelHtml}` +
        `<pre><code class="hljs language-${escapeAttr(language)}">${highlightCode(code, language)}</code></pre>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="help-api-examples">${blocks}</div>`;
}

function highlightCode(code: string, lang: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : null;
  try {
    if (language) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // fall through
  }
  return escapeHtml(code);
}

function createMarked(collect: TocEntry[]): Marked {
  const nested = new WeakSet<Token>();
  return new Marked(
    markedHighlight({
      langPrefix: "hljs language-",
      highlight: highlightCode,
    }),
    apiBlocksExtension(),
    stepsExtension(),
    calloutExtension(),
    nestedHeadingExtension(nested),
    headingIdExtension(collect, nested),
    { gfm: true, breaks: false },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedMarkdown {
  html: string;
  /**
   * Document-root h1–h3 headings in order, matching the IDs emitted in `html`.
   * Headings nested in callouts, quotes, lists, or steps are excluded.
   */
  toc: TocEntry[];
}

export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions,
): Promise<RenderedMarkdown> {
  void HLJS_REGISTERED;
  const toc: TocEntry[] = [];
  const marked = createMarked(toc);
  const rawHtml = await marked.parse(splitGluedImageBlocks(markdown ?? ""), {
    async: true,
  });
  const rewritten = postProcessLinksAndImages(rawHtml, options);
  return { html: sanitizeRenderedHtml(rewritten, options), toc };
}

// Rewrite URLs FIRST so sanitize-html sees the final structure, then sanitize
// as the FINAL pass for defense-in-depth.
function sanitizeRenderedHtml(
  html: string,
  options: RenderMarkdownOptions,
): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "code",
      "pre",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "span",
      "div",
      "input",
    ],
    allowedAttributes: {
      a: [
        "href",
        "name",
        "target",
        "rel",
        "title",
        "class",
        "aria-label",
        "data-warning",
      ],
      img: [
        "src",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "decoding",
        "data-warning",
      ],
      p: ["class"],
      div: ["class", "data-callout"],
      span: ["class"],
      code: ["class"],
      pre: ["class"],
      blockquote: ["class"],
      ul: ["class"],
      ol: ["class"],
      li: ["class"],
      dl: ["class"],
      dt: ["class"],
      dd: ["class"],
      h1: ["class", "id"],
      h2: ["class", "id"],
      h3: ["class", "id"],
      h4: ["class", "id"],
      h5: ["class", "id"],
      h6: ["class", "id"],
      table: ["class"],
      thead: ["class"],
      tbody: ["class"],
      tr: ["class"],
      th: ["class", "scope"],
      td: ["class"],
      input: ["type", "checked", "disabled"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["https", "data"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    allowedStyles: {},
    transformTags: {
      input: (tagName, attribs) => {
        // Only allow task-list checkboxes
        if (attribs.type !== "checkbox") {
          return { tagName: "span", attribs: {} };
        }
        const next: Record<string, string> = {
          type: "checkbox",
          disabled: "",
        };
        if (attribs.checked != null) next.checked = "";
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const next: Record<string, string> = { ...attribs };
        if (src.startsWith("data:")) {
          if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src)) {
            return { tagName: "img", attribs: { alt: attribs.alt ?? "" } };
          }
        }
        if (!next.loading) next.loading = "lazy";
        if (!next.decoding) next.decoding = "async";
        return { tagName, attribs: next };
      },
      a: (tagName, attribs) => {
        const href = (attribs.href ?? "").trim();
        if (!href) return { tagName, attribs };
        if (href.startsWith("#")) {
          // A fragment stays on this page, so never send it to a new tab.
          const samePage: Record<string, string> = { ...attribs };
          delete samePage.target;
          delete samePage.rel;
          return { tagName, attribs: samePage };
        }
        const host = safeHost(href);
        const internalHosts = new Set<string>();
        internalHosts.add("replymaven.com");
        const customHost = options.customUrl
          ? safeHost(options.customUrl)
          : null;
        if (customHost) internalHosts.add(customHost);
        const isInternal = host !== null && internalHosts.has(host);
        const next: Record<string, string> = { ...attribs };
        if (isInternal) {
          delete next.target;
          delete next.rel;
          return { tagName, attribs: next };
        }
        next.target = "_blank";
        next.rel = "noopener noreferrer";
        return { tagName, attribs: next };
      },
    },
  });
}

function postProcessLinksAndImages(
  html: string,
  options: RenderMarkdownOptions,
): string {
  const canonicalHost = "replymaven.com";
  const customHost = options.customUrl ? safeHost(options.customUrl) : null;

  const withRewrittenAnchors = html.replace(
    /<a\b([^>]*?)>/gi,
    (_match, attrs) => rewriteAnchor(attrs, options, canonicalHost, customHost),
  );

  return withRewrittenAnchors.replace(/<img\b([^>]*?)\/?>/gi, (_m, attrs) =>
    rewriteImage(attrs),
  );
}

function rewriteAnchor(
  attrs: string,
  options: RenderMarkdownOptions,
  canonicalHost: string,
  customHost: string | null,
): string {
  const hrefMatch = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!hrefMatch) return `<a${attrs}>`;
  const rawHref = hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? "";
  const trimmed = rawHref.trim();

  let resolved = trimmed;
  let isInternal = false;

  if (trimmed.startsWith("/help/")) {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "help") {
      const category = parts[2];
      const article = parts[3];
      resolved = buildHelpUrl({
        projectSlug: parts[1],
        customUrl: options.customUrl,
        category,
        article,
      });
      isInternal = parts[1] === options.projectSlug;
    }
  } else if (trimmed.startsWith("/")) {
    if (options.customUrl) {
      const base = options.customUrl.replace(/\/+$/, "");
      resolved = `${base}${trimmed}`;
    } else {
      resolved = `https://${canonicalHost}${trimmed}`;
    }
    isInternal = true;
  } else if (trimmed.startsWith("#")) {
    // Same-page section link: keep the fragment as authored.
    isInternal = true;
  } else if (ALLOWED_PROTOCOLS.test(trimmed)) {
    const host = safeHost(trimmed);
    if (host && (host === canonicalHost || host === customHost)) {
      isInternal = true;
    }
  } else {
    return `<a${attrs.replace(hrefMatch[0], "")} href="#" data-warning="unsafe-href">`;
  }

  const baseAttrs = attrs.replace(hrefMatch[0], ` href="${escapeAttr(resolved)}"`);
  const cleaned = stripAttr(baseAttrs, "target");
  const noRefCleaned = stripAttr(cleaned, "rel");

  if (isInternal) {
    return `<a${noRefCleaned}>`;
  }
  return `<a${noRefCleaned} target="_blank" rel="noopener noreferrer">`;
}

function rewriteImage(attrs: string): string {
  const srcMatch = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!srcMatch) return `<img${attrs}>`;
  const rawSrc = (srcMatch[2] ?? srcMatch[3] ?? srcMatch[4] ?? "").trim();
  if (
    !/^https?:/i.test(rawSrc) &&
    !/^data:image\//i.test(rawSrc) &&
    !rawSrc.startsWith("/")
  ) {
    return `<img${attrs.replace(srcMatch[0], "")} data-warning="unsafe-src" alt="">`;
  }
  return `<img${attrs}>`;
}

function stripAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  return attrs.replace(re, "");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
