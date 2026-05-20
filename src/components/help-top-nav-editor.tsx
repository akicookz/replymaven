import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface HelpTopNavItem {
  label: string;
  href: string;
  classes?: string | null;
}

interface HelpTopNavEditorProps {
  value: HelpTopNavItem[];
  onChange: (next: HelpTopNavItem[]) => void;
  disabled?: boolean;
}

const MAX_ITEMS = 3;
const DEFAULT_BUTTON_CLASSES =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors";

function HelpTopNavEditor(props: HelpTopNavEditorProps) {
  function updateItem(index: number, patch: Partial<HelpTopNavItem>) {
    const next = props.value.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    props.onChange(next);
  }

  function removeItem(index: number) {
    const next = props.value.filter((_, i) => i !== index);
    props.onChange(next);
  }

  function addItem() {
    if (props.value.length >= MAX_ITEMS) return;
    props.onChange([
      ...props.value,
      { label: "", href: "", classes: null },
    ]);
  }

  return (
    <div className="space-y-4">
      {props.value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No top-nav items yet. Add up to {MAX_ITEMS} links that appear in the
          top-right of your help center.
        </p>
      ) : (
        <ul className="space-y-3">
          {props.value.map((item, index) => (
            <li
              key={index}
              className="rounded-xl bg-muted/40 p-4 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`help-topnav-label-${index}`}
                    className="text-xs"
                  >
                    Label
                  </Label>
                  <Input
                    id={`help-topnav-label-${index}`}
                    value={item.label}
                    maxLength={40}
                    placeholder="Pricing"
                    disabled={props.disabled}
                    onChange={(e) =>
                      updateItem(index, { label: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`help-topnav-href-${index}`}
                    className="text-xs"
                  >
                    URL
                  </Label>
                  <Input
                    id={`help-topnav-href-${index}`}
                    type="url"
                    value={item.href}
                    maxLength={2048}
                    placeholder="https://yourdomain.com/pricing"
                    disabled={props.disabled}
                    onChange={(e) =>
                      updateItem(index, { href: e.target.value })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(index)}
                  disabled={props.disabled}
                  aria-label="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor={`help-topnav-classes-${index}`}
                    className="text-xs"
                  >
                    Tailwind classes (optional)
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      updateItem(index, { classes: DEFAULT_BUTTON_CLASSES })
                    }
                    disabled={props.disabled}
                  >
                    Use button preset
                  </button>
                </div>
                <Textarea
                  id={`help-topnav-classes-${index}`}
                  value={item.classes ?? ""}
                  maxLength={300}
                  rows={2}
                  placeholder="Leave empty for a plain text link. Example: inline-flex h-9 items-center px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={props.disabled}
                  onChange={(e) =>
                    updateItem(index, {
                      classes: e.target.value.length > 0 ? e.target.value : null,
                    })
                  }
                  className="font-mono text-xs"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addItem}
        disabled={props.disabled || props.value.length >= MAX_ITEMS}
      >
        <Plus className="h-4 w-4" />
        Add link
      </Button>
    </div>
  );
}

export default HelpTopNavEditor;
