/** @jsxImportSource hono/jsx */
import type { WidgetConfigRow } from "../db/schema";
import helpCss from "./help.css?inline";
import { renderProjectTheme } from "./render-project-theme";
import { buildFontLink } from "./build-font-link";

interface OgImage {
  url: string;
  alt?: string;
}

export interface ArticleMeta {
  publishedAt?: string | null;
  modifiedAt?: string | null;
  section?: string | null;
}

export interface LayoutProps {
  title: string;
  description: string;
  canonicalUrl: string;
  projectSlug: string;
  widgetConfig: WidgetConfigRow | null;
  jsonLd?: object | null;
  ogImage?: OgImage | null;
  articleMeta?: ArticleMeta | null;
  topBar?: unknown;
  sidebar?: unknown;
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
        {props.widgetConfig?.avatarUrl && (
          <link rel="icon" href={props.widgetConfig.avatarUrl} />
        )}
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
        {props.articleMeta?.publishedAt && (
          <meta
            property="article:published_time"
            content={props.articleMeta.publishedAt}
          />
        )}
        {props.articleMeta?.modifiedAt && (
          <meta
            property="article:modified_time"
            content={props.articleMeta.modifiedAt}
          />
        )}
        {props.articleMeta?.section && (
          <meta property="article:section" content={props.articleMeta.section} />
        )}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin=""
        />
        <link rel="preconnect" href="https://api.fontshare.com" crossorigin="" />
        {/* Default typography matches the marketing docs: Switzer headings +
            Inter body. A tenant's custom font, when set, loads instead and
            drives both roles. */}
        {fontHref ? (
          <link href={fontHref} rel="stylesheet" />
        ) : (
          <>
            <link
              href="https://api.fontshare.com/v2/css?f[]=switzer@300,400,500,600,700&display=swap"
              rel="stylesheet"
            />
            <link
              href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
              rel="stylesheet"
            />
          </>
        )}
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
        {props.topBar}
        {props.sidebar ? (
          <div class="help-shell">
            {props.sidebar}
            <main class="help-main">{props.children}</main>
          </div>
        ) : (
          props.children
        )}
        <script
          src="https://widget.replymaven.com/widget-embed.js"
          data-project={props.projectSlug}
          async
        />
      </body>
    </html>
  );
}

function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
