import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Loader2,
  MessageSquareText,
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
import { useCustomerWs } from "@/lib/use-customer-ws";

function customerInitial(name: string | null, email: string | null): string {
  return (name?.trim()[0] ?? email?.trim()[0] ?? "?").toUpperCase();
}

function displayCustomerName(name: string | null, email: string | null): string {
  return name?.trim() || email?.trim() || "Unnamed customer";
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
  useCustomerWs(projectId);

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

  if (!projectId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        Select a project to view customers.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MobileMenuButton />
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Workspace
            </p>
            <h1 className="text-balance font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Customers
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
              Keep every linked support thread with the same customer, across
              visits and devices.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="min-h-10 shrink-0 pl-4 pr-3.5 transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          <Plus />
          Create customer
        </Button>
      </div>

      <div className="rounded-3xl bg-card/45 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or external ID"
            aria-label="Search customers"
            className="h-11 rounded-2xl pl-10"
          />
        </div>
      </div>

      {customersQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="rounded-3xl bg-card/40 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
            >
              <div className="flex gap-4">
                <Skeleton className="size-11 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
              </div>
              <Skeleton className="mt-5 h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : customersQuery.isError ? (
        <div className="rounded-3xl bg-destructive/10 px-6 py-12 text-center">
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
      ) : customers.length === 0 ? (
        <div className="rounded-3xl bg-card/40 px-6 py-16 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
            {debouncedSearch ? <Search /> : <UserRound />}
          </div>
          <h2 className="mt-4 text-balance font-display text-xl font-semibold">
            {debouncedSearch ? "No customers match" : "No customers yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-muted-foreground">
            {debouncedSearch
              ? "Try a different name, email, or external account ID."
              : "Create the first customer now, or connect a visitor from the inbox."}
          </p>
          {!debouncedSearch ? (
            <Button
              onClick={() => setCreateOpen(true)}
              className="mt-5 min-h-10 transition-transform duration-150 ease-out active:scale-[0.96]"
            >
              <Plus />
              Create customer
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {customers.map((customer) => {
            const visibleFields = Object.entries(customer.customFields)
              .sort(([left], [right]) => left.localeCompare(right))
              .slice(0, 2);
            return (
              <Link
                key={customer.id}
                to={`/app/projects/${projectId}/customers/${customer.id}`}
                className="group rounded-3xl bg-card/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_8px_30px_rgba(0,0,0,0.10)] transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-card/65 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.09),0_16px_45px_rgba(0,0,0,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-sm font-semibold text-brand">
                    {customerInitial(customer.name, customer.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-foreground">
                          {displayCustomerName(customer.name, customer.email)}
                        </h2>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {customer.email ?? customer.externalId ?? "No account ID"}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>

                    {visibleFields.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {visibleFields.map(([key, value]) => (
                          <span
                            key={key}
                            className="max-w-full truncate rounded-lg bg-muted/55 px-2 py-1 text-[11px] text-muted-foreground"
                          >
                            <span className="text-foreground/80">{key}</span>
                            {": "}
                            {String(value ?? "empty")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <MessageSquareText className="size-3.5" />
                    <span className="tabular-nums">
                      {customer.conversationCount}
                    </span>{" "}
                    {customer.conversationCount === 1 ? "conversation" : "conversations"}
                  </span>
                  <span>{formatLastSeen(customer.lastSeenAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

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
