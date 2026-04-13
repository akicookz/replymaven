import * as React from "react"
import { Pipette } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  className?: string
}

function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const [hexInput, setHexInput] = React.useState(value)

  React.useEffect(() => {
    setHexInput(value)
  }, [value])

  function handleHexChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setHexInput(val)

    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      onChange(val)
    }
  }

  function handleHexBlur() {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) {
      onChange(hexInput)
    } else {
      setHexInput(value)
    }
  }

  function handleNativeColorChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value)
    setHexInput(e.target.value)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex h-10 w-full items-center gap-3 rounded-xl border border-input bg-background px-3 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <span
            className="size-5 shrink-0 rounded-lg shadow-sm"
            style={{ backgroundColor: value }}
          />
          <span className="flex-1 text-left font-mono text-xs text-muted-foreground uppercase">
            {value}
          </span>
          <Pipette className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-3 p-3" align="start">
        {/* Native color picker — styled so the swatch fills the rounded container */}
        <input
          type="color"
          value={value}
          onChange={handleNativeColorChange}
          className="h-32 w-full cursor-pointer rounded-lg p-1"
        />

        {/* Hex input with preview swatch */}
        <div className="flex items-center gap-2">
          <span
            className="size-8 shrink-0 rounded-lg shadow-sm"
            style={{ backgroundColor: value }}
          />
          <Input
            value={hexInput}
            onChange={handleHexChange}
            onBlur={handleHexBlur}
            className="h-8 rounded-lg font-mono text-xs uppercase"
            placeholder="#000000"
            maxLength={7}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { ColorPicker }
