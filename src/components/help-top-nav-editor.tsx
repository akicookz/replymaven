import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface HelpTopNavItem {
  label: string;
  href: string;
  style: "link" | "button";
}

interface HelpTopNavEditorProps {
  value: HelpTopNavItem[];
  onChange: (next: HelpTopNavItem[]) => void;
  disabled?: boolean;
}

const MAX_ITEMS = 3;

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
      { label: "", href: "", style: "link" },
    ]);
  }

  return (
    <div className="space-y-4">
      {props.value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No top-nav links yet. Add up to {MAX_ITEMS} links or buttons that
          appear in the top-right of your help center.
        </p>
      ) : (
        <ul className="space-y-3">
          {props.value.map((item, index) => (
            <li
              key={index}
              className="rounded-xl bg-muted/40 p-4 space-y-3"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-end">
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
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`help-topnav-style-${index}`}
                    className="text-xs"
                  >
                    Style
                  </Label>
                  <Select
                    value={item.style}
                    onValueChange={(value) =>
                      updateItem(index, {
                        style: value === "button" ? "button" : "link",
                      })
                    }
                    disabled={props.disabled}
                  >
                    <SelectTrigger
                      id={`help-topnav-style-${index}`}
                      className="w-full sm:w-32"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link">Link</SelectItem>
                      <SelectItem value="button">Button</SelectItem>
                    </SelectContent>
                  </Select>
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
