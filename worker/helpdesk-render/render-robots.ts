import { buildHelpSitemapUrl } from "./build-help-url";

interface RenderRobotsInput {
  projectSlug: string;
  helpCustomUrl: string | null;
}

export function renderRobots(input: RenderRobotsInput): string {
  const sitemap = buildHelpSitemapUrl({
    projectSlug: input.projectSlug,
    customUrl: input.helpCustomUrl,
  });
  return `User-agent: *
Allow: /
Sitemap: ${sitemap}
`;
}
