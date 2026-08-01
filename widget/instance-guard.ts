export function claimWidgetInstance(
  root: Element,
  projectSlug: string,
): boolean {
  const claimAttribute = "data-replymaven-widget-claimed";
  if (root.hasAttribute(claimAttribute)) return false;

  root.setAttribute(claimAttribute, projectSlug);
  return true;
}
