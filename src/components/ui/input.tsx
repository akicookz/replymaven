import * as React from "react"

import { cn } from "@/lib/utils"

// Shared field surface (`glass-control`: translucent fill lit from the top edge,
// ink text). Input, Textarea, and SelectTrigger all use it.
const fieldSurface =
  "glass-control rounded-glass text-ink-2 placeholder:text-ink-6 selection:bg-primary selection:text-primary-foreground outline-none focus-visible:bg-glass-raised focus-visible:inset-ring focus-visible:inset-ring-hairline-strong aria-invalid:inset-ring aria-invalid:inset-ring-destructive/60 disabled:cursor-not-allowed disabled:opacity-50"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldSurface,
        "h-9 w-full min-w-0 px-3 py-1 text-base disabled:pointer-events-none md:text-[13px]",
        "file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldSurface }
