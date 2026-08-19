import * as React from "react";

import { cn } from "@/lib/utils";

const controlLabelTrimClassName =
  "leading-none [text-box:trim-both_cap_alphabetic]";
const controlLabelClassName = `inline-block ${controlLabelTrimClassName}`;

export function wrapControlLabel(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      if (String(child).trim() === "") return null;
      return <span className={controlLabelClassName}>{child}</span>;
    }
    if (
      React.isValidElement<{ className?: string }>(child) &&
      child.type === "span"
    ) {
      return React.cloneElement(child, {
        className: cn(controlLabelTrimClassName, child.props.className),
      });
    }
    return child;
  });
}

export function wrapAsChildControl(children: React.ReactNode): React.ReactNode {
  const child = React.Children.only(children);
  if (!React.isValidElement<{ children?: React.ReactNode }>(child)) {
    return children;
  }
  return React.cloneElement(
    child,
    undefined,
    wrapControlLabel(child.props.children),
  );
}
