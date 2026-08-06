import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, UserPlus } from "lucide-react";
import type {
  ConversationCustomerResponse,
  CustomerDetail,
  CustomerInput,
} from "../../../shared/customer-types";
import CustomerFieldsEditor from "@/components/customers/CustomerFieldsEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCustomer,
  createCustomerFromConversation,
  CustomerApiError,
  customerFieldsToRows,
  customerKeys,
  serializeCustomerFieldRows,
  type CustomerFieldRow,
} from "@/lib/customers";

interface CustomerFormDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: Partial<CustomerInput>;
  conversationId?: string;
  onCreated?: (
    customer: CustomerDetail,
    conversationResult?: ConversationCustomerResponse,
  ) => void;
}

function CustomerFormDialog({
  projectId,
  open,
  onOpenChange,
  initialValues,
  conversationId,
  onCreated,
}: CustomerFormDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [externalId, setExternalId] = useState("");
  const [fieldRows, setFieldRows] = useState<CustomerFieldRow[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existingCustomerId, setExistingCustomerId] = useState<string | null>(
    null,
  );

  const createMutation = useMutation({
    mutationFn: async (input: CustomerInput) => {
      if (conversationId) {
        const conversationResult = await createCustomerFromConversation(
          projectId,
          conversationId,
          input,
        );
        return {
          customer: conversationResult.customer,
          conversationResult,
        };
      }
      return { customer: await createCustomer(projectId, input) };
    },
    onSuccess(result) {
      const { customer } = result;
      queryClient.invalidateQueries({ queryKey: customerKeys.lists(projectId) });
      queryClient.setQueryData(
        customerKeys.detail(projectId, customer.id),
        customer,
      );
      onCreated?.(customer, result.conversationResult);
      onOpenChange(false);
    },
    onError(error) {
      if (error instanceof CustomerApiError) {
        if (error.payload.customerId) {
          setExistingCustomerId(error.payload.customerId);
          setFormError(
            "That email or external ID already belongs to a customer. Open the existing profile instead.",
          );
          return;
        }
        if (error.payload.customerIds) {
          setFormError(
            "The email and external ID belong to different customers. Merge those profiles before linking them.",
          );
          return;
        }
      }
      setFormError(error instanceof Error ? error.message : "Could not create customer");
    },
  });
  const resetCreateMutation = createMutation.reset;

  useEffect(() => {
    if (!open) return;
    setName(initialValues?.name ?? "");
    setEmail(initialValues?.email ?? "");
    setPhone(initialValues?.phone ?? "");
    setExternalId(initialValues?.externalId ?? "");
    setFieldRows(
      customerFieldsToRows(initialValues?.customFields ?? {}),
    );
    setFieldErrors({});
    setFormError(null);
    setExistingCustomerId(null);
    resetCreateMutation();
  }, [open, initialValues, resetCreateMutation]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(null);
    setExistingCustomerId(null);
    if (!email.trim() && !externalId.trim()) {
      setFormError("Add an email or external ID to create the customer.");
      return;
    }
    const serialized = serializeCustomerFieldRows(fieldRows);
    if (!serialized.success) {
      setFieldErrors(serialized.errors);
      setFormError("Fix the highlighted custom fields before saving.");
      return;
    }
    setFieldErrors({});
    createMutation.mutate({
      name: name.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      externalId: externalId.trim() || null,
      customFields: serialized.customFields,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(88vh,820px)] overflow-y-auto rounded-3xl bg-card/95 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl sm:max-w-3xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="px-6 pt-6 sm:px-7 sm:pt-7">
            <div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-brand/12 text-brand">
              <UserPlus className="size-5" />
            </div>
            <DialogTitle className="text-balance font-display text-2xl">
              Create customer
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 px-6 py-6 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customer-name">Name</Label>
                <Input
                  id="customer-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Sam Lee"
                  maxLength={200}
                  autoComplete="name"
                  disabled={createMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="sam@company.com"
                  type="email"
                  maxLength={320}
                  autoComplete="email"
                  disabled={createMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">Phone</Label>
                <Input
                  id="customer-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Optional"
                  maxLength={50}
                  autoComplete="tel"
                  disabled={createMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-external-id">External ID</Label>
                <Input
                  id="customer-external-id"
                  value={externalId}
                  onChange={(event) => setExternalId(event.target.value)}
                  placeholder="account_123"
                  maxLength={255}
                  disabled={createMutation.isPending}
                />
              </div>
            </div>

            <CustomerFieldsEditor
              rows={fieldRows}
              onChange={setFieldRows}
              errors={fieldErrors}
              disabled={createMutation.isPending}
            />

            {formError ? (
              <div
                className="rounded-2xl bg-destructive/10 px-4 py-3 text-pretty text-sm text-destructive"
                role="alert"
              >
                <p>{formError}</p>
                {existingCustomerId ? (
                  <Button
                    asChild
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 min-h-10 px-0 text-destructive hover:bg-transparent hover:text-destructive"
                  >
                    <Link
                      to={`/app/projects/${projectId}/customers/${existingCustomerId}`}
                    >
                      Open existing customer
                      <ArrowRight />
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="rounded-b-3xl bg-muted/25 px-6 py-4 sm:px-7">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
              className="transition-transform duration-150 ease-out active:scale-[0.96]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending}
              className="transition-transform duration-150 ease-out active:scale-[0.96]"
            >
              {createMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <UserPlus />
              )}
              Create customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CustomerFormDialog;
