import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createEmptyCustomerFieldRow,
  type CustomerFieldRow,
} from "@/lib/customers";

interface CustomerFieldsEditorProps {
  rows: CustomerFieldRow[];
  onChange: (rows: CustomerFieldRow[]) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
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
          className="shrink-0 text-muted-foreground transition-[color,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96]"
        >
          <Plus />
          Add field
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-muted/15 px-4 py-4 text-center text-xs text-muted-foreground/60">
          No custom fields yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-xl bg-muted/20 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
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
                  <Label htmlFor={`${row.id}-value`}>Value</Label>
                  <Input
                    id={`${row.id}-value`}
                    value={row.value}
                    onChange={(event) =>
                      updateRow(row.id, { value: event.target.value })
                    }
                    placeholder="Value"
                    disabled={disabled}
                    maxLength={500}
                  />
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
