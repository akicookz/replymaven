import * as React from "react"

import { fieldSurface } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Multi-line field with the same glass surface as Input. Fixed height by
// default; pass `resize-y` for editors where the user sizes the box.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldSurface,
        "block w-full min-w-0 resize-none px-3 py-2 text-base md:text-[13px]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
