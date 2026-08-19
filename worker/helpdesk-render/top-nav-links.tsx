/** @jsxImportSource hono/jsx */
import type { HelpTopNavItem } from "../lib/help-top-nav";

export function HelpTopNavLinks(props: {
  items: HelpTopNavItem[];
  class?: string;
}) {
  if (props.items.length === 0) return null;
  return (
    <nav class={props.class} aria-label="Top navigation">
      {props.items.map((item) => {
        const isExternal = item.href.startsWith("https://");
        const classes =
          item.classes?.trim() ||
          "inline-flex h-9 items-center justify-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
        return (
          <a
            href={item.href}
            class={classes}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
