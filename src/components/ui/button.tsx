import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { wrapAsChildControl, wrapControlLabel } from "@/components/ui/control-label";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-glass text-sm font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "glow-surface text-card-foreground",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        outline: "glass-control text-ink-3 hover:text-ink-1",
        secondary:
          "bg-glass-button text-ink-2 shadow-[inset_0_1px_0_0_var(--hairline-inset)] hover:bg-glass-raised",
        ghost: "hover:bg-glass-button hover:text-ink-1",
        link: "text-primary underline-offset-4 hover:underline",
        "glow-primary":
          "glow-surface text-card-foreground",
        "glow-secondary":
          "glow-surface-subtle text-brand-soft",
      },
      // Radius tracks height so every control keeps the same corner ratio
      // (~0.3 of height). Do not collapse these onto one value.
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[8px] px-3 text-[13px]",
        lg: "h-10 rounded-[10px] px-6",
        icon: "size-9",
        "icon-sm": "size-8 rounded-[8px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild = false, children, ...props }, ref) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {asChild ? wrapAsChildControl(children) : wrapControlLabel(children)}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
