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
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  CustomerConversationDto,
  CustomerListItem,
} from "../../shared/customer-types";
import { MobileMenuButton } from "@/components/PageHeader";
import CustomerFieldsEditor from "@/components/customers/CustomerFieldsEditor";
import CustomerPickerDialog from "@/components/customers/CustomerPickerDialog";
import { Badge } from "@/components/ui/badge";
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
import { WidgetSectionCard } from "@/components/WidgetSettings";
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

function customerConversationFilter(
  conversation: CustomerConversationDto,
): string {
  if (conversation.archivedAt) return "archived";
  if (conversation.closeReason === "spam") return "flagged";
  if (conversation.status === "closed") return "resolved";
  if (conversation.status === "waiting_agent") return "needs-you";
  return "inbox";
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
      <div className="space-y-6">
        <Skeleton className="h-8 w-52" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Skeleton className="h-[420px] rounded-2xl" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (customerQuery.isError || !customer) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <UserRound className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-balance text-xl font-bold text-foreground md:text-2xl">
          Customer not found
        </h1>
        <Button asChild variant="outline" className="mt-5">
          <Link to={`/app/projects/${projectId}/customers`}>
            <ArrowLeft />
            Back to customers
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CustomerRealtimeBridge projectId={projectId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <MobileMenuButton />
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 hidden shrink-0 text-muted-foreground hover:text-foreground md:inline-flex"
          >
            <Link
              to={`/app/projects/${projectId}/customers`}
              aria-label="Back to customers"
            >
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">
              {customer.name ?? customer.email ?? "Unnamed customer"}
            </h1>
            <p className="mt-1 text-pretty text-xs text-muted-foreground md:text-sm">
              First seen {formatDate(customer.firstSeenAt)} · Last seen{" "}
              {formatDate(customer.lastSeenAt)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => setMergeOpen(true)}
            className="transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            <Merge />
            Merge
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            className="text-destructive transition-transform duration-150 ease-out hover:bg-destructive/10 hover:text-destructive active:scale-[0.96]"
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start">
        <form onSubmit={handleSave}>
          <WidgetSectionCard title="Profile">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="detail-name">Name</Label>
                <Input
                  id="detail-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-email">Contact email</Label>
                <Input
                  id="detail-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  maxLength={320}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-phone">Phone</Label>
                <Input
                  id="detail-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-external-id">External ID</Label>
                <Input
                  id="detail-external-id"
                  value={externalId}
                  onChange={(event) => setExternalId(event.target.value)}
                  placeholder="Your app's user ID"
                  maxLength={255}
                />
              </div>
            </div>
            <div className="pt-2">
              <CustomerFieldsEditor
                rows={fieldRows}
                onChange={setFieldRows}
                errors={fieldErrors}
                disabled={updateMutation.isPending}
              />
            </div>
            {formError ? (
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                Save changes
              </Button>
            </div>
          </WidgetSectionCard>
        </form>

        <div className="space-y-6">
          <WidgetSectionCard title="Connected visitors">
            {customer.visitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No widget visitors connected yet.
              </p>
            ) : (
              <div className="space-y-4">
                {customer.visitors.map((visitor) => (
                  <div key={visitor.id} className="space-y-1.5">
                    <p className="break-all font-mono text-xs text-foreground/90">
                      {visitor.visitorId}
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        Connected {formatDate(visitor.createdAt)}
                      </span>
                      <Badge variant="secondary">
                        {visitorLinkLabel(visitor.linkedBy)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </WidgetSectionCard>

          <WidgetSectionCard
            title="Conversations"
            action={
              <Badge variant="secondary" className="tabular-nums">
                {customer.conversations.length}
              </Badge>
            }
          >
            {customer.conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No linked conversations.
              </p>
            ) : (
              <div className="-mx-3 space-y-1">
                {customer.conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    to={`/app/projects/${projectId}/conversations?filter=${customerConversationFilter(conversation)}&id=${conversation.id}`}
                    className="group flex items-center gap-3 rounded-xl px-3 py-2 transition-[background-color,scale] duration-150 ease-out hover:bg-accent/50 active:scale-[0.98]"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/50 text-muted-foreground [&_svg]:size-4">
                      {conversation.visitorEmail ? <Mail /> : <CalendarDays />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {conversation.visitorName ??
                          conversation.visitorEmail ??
                          "Anonymous visitor"}
                      </span>
                      <span className="block text-xs text-muted-foreground first-letter:uppercase">
                        {conversation.status.replace("_", " ")} ·{" "}
                        {formatDate(conversation.lastActivityAt)}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            )}
          </WidgetSectionCard>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer?</DialogTitle>
            <DialogDescription>
              Conversations stay, but are no longer linked to a customer.
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
