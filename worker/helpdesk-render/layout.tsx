/** @jsxImportSource hono/jsx */
import { raw } from "hono/html";
import type { WidgetConfigRow } from "../db/schema";
import helpCss from "./help.css?inline";
import { renderProjectTheme } from "./render-project-theme";
import { buildFontLink } from "./build-font-link";

interface OgImage {
  url: string;
  alt?: string;
}

export interface LayoutProps {
  title: string;
  description: string;
  canonicalUrl: string;
  projectSlug: string;
  widgetConfig: WidgetConfigRow | null;
  jsonLd?: object | null;
  ogImage?: OgImage | null;
  children?: unknown;
}

export function Layout(props: LayoutProps) {
  const themeOverrides = renderProjectTheme(props.widgetConfig);
  const fontHref = buildFontLink(props.widgetConfig?.fontFamily ?? null);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <link rel="canonical" href={props.canonicalUrl} />
        <meta name="replymaven:help" content={props.projectSlug} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:url" content={props.canonicalUrl} />
        {props.ogImage && <meta property="og:image" content={props.ogImage.url} />}
        {props.ogImage?.alt && (
          <meta property="og:image:alt" content={props.ogImage.alt} />
        )}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={props.title} />
        <meta name="twitter:description" content={props.description} />
        {props.ogImage && (
          <meta name="twitter:image" content={props.ogImage.url} />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin=""
        />
        {fontHref && <link href={fontHref} rel="stylesheet" />}
        {props.jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: safeJsonLd(props.jsonLd) }}
          />
        )}
        <style dangerouslySetInnerHTML={{ __html: helpCss }} />
        <style dangerouslySetInnerHTML={{ __html: themeOverrides }} />
      </head>
      <body class="min-h-screen bg-background text-foreground antialiased">
        {props.children}
        {raw(
          `<script src="https://widget.replymaven.com/widget-embed.js" data-project="${escapeAttr(props.projectSlug)}" async></script>`,
        )}
      </body>
    </html>
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
