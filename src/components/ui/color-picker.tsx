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
            "glass-control rounded-glass group flex h-9 w-full items-center gap-2.5 px-2.5 text-[13px] outline-none focus-visible:inset-ring focus-visible:inset-ring-hairline-strong",
            className
          )}
        >
          <span
            className="size-5 shrink-0 rounded-[5px] inset-ring inset-ring-hairline"
            style={{ backgroundColor: value }}
          />
          <span className="flex-1 text-left font-mono text-xs text-ink-5 uppercase">
            {value}
          </span>
          <Pipette className="size-3.5 text-ink-6 opacity-0 transition-opacity group-hover:opacity-100" />
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
            className="size-8 shrink-0 rounded-glass inset-ring inset-ring-hairline"
            style={{ backgroundColor: value }}
          />
          <Input
            value={hexInput}
            onChange={handleHexChange}
            onBlur={handleHexBlur}
            className="h-8 font-mono text-xs uppercase"
            placeholder="#000000"
            maxLength={7}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { ColorPicker }
