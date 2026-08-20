import { type DrizzleD1Database } from "drizzle-orm/d1";
import type { HelpCategoryRow, ProjectRow, WidgetConfigRow } from "../db/schema";
import type { HelpTopNavItem } from "../lib/help-top-nav";
import { parseHelpTopNav } from "../lib/help-top-nav";
import {
  HelpdeskService,
  type HelpArticleNav,
} from "../services/helpdesk-service";
import {
  ProjectService,
  type HelpPresentationSettings,
} from "../services/project-service";
import { resolveHelpCustomUrl } from "./build-help-url";
import { groupArticlesByCategory } from "./group-articles";
import {
  sanitizeHelpThemeDefault,
  type HelpThemeDefault,
} from "./help-theme-default";

export interface PublicHelpPageContext {
  project: ProjectRow;
  settings: HelpPresentationSettings | null;
  widgetConfig: WidgetConfigRow | null;
  categories: HelpCategoryRow[];
  publishedArticles: HelpArticleNav[];
  articlesByCategory: Map<string, HelpArticleNav[]>;
  helpCustomUrl: string | null;
  topNav: HelpTopNavItem[];
  customCss: string | null;
  themeDefault: HelpThemeDefault;
  helpService: HelpdeskService;
}

export async function loadPublicHelpPage(
  db: DrizzleD1Database<Record<string, unknown>>,
  uploads: R2Bucket,
  projectSlug: string,
): Promise<PublicHelpPageContext | null> {
  const projectService = new ProjectService(db);
  const loaded = await projectService.getPublicHelpProject(projectSlug);
  if (!loaded) return null;

  const helpService = new HelpdeskService(db, uploads);
  const [categories, publishedArticles] = await Promise.all([
    helpService.listCategories(loaded.project.id),
    helpService.listPublishedArticleNav(loaded.project.id),
  ]);

  return {
    project: loaded.project,
    settings: loaded.settings,
    widgetConfig: loaded.widgetConfig,
    categories,
    publishedArticles,
    articlesByCategory: groupArticlesByCategory(publishedArticles),
    helpCustomUrl: resolveHelpCustomUrl(
      loaded.project.slug,
      loaded.settings?.helpCustomUrl,
    ),
    topNav: parseHelpTopNav(loaded.settings?.helpTopNav),
    customCss: loaded.settings?.helpCustomCss ?? null,
    themeDefault: sanitizeHelpThemeDefault(loaded.settings?.helpThemeDefault),
    helpService,
  };
}
