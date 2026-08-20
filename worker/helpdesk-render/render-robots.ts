import { buildHelpSitemapUrl } from "./build-help-url";

interface RenderRobotsInput {
  projectSlug: string;
  helpCustomUrl: string | null;
}

export function renderRobots(input: RenderRobotsInput): string {
  if (!input.helpCustomUrl) {
    return `User-agent: *
Allow: /
`;
  }
  const sitemap = buildHelpSitemapUrl({
    projectSlug: input.projectSlug,
    customUrl: input.helpCustomUrl,
  });
  return `User-agent: *
Allow: /
Sitemap: ${sitemap}
`;
}
