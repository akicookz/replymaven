/** @jsxImportSource hono/jsx */
import type { HelpTabLink } from "./help-tabs";

// Links to other pages, not an ARIA tablist. The hidden bold copy of each
// label reserves its width so the row does not shift when the active tab changes.
export function HelpTabLinks(props: {
  tabs: HelpTabLink[];
  activeTabId: string | null;
  class: string;
}) {
  if (props.tabs.length === 0) return null;
  return (
    <nav class={props.class} aria-label="Sections">
      {props.tabs.map((tab) => {
        const isActive = tab.id === props.activeTabId;
        return (
          <a
            class={isActive ? "help-tab active" : "help-tab"}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
          >
            <span class="help-tab-label" data-label={tab.name}>
              <span>{tab.name}</span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}
