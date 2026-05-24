import { Marked, type Tokens, type MarkedExtension } from "marked";
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

function createMarked(): Marked {
  return new Marked(
    markedHighlight({
      langPrefix: "hljs language-",
      highlight(code, lang) {
        const language =
          lang && hljs.getLanguage(lang) ? lang : null;
        try {
          if (language) {
            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
          }
        } catch {
          // fall through
        }
        return escapeHtml(code);
      },
    }),
    calloutExtension(),
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

export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions,
): Promise<string> {
  void HLJS_REGISTERED;
  const marked = createMarked();
  const rawHtml = await marked.parse(markdown ?? "", { async: true });
  const rewritten = postProcessLinksAndImages(rawHtml, options);
  return sanitizeRenderedHtml(rewritten, options);
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
      a: ["href", "name", "target", "rel", "title", "data-warning"],
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
