import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import CustomerFormDialog from "@/components/customers/CustomerFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { CustomerListItem } from "../../shared/customer-types";
import {
  appendCustomerPage,
  customerKeys,
  fetchCustomers,
} from "@/lib/customers";
import { CustomerRealtimeBridge } from "@/components/customers/CustomerRealtimeBridge";

function customerInitial(name: string | null, email: string | null): string {
  return (name?.trim()[0] ?? email?.trim()[0] ?? "?").toUpperCase();
}

function displayCustomerName(name: string | null): string {
  return name?.trim() || "Unnamed customer";
}

function formatFirstSeen(value: string | null): string {
  if (!value) return "Not seen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not seen";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function formatLastSeen(value: string | null): string {
  if (!value) return "No linked activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown activity";
  const elapsedMs = date.getTime() - Date.now();
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(elapsedMinutes) < 60) {
    return formatter.format(elapsedMinutes, "minute");
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) {
    return formatter.format(elapsedHours, "hour");
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 30) {
    return formatter.format(elapsedDays, "day");
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function Customers() {
  const { projectId } = useParams<{ projectId: string }>();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const customersQuery = useInfiniteQuery({
    queryKey: customerKeys.list(projectId ?? "missing", debouncedSearch),
    queryFn: ({ pageParam }) =>
      fetchCustomers(projectId!, {
        query: debouncedSearch,
        cursor: pageParam,
        limit: 25,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(projectId),
  });

  const customers = useMemo(
    () =>
      (customersQuery.data?.pages ?? []).reduce(
        (all, page) => appendCustomerPage(all, page),
        [] as CustomerListItem[],
      ),
    [customersQuery.data],
  );
  const showSearch = customers.length > 0 || search.length > 0;

  if (!projectId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        Select a project to view customers.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CustomerRealtimeBridge projectId={projectId} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MobileMenuButton />
          <div>
            <h1 className="text-balance text-xl font-bold tracking-tight text-foreground md:text-2xl">
              Customers
            </h1>
            <p className="mt-1 max-w-2xl text-pretty text-xs text-muted-foreground md:text-sm">
              Keep every linked support thread with the same customer, across
              visits and devices.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          <Plus />
          Create customer
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl bg-card">
        {customersQuery.isLoading ? (
          <>
            <div className="px-4 py-4 sm:px-6">
              <Skeleton className="h-10 w-full max-w-sm rounded-xl" />
            </div>
            <div className="space-y-1 px-4 pb-4 sm:px-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-4 rounded-lg px-2 py-3 md:grid-cols-[minmax(180px,1.3fr)_minmax(180px,1.3fr)_100px_120px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="hidden h-4 w-40 md:block" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="hidden h-4 w-20 md:block" />
                </div>
              ))}
            </div>
          </>
        ) : customersQuery.isError ? (
          <div className="px-6 py-14 text-center">
            <Users className="mx-auto size-7 text-destructive" />
            <h2 className="mt-3 text-balance font-semibold text-foreground">
              Customer directory unavailable
            </h2>
            <p className="mx-auto mt-1 max-w-md text-pretty text-sm text-muted-foreground">
              We could not load customer profiles. Try the request again.
            </p>
            <Button
              variant="outline"
              onClick={() => customersQuery.refetch()}
              className="mt-5 min-h-10 transition-transform duration-150 ease-out active:scale-[0.96]"
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {showSearch ? (
              <div className="px-4 pt-4 sm:px-6">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search customers"
                    aria-label="Search customers"
                    className="h-10 rounded-xl bg-background/70 pl-9"
                  />
                </div>
              </div>
            ) : null}

            {customers.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {debouncedSearch ? (
                    <Search className="size-5" />
                  ) : (
                    <UserRound className="size-5" />
                  )}
                </div>
                <h2 className="mt-4 text-balance text-lg font-bold text-foreground">
                  {debouncedSearch ? "No customers match" : "No customers yet"}
                </h2>
                <p className="mx-auto mt-1 max-w-md text-pretty text-sm text-muted-foreground">
                  {debouncedSearch
                    ? "Try a different name, email, or external account ID."
                    : "Create the first customer, or connect a visitor from the inbox."}
                </p>
              </div>
            ) : (
              <div role="table" aria-label="Customers" className="mt-3 w-full">
                <div
                  role="row"
                  className="hidden grid-cols-[minmax(180px,1.3fr)_minmax(180px,1.3fr)_100px_120px] items-center gap-x-4 bg-muted/25 px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid xl:grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.3fr)_minmax(120px,0.9fr)_minmax(140px,1fr)_100px_110px_110px]"
                >
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Email</span>
                  <span role="columnheader" className="hidden xl:block">Phone</span>
                  <span role="columnheader" className="hidden xl:block">External ID</span>
                  <span role="columnheader">Conversations</span>
                  <span role="columnheader" className="hidden xl:block">First seen</span>
                  <span role="columnheader">Last active</span>
                </div>
                <div role="rowgroup">
                  {customers.map((customer) => (
                    <Link
                      key={customer.id}
                      to={`/app/projects/${projectId}/customers/${customer.id}`}
                      role="row"
                      aria-label={`Open ${displayCustomerName(customer.name)}`}
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition-colors duration-150 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 md:grid-cols-[minmax(180px,1.3fr)_minmax(180px,1.3fr)_100px_120px] xl:grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.3fr)_minmax(120px,0.9fr)_minmax(140px,1fr)_100px_110px_110px]"
                    >
                      <span role="cell" className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                          {customerInitial(customer.name, customer.email)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {displayCustomerName(customer.name)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground md:hidden">
                            {customer.email ?? "No email"}
                          </span>
                        </span>
                      </span>
                      <span role="cell" className="hidden truncate text-muted-foreground md:block">
                        {customer.email ?? "—"}
                      </span>
                      <span role="cell" className="hidden truncate text-muted-foreground xl:block">
                        {customer.phone ?? "—"}
                      </span>
                      <span role="cell" className="hidden truncate font-mono text-xs text-muted-foreground xl:block">
                        {customer.externalId ?? "—"}
                      </span>
                      <span role="cell" className="text-right md:text-left">
                        <span className="block tabular-nums text-foreground">
                          {customer.conversationCount}
                        </span>
                        <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground md:hidden">
                          {formatLastSeen(customer.lastSeenAt)}
                        </span>
                      </span>
                      <span role="cell" className="hidden whitespace-nowrap text-muted-foreground xl:block">
                        {formatFirstSeen(customer.firstSeenAt)}
                      </span>
                      <span role="cell" className="hidden whitespace-nowrap text-muted-foreground md:block">
                        {formatLastSeen(customer.lastSeenAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {customersQuery.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => customersQuery.fetchNextPage()}
            disabled={customersQuery.isFetchingNextPage}
            className="min-h-10 transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            {customersQuery.isFetchingNextPage ? (
              <Loader2 className="animate-spin" />
            ) : null}
            Load more customers
          </Button>
        </div>
      ) : null}

      <CustomerFormDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}

export default Customers;
