import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Loader2,
  Mail,
  Merge,
  MonitorSmartphone,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import type { CustomerListItem } from "../../shared/customer-types";
import { MobileMenuButton } from "@/components/PageHeader";
import CustomerFieldsEditor from "@/components/customers/CustomerFieldsEditor";
import CustomerPickerDialog from "@/components/customers/CustomerPickerDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  customerFieldsToRows,
  CustomerApiError,
  customerKeys,
  deleteCustomer,
  fetchCustomer,
  mergeCustomers,
  serializeCustomerFieldRows,
  updateCustomer,
  type CustomerFieldRow,
} from "@/lib/customers";
import { CustomerRealtimeBridge } from "@/components/customers/CustomerRealtimeBridge";

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function visitorLinkLabel(linkedBy: "dashboard" | "signed_widget"): string {
  return linkedBy === "dashboard" ? "Dashboard" : "Signed widget";
}

function CustomerDetail() {
  const { projectId, customerId } = useParams<{
    projectId: string;
    customerId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [externalId, setExternalId] = useState("");
  const [fieldRows, setFieldRows] = useState<CustomerFieldRow[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  const customerQuery = useQuery({
    queryKey: customerKeys.detail(projectId ?? "missing", customerId ?? "missing"),
    queryFn: () => fetchCustomer(projectId!, customerId!),
    enabled: Boolean(projectId && customerId),
  });
  const customer = customerQuery.data;

  useEffect(() => {
    if (!customer) return;
    setName(customer.name ?? "");
    setEmail(customer.email ?? "");
    setPhone(customer.phone ?? "");
    setExternalId(customer.externalId ?? "");
    setFieldRows(customerFieldsToRows(customer.customFields));
    setFieldErrors({});
    setFormError(null);
  }, [customer]);

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateCustomer>[2]) =>
      updateCustomer(projectId!, customerId!, input),
    onSuccess(updated) {
      queryClient.setQueryData(customerKeys.detail(projectId!, customerId!), updated);
      queryClient.invalidateQueries({ queryKey: customerKeys.lists(projectId!) });
      toast.success("Customer updated");
    },
    onError(error) {
      if (
        error instanceof CustomerApiError &&
        error.payload.error === "identity_conflict"
      ) {
        setFormError(
          "That email or external ID is already used by another customer. Merge the profiles before reusing it.",
        );
        return;
      }
      setFormError(error instanceof Error ? error.message : "Could not update customer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomer(projectId!, customerId!),
    onSuccess() {
      queryClient.removeQueries({
        queryKey: customerKeys.detail(projectId!, customerId!),
      });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      toast.success("Customer deleted");
      navigate(`/app/projects/${projectId}/customers`);
    },
    onError() {
      toast.error("Could not delete customer");
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (sourceCustomerId: string) =>
      mergeCustomers(projectId!, customerId!, sourceCustomerId),
    onSuccess() {
      setMergeOpen(false);
      queryClient.invalidateQueries({
        queryKey: customerKeys.detail(projectId!, customerId!),
      });
      queryClient.invalidateQueries({ queryKey: customerKeys.lists(projectId!) });
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      toast.success("Customers merged");
    },
    onError() {
      toast.error("Could not merge customers");
    },
  });

  function handleSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(null);
    const serialized = serializeCustomerFieldRows(fieldRows);
    if (!serialized.success) {
      setFieldErrors(serialized.errors);
      setFormError("Fix the highlighted custom fields before saving.");
      return;
    }
    setFieldErrors({});
    updateMutation.mutate({
      name: name.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      externalId: externalId.trim() || null,
      customFields: serialized.customFields,
    });
  }

  function handleMergeSource(source: CustomerListItem): void {
    mergeMutation.mutate(source.id);
  }

  if (!projectId || !customerId) return null;

  if (customerQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-52" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Skeleton className="h-[560px] rounded-3xl" />
          <Skeleton className="h-[420px] rounded-3xl" />
        </div>
      </div>
    );
  }

  if (customerQuery.isError || !customer) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <UserRound className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-balance font-display text-2xl font-semibold">
          Customer not found
        </h1>
        <Button asChild variant="outline" className="mt-5 min-h-10">
          <Link to={`/app/projects/${projectId}/customers`}>
            <ArrowLeft />
            Back to customers
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <CustomerRealtimeBridge projectId={projectId} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <Button asChild variant="ghost" size="icon" className="size-10 shrink-0">
            <Link
              to={`/app/projects/${projectId}/customers`}
              aria-label="Back to customers"
            >
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Customer profile
            </p>
            <h1 className="mt-2 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {customer.name ?? customer.email ?? "Unnamed customer"}
            </h1>
            <p className="mt-2 text-pretty text-sm text-muted-foreground">
              First seen {formatDate(customer.firstSeenAt)} · Last seen{" "}
              {formatDate(customer.lastSeenAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => setMergeOpen(true)}
            className="min-h-10 transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            <Merge />
            Merge
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            className="min-h-10 text-destructive transition-transform duration-150 ease-out hover:text-destructive active:scale-[0.96]"
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start">
        <div className="space-y-5">
          <form
            onSubmit={handleSave}
            className="rounded-3xl bg-card/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_14px_45px_rgba(0,0,0,0.12)] sm:p-6"
          >
            <div>
              <h2 className="text-balance font-display text-xl font-semibold">
                Profile fields
              </h2>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                Keep the customer record aligned with the account data in your
                own application.
              </p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="detail-name">Name</Label>
                <Input
                  id="detail-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-email">Contact email</Label>
                <Input
                  id="detail-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  maxLength={320}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-phone">Phone</Label>
                <Input
                  id="detail-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={50}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-external-id">External ID</Label>
                <Input
                  id="detail-external-id"
                  value={externalId}
                  onChange={(event) => setExternalId(event.target.value)}
                  placeholder="account_123"
                  maxLength={255}
                />
                <p className="text-pretty text-[11px] text-muted-foreground">
                  The stable user or account ID from your application.
                </p>
              </div>
            </div>
            <div className="mt-6">
              <CustomerFieldsEditor
                rows={fieldRows}
                onChange={setFieldRows}
                errors={fieldErrors}
                disabled={updateMutation.isPending}
              />
            </div>
            {formError ? (
              <p className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="min-h-10 pl-4 pr-3.5 transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                Save changes
              </Button>
            </div>
          </form>
        </div>

        <div className="space-y-5">
          <section className="rounded-3xl bg-card/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_14px_45px_rgba(0,0,0,0.12)] sm:p-6">
            <div className="flex items-center gap-3">
              <MonitorSmartphone className="size-5 text-brand" />
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Connected visitors
                </h2>
                <p className="text-pretty text-sm text-muted-foreground">
                  Widget visitor IDs whose conversations belong to this customer.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              {customer.visitors.length === 0 ? (
                <p className="rounded-2xl bg-muted/30 px-4 py-8 text-center text-pretty text-sm text-muted-foreground">
                  No widget visitors connected yet.
                </p>
              ) : (
                customer.visitors.map((visitor) => (
                  <div
                    key={visitor.id}
                    className="rounded-2xl bg-muted/30 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        Visitor ID
                      </span>
                      <span className="rounded-lg bg-background/55 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {visitorLinkLabel(visitor.linkedBy)}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-sm text-foreground/90">
                      {visitor.visitorId}
                    </p>
                    <p className="mt-2 text-pretty text-[11px] text-muted-foreground">
                      Connected {formatDate(visitor.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl bg-card/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_14px_45px_rgba(0,0,0,0.12)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Conversations
                </h2>
                <p className="text-pretty text-sm text-muted-foreground">
                  Every support thread linked to this customer.
                </p>
              </div>
              <span className="rounded-xl bg-muted/45 px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
                {customer.conversations.length}
              </span>
            </div>
            <div className="mt-5 space-y-2">
              {customer.conversations.length === 0 ? (
                <p className="rounded-2xl bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  No linked conversations.
                </p>
              ) : (
                customer.conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    to={`/app/projects/${projectId}/conversations?filter=all&id=${conversation.id}`}
                    className="group flex min-h-14 items-center gap-3 rounded-2xl bg-muted/30 px-3 py-2.5 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/50 active:scale-[0.96]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background/55 text-muted-foreground">
                      {conversation.visitorEmail ? <Mail /> : <CalendarDays />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {conversation.visitorName ??
                          conversation.visitorEmail ??
                          "Anonymous visitor"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {conversation.status.replace("_", " ")} ·{" "}
                        {formatDate(conversation.lastActivityAt)}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      <CustomerPickerDialog
        projectId={projectId}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onSelect={handleMergeSource}
        excludeCustomerId={customerId}
        title="Merge into this customer"
        description="Choose a duplicate profile. This profile survives and its existing values take precedence."
        pending={mergeMutation.isPending}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-3xl bg-card/95 shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-balance font-display text-2xl">
              Delete customer?
            </DialogTitle>
            <DialogDescription className="text-pretty">
              The profile and connected visitor links are removed. Retained
              support conversations remain, but become unlinked from a customer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="transition-transform duration-150 ease-out active:scale-[0.96]"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Delete customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CustomerDetail;
