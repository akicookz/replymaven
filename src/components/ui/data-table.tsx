// Paged table for knowledge items (crawled pages, FAQ pairs, PDF sections, SOPs).
// Renders one page of rows at a time so large sources stay fast; rows open via `onRowClick`.
// <DataTable rows={pages} getRowId={(p) => p.id} columns={cols} selected={ids} onSelectedChange={setIds} />
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Width and alignment, e.g. "w-28 text-right". */
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  pageSize?: number;
  empty?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  selected,
  onSelectedChange,
  pageSize = 50,
  empty,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const visible = rows.slice(start, start + pageSize);
  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const visibleIds = visible.map(getRowId);
  const allVisibleSelected =
    selectable && visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggle(id: string) {
    if (!selectable) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  function toggleVisible() {
    if (!selectable) return;
    const next = new Set(selected);
    for (const id of visibleIds) {
      if (allVisibleSelected) next.delete(id);
      else next.add(id);
    }
    onSelectedChange(next);
  }

  if (rows.length === 0) {
    return (
      <div className="glass-card rounded-lg px-6 py-12 text-center text-sm text-muted-foreground">
        {empty ?? "Nothing here yet."}
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden rounded-lg">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/40">
          <tr>
            {selectable && (
              <th className="w-11 py-2.5 pl-4 text-left">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleVisible}
                  aria-label="Select all on this page"
                />
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.id}
                className={cn(
                  "px-3 py-2.5 text-left text-xs font-medium text-muted-foreground first:pl-4 last:pr-4",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const id = getRowId(row);
            const isSelected = selectable && selected.has(id);
            return (
              <tr
                key={id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer hover:bg-glass-button",
                  isSelected && "bg-primary/5",
                )}
              >
                {selectable && (
                  <td className="py-2.5 pl-4" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggle(id)}
                      aria-label="Select row"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "px-3 py-2.5 align-middle first:pl-4 last:pr-4",
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Previous page"
            className="flex size-7 items-center justify-center rounded-md hover:bg-glass-button disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
            aria-label="Next page"
            className="flex size-7 items-center justify-center rounded-md hover:bg-glass-button disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// Floating bar for actions on the selected rows. Render it only while something is selected.
export function DataTableBulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div className="glass-overlay fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl py-2 pl-4 pr-2 shadow-lg">
      <span className="text-sm tabular-nums text-foreground">{count} selected</span>
      <div className="flex items-center gap-1.5">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-glass-button hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}
