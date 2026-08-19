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
            <button
              type="button"
              class="help-nav-overlay"
              id="rm-help-nav-overlay"
              aria-label="Close menu"
              tabindex={-1}
            />
            {props.sidebar}
            <main class="help-main">{props.children}</main>
          </div>
        ) : (
          props.children
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: HELP_NAV_SCRIPT,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: IMAGE_ZOOM_SCRIPT,
          }}
        />
        <script
          src="https://widget.replymaven.com/widget-embed.js"
          data-project={props.projectSlug}
          async
        />
      </body>
    </html>
  );
}

const HELP_NAV_SCRIPT = `
(function(){
  var menu = document.getElementById('rm-help-menu');
  var sidebar = document.getElementById('rm-help-sidebar');
  var overlay = document.getElementById('rm-help-nav-overlay');
  if (!menu || !sidebar) return;
  var desktop = window.matchMedia('(min-width: 1024px)');
  function isDesktop(){ return desktop.matches; }
  function setOpen(open){
    if (isDesktop()) open = false;
    document.documentElement.classList.toggle('help-nav-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (isDesktop()) sidebar.removeAttribute('inert');
    else if (open) sidebar.removeAttribute('inert');
    else sidebar.setAttribute('inert', '');
  }
  setOpen(false);
  menu.addEventListener('click', function(e){
    e.stopPropagation();
    setOpen(!document.documentElement.classList.contains('help-nav-open'));
  });
  if (overlay) overlay.addEventListener('click', function(){ setOpen(false); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') setOpen(false);
  });
  desktop.addEventListener('change', function(){ setOpen(false); });
})();
`;

const IMAGE_ZOOM_SCRIPT = `
(function(){
  var dialog, zoomImg;
  function ensure(){
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'help-img-zoom';
    dialog.setAttribute('aria-label', 'Zoomed image');
    zoomImg = document.createElement('img');
    dialog.appendChild(zoomImg);
    dialog.addEventListener('click', function(){ dialog.close(); });
    document.body.appendChild(dialog);
  }
  function open(img){
    var src = img.currentSrc || img.src;
    if (!src) return;
    ensure();
    zoomImg.src = src;
    zoomImg.alt = img.alt || '';
    requestAnimationFrame(function(){ dialog.showModal(); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.help-img img'), function(img){
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', img.alt ? img.alt + ' (view larger)' : 'View larger image');
  });
  document.addEventListener('click', function(e){
    var t = e.target;
    var img = t && t.closest ? t.closest('.help-img img') : null;
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    open(img);
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    var img = t && t.closest ? t.closest('.help-img img') : null;
    if (!img) return;
    e.preventDefault();
    open(img);
  });
})();
`;

function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
