/** @jsxImportSource hono/jsx */
import type { WidgetConfigRow } from "../db/schema";
import helpCss from "./help.css?inline";
import { renderProjectTheme } from "./render-project-theme";
import { buildFontFaceCss } from "./build-font-link";
import { sanitizeCustomCss } from "../../shared/sanitize-custom-css";

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
  customCss?: string | null;
  topBar?: unknown;
  sidebar?: unknown;
  children?: unknown;
}

export function Layout(props: LayoutProps) {
  const themeOverrides = renderProjectTheme(props.widgetConfig);
  const fontCss = buildFontFaceCss(props.widgetConfig?.fontFamily ?? null) ?? "";
  const customCss = sanitizeCustomCss(props.customCss);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Set the theme before first paint (saved choice → system pref → light)
            and wire the top-bar toggle via event delegation. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var s=localStorage.getItem('rm-help-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}document.addEventListener('click',function(e){var t=e.target;var b=t&&t.closest?t.closest('#rm-theme-toggle'):null;if(!b)return;var dk=document.documentElement.classList.toggle('dark');try{localStorage.setItem('rm-help-theme',dk?'dark':'light');}catch(_){}});})();",
          }}
        />
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin="" />
        {fontCss ? (
          <style dangerouslySetInnerHTML={{ __html: fontCss }} />
        ) : null}
        {props.jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: safeJsonLd(props.jsonLd) }}
          />
        )}
        <style dangerouslySetInnerHTML={{ __html: helpCss }} />
        <style dangerouslySetInnerHTML={{ __html: themeOverrides }} />
        {customCss ? (
          <style dangerouslySetInnerHTML={{ __html: customCss }} />
        ) : null}
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
