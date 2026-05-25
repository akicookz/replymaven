/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { extractFirstImage } from "./extract-first-image";
import { extractToc } from "./render-markdown";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import { MobileCategoryNav } from "./mobile-category-nav";

interface RenderHelpArticleProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  article: HelpArticleRow;
  bodyHtml: string;
  prevArticle: HelpArticleRow | null;
  nextArticle: HelpArticleRow | null;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
}

export function renderHelpArticle(props: RenderHelpArticleProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
    category: props.category.slug,
    article: props.article.slug,
  });
  const title = `${props.article.title} — ${props.project.name} Help`;
  const description =
    props.article.excerpt ??
    `${props.article.title} — help article from ${props.project.name}.`;

  const datePublished =
    props.article.publishedAt instanceof Date
      ? props.article.publishedAt.toISOString()
      : new Date().toISOString();
  const dateModified =
    props.article.updatedAt instanceof Date
      ? props.article.updatedAt.toISOString()
      : new Date().toISOString();

  const toc = extractToc(props.article.content ?? "");
  const firstImage = extractFirstImage(props.article.content ?? "");
  const ogImage = firstImage
    ? {
        url: resolveAbsolute(firstImage.url, canonical),
        alt: firstImage.alt || props.article.title,
      }
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: props.article.title,
    description: props.article.excerpt ?? "",
    url: canonical,
    datePublished,
    dateModified,
    articleSection: props.category.name,
    ...(ogImage ? { image: ogImage.url } : {}),
    author: { "@type": "Organization", name: props.project.name },
    publisher: { "@type": "Organization", name: props.project.name },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      jsonLd={jsonLd}
      ogImage={ogImage}
      articleMeta={{
        publishedAt: datePublished,
        modifiedAt: dateModified,
        section: props.category.slug,
      }}
      topBar={
        <HelpTopBar
          project={props.project}
          widgetConfig={props.widgetConfig}
          helpCustomUrl={props.helpCustomUrl}
          topNav={props.topNav}
        />
      }
      sidebar={
        <HelpSidebar
          project={props.project}
          categories={props.categories}
          articlesByCategory={props.articlesByCategory}
          activeCategorySlug={props.category.slug}
          activeArticleSlug={props.article.slug}
          helpCustomUrl={props.helpCustomUrl}
          widgetConfig={props.widgetConfig}
        />
      }
    >
      <MobileCategoryNav
        project={props.project}
        categories={props.categories}
        activeCategorySlug={props.category.slug}
        helpCustomUrl={props.helpCustomUrl}
      />

      <div class="help-article-layout">
      <article class="help-page">
        <nav class="help-breadcrumb" aria-label="Breadcrumb">
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
            })}
          >
            {props.project.name}
          </a>
          <span class="help-breadcrumb-sep">/</span>
          <a
            href={buildHelpUrl({
              projectSlug: props.project.slug,
              customUrl: props.helpCustomUrl,
              category: props.category.slug,
            })}
          >
            {props.category.name}
          </a>
          <span class="help-breadcrumb-sep">/</span>
          <span class="help-breadcrumb-current">{props.article.title}</span>
        </nav>

        <div
          class="help-prose"
          dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
        />

        {(props.prevArticle || props.nextArticle) && (
          <nav class="help-article-nav" aria-label="Article pagination">
            {props.prevArticle ? (
              <a
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.prevArticle.slug,
                })}
              >
                <p class="help-article-nav-direction">Previous</p>
                <p class="help-article-nav-title">{props.prevArticle.title}</p>
              </a>
            ) : (
              <div />
            )}
            {props.nextArticle ? (
              <a
                class="help-article-nav-next"
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.nextArticle.slug,
                })}
              >
                <p class="help-article-nav-direction">Next</p>
                <p class="help-article-nav-title">{props.nextArticle.title}</p>
              </a>
            ) : (
              <div />
            )}
          </nav>
        )}
      </article>
      {toc.length > 0 && (
        <aside class="help-toc" aria-label="On this page">
          <h2 class="help-toc-heading">On this page</h2>
          <ol class="help-toc-list">
            {toc.map((entry) => (
              <li class={`help-toc-item is-h${entry.level}`}>
                <a class="help-toc-link" href={`#${entry.id}`} data-toc-id={entry.id}>
                  {entry.text}
                </a>
              </li>
            ))}
          </ol>
        </aside>
      )}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: TOC_SCROLLSPY_SCRIPT,
        }}
      />
    </Layout>
  );
}

const TOC_SCROLLSPY_SCRIPT = `
(function(){
  var links = Array.prototype.slice.call(document.querySelectorAll('.help-toc-link'));
  if (!links.length) return;
  var byId = {};
  links.forEach(function(a){ byId[a.getAttribute('data-toc-id')] = a; });
  var headings = links
    .map(function(a){ return document.getElementById(a.getAttribute('data-toc-id')); })
    .filter(Boolean);
  if (!headings.length) return;
  var current = null;
  function setActive(id){
    if (current === id) return;
    links.forEach(function(a){ a.classList.remove('is-active'); });
    var a = byId[id];
    if (a) {
      a.classList.add('is-active');
      // keep the active item visible within a scrollable TOC
      a.scrollIntoView({ block: 'nearest' });
    }
    current = id;
  }
  var ticking = false;
  function update(){
    ticking = false;
    var offset = 100; // account for sticky top bar
    var activeId = headings[0].id;
    for (var i = 0; i < headings.length; i++){
      if (headings[i].getBoundingClientRect().top - offset <= 1){
        activeId = headings[i].id;
      } else {
        break;
      }
    }
    // At (or near) the bottom of the page, force the last section active so
    // short trailing sections still light up.
    var scrolledToBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2;
    if (scrolledToBottom){
      activeId = headings[headings.length - 1].id;
    }
    setActive(activeId);
  }
  function onScroll(){
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();
`;

function resolveAbsolute(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:/i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
