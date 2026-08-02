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
import { Switch } from "@/components/ui/switch";
import {
  createEmptyCustomerFieldRow,
  type CustomerFieldRow,
  type CustomerFieldType,
} from "@/lib/customers";

interface CustomerFieldsEditorProps {
  rows: CustomerFieldRow[];
  onChange: (rows: CustomerFieldRow[]) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

function defaultValueForType(type: CustomerFieldType): string | boolean {
  return type === "boolean" ? false : "";
}

function CustomerFieldsEditor({
  rows,
  onChange,
  errors = {},
  disabled = false,
}: CustomerFieldsEditorProps) {
  function updateRow(id: string, updates: Partial<CustomerFieldRow>): void {
    onChange(
      rows.map((row) => (row.id === id ? { ...row, ...updates } : row)),
    );
  }

  function changeType(id: string, type: CustomerFieldType): void {
    updateRow(id, { type, value: defaultValueForType(type) });
  }

  function removeRow(id: string): void {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow(): void {
    if (rows.length >= 50) return;
    onChange([...rows, createEmptyCustomerFieldRow()]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-sm font-medium">Custom fields</Label>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            Store useful account details from your own customer data.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addRow}
          disabled={disabled || rows.length >= 50}
          className="min-h-10 shrink-0 transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          <Plus />
          Add field
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-muted/35 px-4 py-5 text-center text-sm text-muted-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
          No custom fields yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-2xl bg-muted/35 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_24px_rgba(0,0,0,0.08)]"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor={`${row.id}-key`}>Field name</Label>
                  <Input
                    id={`${row.id}-key`}
                    value={row.key}
                    onChange={(event) =>
                      updateRow(row.id, { key: event.target.value })
                    }
                    placeholder={index === 0 ? "Plan" : "Field name"}
                    maxLength={64}
                    aria-invalid={Boolean(errors[row.id])}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select
                    value={row.type}
                    onValueChange={(value) =>
                      changeType(row.id, value as CustomerFieldType)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger aria-label={`Type for ${row.key || "field"}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                      <SelectItem value="null">Empty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`${row.id}-value`}>Value</Label>
                  {row.type === "boolean" ? (
                    <div className="flex h-10 items-center gap-3 rounded-xl bg-input-background px-4 shadow-[inset_0_0_0_1px_var(--color-input)]">
                      <Switch
                        id={`${row.id}-value`}
                        checked={Boolean(row.value)}
                        onCheckedChange={(checked) =>
                          updateRow(row.id, { value: checked })
                        }
                        disabled={disabled}
                      />
                      <span className="text-sm text-muted-foreground">
                        {row.value ? "True" : "False"}
                      </span>
                    </div>
                  ) : (
                    <Input
                      id={`${row.id}-value`}
                      value={String(row.value)}
                      onChange={(event) =>
                        updateRow(row.id, { value: event.target.value })
                      }
                      type={row.type === "number" ? "number" : "text"}
                      placeholder={row.type === "null" ? "Always empty" : "Value"}
                      disabled={disabled || row.type === "null"}
                      maxLength={row.type === "string" ? 500 : undefined}
                    />
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                  aria-label={`Remove ${row.key || "custom field"}`}
                  className="h-10 w-10 text-muted-foreground transition-[color,scale] duration-150 ease-out hover:text-destructive active:scale-[0.96]"
                >
                  <Trash2 />
                </Button>
              </div>
              {errors[row.id] ? (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  {errors[row.id]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomerFieldsEditor;
