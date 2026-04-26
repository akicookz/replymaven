import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageVisibilityInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  emptyHint?: string;
  inputPlaceholder?: string;
  showExamples?: boolean;
}

function PageVisibilityInput({
  value,
  onChange,
  emptyHint = "No page rules set. Shows on all pages.",
  inputPlaceholder = "/pricing, /dashboard/*, /",
  showExamples = true,
}: PageVisibilityInputProps) {
  const [input, setInput] = useState("");

  function add() {
    const raw = input.trim();
    if (!raw) return;
    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    if (value.includes(normalized)) {
      setInput("");
      return;
    }
    onChange([...value, normalized]);
    setInput("");
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((page, index) => (
            <span
              key={page}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 text-sm font-mono"
            >
              {page}
              <button
                type="button"
                onClick={() => remove(index)}
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={`Remove ${page}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 rounded-lg bg-muted/30 border-2 border-dashed border-muted text-sm text-muted-foreground">
          {emptyHint}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={inputPlaceholder}
          className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="px-3 h-[42px]"
        >
          Add
        </Button>
      </div>

      {showExamples ? (
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Examples:</p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/70">
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">/</code> -
              homepage only
            </li>
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">/pricing</code>{" "}
              - exact page match
            </li>
            <li>
              <code className="text-xs bg-muted/50 px-1 rounded">/docs/*</code>{" "}
              - all pages under <code>/docs</code>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default PageVisibilityInput;
