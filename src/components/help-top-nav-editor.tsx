import { type ChangeEvent } from "react";
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
import { cn } from "@/lib/utils";

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

type ItemStyle = "link" | "button" | "custom";

function styleOf(item: HelpTopNavItem): ItemStyle {
  // null / undefined explicitly means "plain link". An empty-but-non-null
  // string means "custom, user just hasn't typed anything yet" so we don't
  // bounce them back to "link" while the textarea is open.
  if (item.classes == null) return "link";
  if (item.classes.trim() === DEFAULT_BUTTON_CLASSES.trim()) return "button";
  return "custom";
}

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
    props.onChange([...props.value, { label: "", href: "", classes: null }]);
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
            <TopNavItemRow
              key={index}
              item={item}
              index={index}
              disabled={props.disabled}
              onChange={(patch) => updateItem(index, patch)}
              onRemove={() => removeItem(index)}
            />
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

interface TopNavItemRowProps {
  item: HelpTopNavItem;
  index: number;
  disabled?: boolean;
  onChange: (patch: Partial<HelpTopNavItem>) => void;
  onRemove: () => void;
}

function TopNavItemRow({
  item,
  index,
  disabled,
  onChange,
  onRemove,
}: TopNavItemRowProps) {
  const style = styleOf(item);

  function setStyle(next: ItemStyle) {
    if (next === "link") {
      onChange({ classes: null });
      return;
    }
    if (next === "button") {
      onChange({ classes: DEFAULT_BUTTON_CLASSES });
      return;
    }
    // custom — preserve any existing custom classes, otherwise start blank
    if (style !== "custom") {
      onChange({ classes: "" });
    }
  }

  return (
    <li className="rounded-xl bg-muted/40 p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`help-topnav-label-${index}`} className="text-xs">
            Label
          </Label>
          <Input
            id={`help-topnav-label-${index}`}
            value={item.label}
            maxLength={40}
            placeholder="Pricing"
            disabled={disabled}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`help-topnav-href-${index}`} className="text-xs">
            URL
          </Label>
          <Input
            id={`help-topnav-href-${index}`}
            type="url"
            value={item.href}
            maxLength={2048}
            placeholder="https://yourdomain.com/pricing"
            disabled={disabled}
            onChange={(e) => onChange({ href: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`help-topnav-style-${index}`} className="text-xs">
            Style
          </Label>
          <Select
            value={style}
            onValueChange={(v) => setStyle(v as ItemStyle)}
            disabled={disabled}
          >
            <SelectTrigger id={`help-topnav-style-${index}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="link">Link</SelectItem>
              <SelectItem value="button">Button</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove link"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {style === "custom" && (
        <div className="space-y-1.5">
          <Label
            htmlFor={`help-topnav-classes-${index}`}
            className="text-xs"
          >
            Tailwind classes
          </Label>
          <textarea
            id={`help-topnav-classes-${index}`}
            value={item.classes ?? ""}
            maxLength={300}
            rows={2}
            placeholder="inline-flex h-9 items-center px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              onChange({ classes: e.target.value })
            }
            className={cn(
              "flex min-h-[60px] w-full rounded-md border border-input bg-card px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
          <p className="text-xs text-muted-foreground">
            Power users only — write your own classes to fully control how this
            link looks.
          </p>
        </div>
      )}
    </li>
  );
}

export default HelpTopNavEditor;
