import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Key/value header editor shared by the HTTP connector and the MCP server
// form, so both construct request headers the same way.

interface HeaderField {
  key: string;
  value: string;
}

interface HeaderFieldsProps {
  value: HeaderField[];
  onChange: (headers: HeaderField[]) => void;
  /** Rendered in place of the rows when the list is empty. */
  emptyState?: ReactNode;
}

function HeaderFields({ value, onChange, emptyState }: HeaderFieldsProps) {
  function addHeader() {
    onChange([...value, { key: "", value: "" }]);
  }

  function updateHeader(index: number, field: keyof HeaderField, next: string) {
    onChange(
      value.map((header, i) =>
        i === index ? { ...header, [field]: next } : header,
      ),
    );
  }

  function removeHeader(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3 rounded-lg glass-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Headers</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addHeader}
          className="h-7 text-xs"
        >
          <Plus className="mr-1 size-3.5" />
          Add
        </Button>
      </div>
      {value.length === 0 && emptyState}
      <div className="space-y-2">
        {value.map((header, index) => (
          <div
            key={index}
            className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
          >
            <Input
              type="text"
              value={header.key}
              onChange={(event) => updateHeader(index, "key", event.target.value)}
              placeholder="Header name"
              className="w-full font-mono text-xs sm:w-[180px] sm:shrink-0"
            />
            <Input
              type="text"
              value={header.value}
              onChange={(event) =>
                updateHeader(index, "value", event.target.value)
              }
              placeholder="Value"
              className="flex-1"
            />
            <button
              type="button"
              aria-label="Remove header"
              onClick={() => removeHeader(index)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { HeaderFields, type HeaderField };
