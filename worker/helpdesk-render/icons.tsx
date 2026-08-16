/** @jsxImportSource hono/jsx */
import {
  HELP_ICON_SVGS,
  type HelpIconName,
} from "../../shared/help-icons";

export interface HelpIconProps {
  name: string | null | undefined;
  class?: string;
}

export function HelpIcon(props: HelpIconProps) {
  const fallback = HELP_ICON_SVGS.BookOpen;
  const svg =
    props.name && Object.prototype.hasOwnProperty.call(HELP_ICON_SVGS, props.name)
      ? HELP_ICON_SVGS[props.name as HelpIconName]
      : fallback;
  return (
    <span
      class={props.class}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
