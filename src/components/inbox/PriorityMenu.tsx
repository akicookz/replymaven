import { ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PriorityMenuProps {
  value: "low" | "medium" | "high";
  onChange: (priority: "low" | "medium" | "high") => void;
}

const PRIORITIES: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export default function PriorityMenu({ value, onChange }: PriorityMenuProps) {
  const label =
    PRIORITIES.find((p) => p.value === value)?.label ?? "Medium";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="glass-button rounded-[6px] flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-ink-7 cursor-pointer select-none outline-none"
        >
          {label}
          <ChevronDownIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {PRIORITIES.map((p) => (
          <DropdownMenuItem
            key={p.value}
            onSelect={() => onChange(p.value)}
            className={p.value === value ? "font-medium" : ""}
          >
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
