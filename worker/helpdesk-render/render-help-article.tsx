/** @jsxImportSource hono/jsx */
import type {
  HelpArticleRow,
  HelpCategoryRow,
  ProjectRow,
  WidgetConfigRow,
} from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { buildHelpUrl } from "./build-help-url";
import { extractFirstImage } from "../../shared/extract-first-image";
import { Layout } from "./layout";
import { MobileCategoryNav } from "./mobile-category-nav";
import type { TocEntry } from "./render-markdown";
import { HelpSidebar } from "./sidebar";
import { splitHelpArticleLead } from "./split-help-article-lead";
import { HelpTopBar } from "./top-bar";

interface RenderHelpArticleProps {
  project: ProjectRow;
  category: HelpCategoryRow;
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleRow[]>;
  article: HelpArticleRow;
  bodyHtml: string;
  toc: TocEntry[];
  prevArticle: HelpArticleRow | null;
  nextArticle: HelpArticleRow | null;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
}

export function renderHelpArticle(props: RenderHelpArticleProps) {
  const canonical = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
    category: props.category.slug,
    article: props.article.slug,
  });
  const title = props.article.title;
  const description = props.article.excerpt?.trim() ?? "";

  const datePublished =
    props.article.publishedAt instanceof Date
      ? props.article.publishedAt.toISOString()
      : new Date().toISOString();
  const dateModified =
    props.article.updatedAt instanceof Date
      ? props.article.updatedAt.toISOString()
      : new Date().toISOString();

  const toc = props.toc;
  const { head: leadHtml, tail: restHtml } = splitHelpArticleLead(props.bodyHtml);
  const storedOg = props.article.ogImageUrl?.trim() ?? "";
  const firstImage = extractFirstImage(props.article.content ?? "");
  const ogImageUrl = storedOg || firstImage?.url || "";
  const ogImage = ogImageUrl
    ? {
        url: resolveAbsolute(ogImageUrl, canonical),
        alt: firstImage?.alt || props.article.title,
      }
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: props.article.title,
    description: description,
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
      customCss={props.customCss}
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
          topNav={props.topNav}
        />
      }
    >
      <div class="help-article-layout">
      <article class="help-page">
        <div class="help-article-topline">
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
        <CopyPageMenu markdownUrl={`${canonical}.md`} />
        </div>

        <div
          class="help-prose"
          dangerouslySetInnerHTML={{ __html: leadHtml }}
        />
        <MobileCategoryNav
          project={props.project}
          categories={props.categories}
          activeCategorySlug={props.category.slug}
          helpCustomUrl={props.helpCustomUrl}
        />
        {restHtml ? (
          <div
            class="help-prose"
            dangerouslySetInnerHTML={{ __html: restHtml }}
          />
        ) : null}

        {(props.prevArticle || props.nextArticle) && (
          <nav class="help-article-nav" aria-label="Article pagination">
            {props.prevArticle ? (
              <a
                aria-label={`Previous: ${props.prevArticle.title}`}
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.prevArticle.slug,
                })}
              >
                <span class="help-article-nav-chevron" aria-hidden="true">
                  ‹
                </span>
                <span class="help-article-nav-title">
                  {props.prevArticle.title}
                </span>
              </a>
            ) : (
              <div />
            )}
            {props.nextArticle ? (
              <a
                class="help-article-nav-next"
                aria-label={`Next: ${props.nextArticle.title}`}
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: props.category.slug,
                  article: props.nextArticle.slug,
                })}
              >
                <span class="help-article-nav-title">
                  {props.nextArticle.title}
                </span>
                <span class="help-article-nav-chevron" aria-hidden="true">
                  ›
                </span>
              </a>
            ) : (
              <div />
            )}
          </nav>
        )}
      </article>
      {toc.length > 0 && (
        <aside class="help-toc" aria-label="On this page">
          <h2 class="help-toc-heading">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="15" y2="12" />
              <line x1="3" y1="18" x2="9" y2="18" />
            </svg>
            On this page
          </h2>
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
      <script
        dangerouslySetInnerHTML={{
          __html: COPY_PAGE_SCRIPT,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: SECTION_ANCHOR_SCRIPT,
        }}
      />
    </Layout>
  );
}

// Icon paths are the simple-icons marks also shipped in public/integrations/,
// inlined with currentColor so they follow the theme and render on tenant
// custom domains (where absolute asset paths would not resolve).
const OPENAI_ICON_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const CLAUDE_ICON_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ExternalArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function CopyPageMenu(props: { markdownUrl: string }) {
  const prompt = `Read ${props.markdownUrl} so I can ask questions about it.`;
  const chatGptHref = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`;
  const claudeHref = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

  return (
    <div class="help-copy" id="rm-copy" data-md={props.markdownUrl}>
      <button type="button" class="help-copy-main" data-copy>
        <CopyIcon />
        <span id="rm-copy-label">Copy page</span>
      </button>
      <button
        type="button"
        class="help-copy-toggle"
        id="rm-copy-toggle"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="More page actions"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="help-copy-menu" id="rm-copy-menu" role="menu" hidden>
        <button type="button" class="help-copy-item" role="menuitem" data-copy>
          <span class="help-copy-item-icon">
            <CopyIcon />
          </span>
          <span>
            <span class="help-copy-item-title">Copy page</span>
            <span class="help-copy-item-desc">
              Copy page as Markdown for LLMs
            </span>
          </span>
        </button>
        <a
          class="help-copy-item"
          role="menuitem"
          href={chatGptHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="help-copy-item-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={OPENAI_ICON_PATH} />
            </svg>
          </span>
          <span>
            <span class="help-copy-item-title">
              Open in ChatGPT <ExternalArrowIcon />
            </span>
            <span class="help-copy-item-desc">
              Ask questions about this page
            </span>
          </span>
        </a>
        <a
          class="help-copy-item"
          role="menuitem"
          href={claudeHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="help-copy-item-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={CLAUDE_ICON_PATH} />
            </svg>
          </span>
          <span>
            <span class="help-copy-item-title">
              Open in Claude <ExternalArrowIcon />
            </span>
            <span class="help-copy-item-desc">
              Ask questions about this page
            </span>
          </span>
        </a>
      </div>
    </div>
  );
}

const COPY_PAGE_SCRIPT = `
(function(){
  var root = document.getElementById('rm-copy');
  if (!root) return;
  var toggle = document.getElementById('rm-copy-toggle');
  var menu = document.getElementById('rm-copy-menu');
  var label = document.getElementById('rm-copy-label');
  function close(){ menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = menu.hidden;
    menu.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', function(e){
    if (root.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
  function doCopy(){
    fetch(root.getAttribute('data-md'))
      .then(function(r){ if (!r.ok) throw new Error('fetch failed'); return r.text(); })
      .then(function(t){ return navigator.clipboard.writeText(t); })
      .then(function(){
        var original = label.textContent;
        label.textContent = 'Copied';
        setTimeout(function(){ label.textContent = original; }, 2000);
      })
      .catch(function(){});
  }
  Array.prototype.forEach.call(root.querySelectorAll('[data-copy]'), function(b){
    b.addEventListener('click', function(){ close(); doCopy(); });
  });
})();
`;

const SECTION_ANCHOR_SCRIPT = `
(function(){
  var active = null;
  var timer;
  function reset(){
    if (!active) return;
    active.classList.remove('is-copied');
    active.textContent = '#';
    active = null;
  }
  document.addEventListener('click', function(e){
    var t = e.target;
    var a = t && t.closest ? t.closest('.help-anchor') : null;
    if (!a) return;
    var hash = a.getAttribute('href') || '';
    if (!hash) return;
    // Without the clipboard API the default fragment jump is the fallback.
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    e.preventDefault();
    navigator.clipboard
      .writeText(location.origin + location.pathname + hash)
      .then(function(){
        // replaceState keeps the address bar in sync without a scroll jump;
        // the reader is already looking at this heading.
        if (history.replaceState) history.replaceState(null, '', hash);
        else location.hash = hash;
        reset();
        active = a;
        a.classList.add('is-copied');
        a.textContent = '\\u2713';
        clearTimeout(timer);
        timer = setTimeout(reset, 1500);
      })
      .catch(function(){ location.hash = hash; });
  });
})();
`;

const TOC_SCROLLSPY_SCRIPT = `
(function(){
  var links = Array.prototype.slice.call(document.querySelectorAll('.help-toc-link'));
  if (!links.length) return;
  var container = document.querySelector('.help-toc');
  var byId = {};
  links.forEach(function(a){ byId[a.getAttribute('data-toc-id')] = a; });
  var headings = links
    .map(function(a){ return document.getElementById(a.getAttribute('data-toc-id')); })
    .filter(Boolean);
  if (!headings.length) return;

  // Scroll the active link into view WITHIN the TOC's own scroll box only —
  // never call element.scrollIntoView, which would scroll the whole page.
  function revealInToc(a){
    if (!container) return;
    var top = a.offsetTop;
    var bottom = top + a.offsetHeight;
    var viewTop = container.scrollTop;
    var viewBottom = viewTop + container.clientHeight;
    if (top < viewTop) container.scrollTop = top - 8;
    else if (bottom > viewBottom) container.scrollTop = bottom - container.clientHeight + 8;
  }

  var current = null;
  function setActive(id){
    if (current === id) return;
    current = id;
    links.forEach(function(a){
      a.classList.toggle('is-active', a.getAttribute('data-toc-id') === id);
    });
    var a = byId[id];
    if (a) revealInToc(a);
  }

  var TOP = 100; // reading line just below the sticky top bar
  function update(){
    ticking = false;
    var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    var remaining = maxScroll - window.scrollY;

    // Normally the active section is the last heading at/above the reading
    // line. In the final screenful the trailing headings can never reach that
    // line, so sweep the line downward toward the viewport bottom as we
    // approach the end — each trailing heading crosses it in order, so the
    // highlight advances smoothly instead of snapping to the last one.
    var line = TOP;
    if (maxScroll > 0 && remaining < window.innerHeight){
      var p = 1 - Math.max(remaining, 0) / window.innerHeight; // 0 → 1
      line = TOP + (window.innerHeight - TOP) * p;
    }

    var idx = 0;
    for (var i = 0; i < headings.length; i++){
      if (headings[i].getBoundingClientRect().top <= line) idx = i;
      else if (line === TOP) break;
    }
    setActive(headings[idx].id);
  }
  var ticking = false;
  function onScroll(){
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // Arriving on a section link, the browser applies the fragment scroll after
  // this script runs and fires no scroll event, so the first update would
  // leave the rail pointing at the title. Re-run once the page has settled.
  window.addEventListener('load', onScroll);
  window.addEventListener('hashchange', onScroll);
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
