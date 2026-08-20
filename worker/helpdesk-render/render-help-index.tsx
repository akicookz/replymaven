/** @jsxImportSource hono/jsx */
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { Layout } from "./layout";
import { buildHelpUrl } from "./build-help-url";
import { HelpSidebar } from "./sidebar";
import { HelpTopBar } from "./top-bar";
import type { HelpThemeDefault } from "./help-theme-default";

interface RenderHelpIndexProps {
  project: ProjectRow;
  categories: HelpCategoryRow[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  widgetConfig: WidgetConfigRow | null;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
  homeBackgroundUrl: string | null;
  homeBackgroundPosition: string | null;
  homeBackgroundFit: string | null;
  themeDefault: HelpThemeDefault;
  bodyHtml: string;
  noindex?: boolean;
}

export function renderHelpIndex(props: RenderHelpIndexProps) {
  const homeUrl = buildHelpUrl({
    projectSlug: props.project.slug,
    customUrl: props.helpCustomUrl,
  });
  const title = props.project.name;
  const description = "";

  return (
    <Layout
      title={title}
      description={description}
      canonicalUrl={homeUrl}
      projectSlug={props.project.slug}
      widgetConfig={props.widgetConfig}
      customCss={props.customCss}
      homeBackgroundUrl={props.homeBackgroundUrl}
      homeBackgroundPosition={props.homeBackgroundPosition}
      homeBackgroundFit={props.homeBackgroundFit}
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
      <div
        class="help-home"
        dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
      />
    </Layout>
  );
}
