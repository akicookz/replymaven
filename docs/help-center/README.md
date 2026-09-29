# Help-center documentation source

These Markdown files are local source files. They are not live help-center records, and a Git commit does not publish them.

Article files use `category/slug.md`. Keep the category and slug aligned with the live article URL. Use one H1 for the article title. For an update, preserve its category, URL slug, draft or published status, and SEO fields unless the change asks for them.

In article Markdown, use full links such as `https://replymaven.com/docs/knowledge-base/faqs`. The renderer adds a base URL to root-relative links.

When updating article text through MCP, read the current body first. Use `contentPatch` with the matching `expectedUpdatedAt` for a partial edit. Create or publish categories and articles through the normal Help Center authoring flow.
