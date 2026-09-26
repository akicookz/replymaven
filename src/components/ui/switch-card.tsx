import * as React from "react"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// Every Switch renders in one of these: title top left, optional one-line
// description under it, switch on the right aligned to the title. Stack
// several with `space-y-2`.

interface SwitchCardProps {
  title: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

function SwitchCard({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
}: SwitchCardProps) {
  const autoId = React.useId()
  const switchId = id ?? autoId
  const descriptionId = description ? `${switchId}-description` : undefined

  return (
    <label
      htmlFor={switchId}
      data-slot="switch-card"
      className={cn(
        "glass-card rounded-glass flex cursor-pointer items-start justify-between gap-4 px-4 py-3 select-none",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm leading-5 font-medium text-foreground">
          {title}
        </span>
        {description ? (
          <span
            id={descriptionId}
            className="block text-xs text-muted-foreground"
          >
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={descriptionId}
        className="mt-px"
      />
    </label>
  )
}

export { SwitchCard }
