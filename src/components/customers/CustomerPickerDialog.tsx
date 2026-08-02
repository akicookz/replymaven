import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, UserRound } from "lucide-react";
import type { CustomerListItem } from "../../../shared/customer-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { customerKeys, fetchCustomers } from "@/lib/customers";

interface CustomerPickerDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (customer: CustomerListItem) => void;
  excludeCustomerId?: string;
  title?: string;
  description?: string;
  pending?: boolean;
}

function CustomerPickerDialog({
  projectId,
  open,
  onOpenChange,
  onSelect,
  excludeCustomerId,
  title = "Link customer",
  description = "Choose the trusted profile that owns this visitor history.",
  pending = false,
}: CustomerPickerDialogProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setDebouncedSearch("");
    }
  }, [open]);

  const customersQuery = useQuery({
    queryKey: customerKeys.list(projectId, debouncedSearch),
    queryFn: () =>
      fetchCustomers(projectId, { query: debouncedSearch, limit: 50 }),
    enabled: open,
  });
  const customers = (customersQuery.data?.customers ?? []).filter(
    (customer) => customer.id !== excludeCustomerId,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(82vh,720px)] overflow-hidden rounded-3xl bg-card/95 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl sm:max-w-xl">
        <DialogHeader className="px-6 pt-6 sm:px-7 sm:pt-7">
          <DialogTitle className="text-balance font-display text-2xl">
            {title}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4 sm:px-7">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers"
              aria-label="Search customers"
              className="h-11 rounded-2xl pl-10"
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-4 sm:px-4">
          {customersQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading customers
            </div>
          ) : customersQuery.isError ? (
            <p className="rounded-2xl bg-destructive/10 px-4 py-8 text-center text-sm text-destructive">
              Could not load customers.
            </p>
          ) : customers.length === 0 ? (
            <div className="rounded-2xl bg-muted/35 px-4 py-10 text-center">
              <UserRound className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No matching customers.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onSelect(customer)}
                  disabled={pending}
                  className="group flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,scale] duration-150 ease-out hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:opacity-50"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-sm font-semibold text-brand">
                    {(customer.name?.[0] ?? customer.email?.[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {customer.name ?? customer.email ?? "Unnamed customer"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {customer.email ?? `${customer.conversationCount} conversations`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CustomerPickerDialog;
