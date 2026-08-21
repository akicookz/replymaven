/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import type { HelpThemeDefault } from "./help-theme-default";
import type { HelpAnalyticsEmbed } from "../lib/help-analytics";
import { type HelpSearchResult } from "./help-search";

export type { HelpSearchResult };

interface RenderHelpSearchProps {
  project: ProjectRow;
  query: string;
  results: HelpSearchResult[];
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
  analytics: HelpAnalyticsEmbed[];
  themeDefault: HelpThemeDefault;
  noindex?: boolean;
}

export function renderHelpSearch(props: RenderHelpSearchProps) {
  const homeUrl = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const canonical = homeUrl;
  const title = props.query ? `Search: ${props.query}` : "Search";
  const description = props.query
    ? `Search results for "${props.query}".`
    : "Search the help center.";
  const resultLabel = searchResultLabel(props.query, props.results.length);

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={canonical}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      customCss={props.customCss}
      analytics={props.analytics}
      helpCustomUrl={props.helpCustomUrl}
      themeDefault={props.themeDefault}
      noindex={props.noindex}
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
          activeCategorySlug={null}
          activeArticleSlug={null}
          helpCustomUrl={props.helpCustomUrl}
          widgetConfig={props.widgetConfig}
          topNav={props.topNav}
        />
      }
    >
      <div class="help-page" id="rm-help-search">
        <form
          action={`${homeUrl}/search`}
          method="get"
          class="help-hero-search"
          role="search"
        >
          <span class="help-hero-search-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
            </svg>
          </span>
          <input
            type="search"
            name="q"
            value={props.query}
            placeholder="Ask, search, or explain..."
            autocomplete="off"
            autofocus
            aria-label="Search help center"
          />
          <button type="submit" aria-label="Search">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>

        {props.query && (
          <section
            id="rm-help-explain"
            class="help-search-explain is-loading"
            aria-live="polite"
          >
            <p class="help-search-explain-label">Explain</p>
            <p id="rm-help-explain-body" class="help-search-explain-body">
              Looking this up…
            </p>
          </section>
        )}

        {props.query && (
          <p id="rm-help-search-meta" class="help-search-meta">
            {resultLabel}
          </p>
        )}

        <ul id="rm-help-search-results" class="help-search-results">
          {props.results.map((result) => (
            <li data-article-id={result.article.id}>
              <a
                class="help-search-result"
                href={buildHelpUrl({
                  projectSlug: props.project.slug,
                  customUrl: props.helpCustomUrl,
                  category: result.category.slug,
                  article: result.article.slug,
                })}
              >
                <p class="help-search-result-breadcrumb">
                  {result.category.name}
                </p>
                <h2 class="help-search-result-title">
                  {result.article.title}
                </h2>
                {result.article.excerpt && (
                  <p class="help-search-result-excerpt">
                    {result.article.excerpt}
                  </p>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
      {props.query ? (
        <script
          dangerouslySetInnerHTML={{
            __html: HELP_SEARCH_EXPLAIN_SCRIPT,
          }}
        />
      ) : null}
    </Layout>
  );
}

function searchResultLabel(query: string, count: number): string {
  if (count === 0) return "Looking for matching articles…";
  if (count === 1) return `1 result for "${query}"`;
  return `${count} results for "${query}"`;
}

const HELP_SEARCH_EXPLAIN_SCRIPT = `
(function(){
  var explain = document.getElementById('rm-help-explain');
  var body = document.getElementById('rm-help-explain-body');
  var list = document.getElementById('rm-help-search-results');
  var meta = document.getElementById('rm-help-search-meta');
  if (!explain || !body || !list || !meta) return;
  var seen = {};
  var nodes = list.querySelectorAll('[data-article-id]');
  for (var i = 0; i < nodes.length; i++) {
    seen[nodes[i].getAttribute('data-article-id')] = true;
  }
  var query = new URLSearchParams(location.search).get('q') || '';
  var wrote = false;
  var path = location.pathname.replace(/\\/+$/, '') + '/answer' + location.search;
  fetch(path, { headers: { Accept: 'text/event-stream' } }).then(function(res){
    if (!res.ok || !res.body) throw new Error('explain failed');
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function read(){
      return reader.read().then(function(chunk){
        if (chunk.done) {
          finish();
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var parts = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = parts.pop() || '';
        for (var p = 0; p < parts.length; p++) applyBlock(parts[p]);
        return read();
      });
    }
    return read();
  }).catch(function(){
    finish();
  });
  function applyBlock(block){
    var eventName = null;
    var dataLines = [];
    var lines = block.split(/\\r?\\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === ':') continue;
      if (line.indexOf('event:') === 0) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).replace(/^\\s/, ''));
    }
    if (!eventName || dataLines.length === 0) return;
    var parsed;
    try { parsed = JSON.parse(dataLines.join('\\n')); } catch (e) { return; }
    if (eventName === 'articles') {
      appendArticles(parsed);
      return;
    }
    if (eventName === 'token' && parsed && typeof parsed.text === 'string') {
      if (!wrote) {
        wrote = true;
        body.textContent = '';
        explain.classList.remove('is-loading');
      }
      body.textContent += parsed.text;
      return;
    }
    if (eventName === 'done') finish();
  }
  function appendArticles(cards){
    if (!Array.isArray(cards)) return;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card || seen[card.id]) continue;
      if (typeof card.id !== 'string' || typeof card.href !== 'string' || typeof card.title !== 'string') continue;
      seen[card.id] = true;
      var li = document.createElement('li');
      li.setAttribute('data-article-id', card.id);
      var a = document.createElement('a');
      a.className = 'help-search-result';
      a.href = card.href;
      var crumb = document.createElement('p');
      crumb.className = 'help-search-result-breadcrumb';
      crumb.textContent = typeof card.breadcrumb === 'string' ? card.breadcrumb : '';
      var heading = document.createElement('h2');
      heading.className = 'help-search-result-title';
      heading.textContent = card.title;
      a.appendChild(crumb);
      a.appendChild(heading);
      if (typeof card.excerpt === 'string' && card.excerpt) {
        var excerpt = document.createElement('p');
        excerpt.className = 'help-search-result-excerpt';
        excerpt.textContent = card.excerpt;
        a.appendChild(excerpt);
      }
      li.appendChild(a);
      list.appendChild(li);
    }
    updateMeta();
  }
  function updateMeta(){
    var count = list.children.length;
    if (count === 0) {
      meta.textContent = 'Looking for matching articles…';
      return;
    }
    if (count === 1) {
      meta.textContent = '1 result for "' + query + '"';
      return;
    }
    meta.textContent = count + ' results for "' + query + '"';
  }
  var finished = false;
  function finish(){
    if (finished) return;
    finished = true;
    if (!wrote) explain.hidden = true;
    if (list.children.length === 0) {
      meta.textContent = 'No results for "' + query + '".';
    }
  }
})();
`;
