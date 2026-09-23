export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbListJsonLd(
  items: BreadcrumbItem[],
): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
