"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer glass-control size-4 shrink-0 rounded-[5px] outline-none focus-visible:inset-ring focus-visible:inset-ring-hairline-strong data-[state=checked]:bg-primary/15 data-[state=checked]:text-brand-soft data-[state=checked]:inset-ring data-[state=checked]:inset-ring-primary/50 aria-invalid:inset-ring aria-invalid:inset-ring-destructive/60 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
