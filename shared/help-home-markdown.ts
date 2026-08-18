/** Default help-center home body. Used when `help_home_markdown` is null. */
export function defaultHelpHomeMarkdown(projectName: string): string {
  const name = projectName.replace(/[\n\r]+/g, " ").trim() || "this product";
  return `# How can we help?

Browse help articles and guides for ${name}.

:::columns
::column
::help-search
::help-categories
::column
::help-popular
:::
`;
}
