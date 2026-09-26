/** @jsxImportSource hono/jsx */
import type { HelpTopNavItem } from "../lib/help-top-nav";

const LEGACY_DEFAULT_BUTTON_CLASSES =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors";
const LEGACY_COMPACT_DEFAULT_BUTTON_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors";
const LEGACY_GLASS_BUTTON_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md bg-glass-button px-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-glass-button";
const SAFE_BUTTON_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80";

export function HelpTopNavLinks(props: {
  items: HelpTopNavItem[];
  class?: string;
}) {
  if (props.items.length === 0) return null;
  return (
    <nav class={props.class} aria-label="Top navigation">
      {props.items.map((item) => {
        const isExternal = item.href.startsWith("https://");
        const savedClasses = item.classes?.trim();
        const classes =
          savedClasses === LEGACY_DEFAULT_BUTTON_CLASSES ||
          savedClasses === LEGACY_COMPACT_DEFAULT_BUTTON_CLASSES ||
          savedClasses === LEGACY_GLASS_BUTTON_CLASSES
            ? SAFE_BUTTON_CLASSES
            : savedClasses ||
          "inline-flex h-8 items-center justify-center px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
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
