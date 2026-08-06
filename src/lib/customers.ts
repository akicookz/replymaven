import type { QueryClient } from "@tanstack/react-query";
import type {
  CustomerDetail,
  CustomerFieldValue,
  CustomerInput,
  CustomerListItem,
  CustomerListResult,
  ConversationCustomerInput,
  ConversationCustomerResponse,
  UpdateCustomerInput,
} from "../../shared/customer-types";

export interface CustomerFieldRow {
  id: string;
  key: string;
  value: string;
}

export type SerializeCustomerFieldsResult =
  | {
      success: true;
      customFields: Record<string, string>;
    }
  | { success: false; errors: Record<string, string> };

export interface CustomerListRequest {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface CustomerApiErrorPayload {
  error?: string;
  customerId?: string;
  customerIds?: [string, string];
  fieldErrors?: Record<string, string[]>;
}

export class CustomerApiError extends Error {
  readonly status: number;
  readonly payload: CustomerApiErrorPayload;

  constructor(
    message: string,
    status: number,
    payload: CustomerApiErrorPayload,
  ) {
    super(message);
    this.name = "CustomerApiError";
    this.status = status;
    this.payload = payload;
  }
}

export const customerKeys = {
  all: ["customers"] as const,
  project: (projectId: string) => [...customerKeys.all, projectId] as const,
  lists: (projectId: string) =>
    [...customerKeys.project(projectId), "list"] as const,
  list: (projectId: string, query: string) =>
    [...customerKeys.lists(projectId), query] as const,
  details: (projectId: string) =>
    [...customerKeys.project(projectId), "detail"] as const,
  detail: (projectId: string, customerId: string) =>
    [...customerKeys.details(projectId), customerId] as const,
};

export function invalidateCustomerProjectQueries(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: customerKeys.project(projectId),
  });
}

export function shouldOfferCustomerAssignment(
  customerId: string | null,
  archivedAt: string | null | undefined,
): boolean {
  void archivedAt;
  return customerId === null;
}

export function createEmptyCustomerFieldRow(): CustomerFieldRow {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
  };
}

export function customerFieldsToRows(
  customFields: Record<string, CustomerFieldValue>,
): CustomerFieldRow[] {
  return Object.entries(customFields).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value: value === null ? "" : String(value),
  }));
}

export function serializeCustomerFieldRows(
  rows: CustomerFieldRow[],
): SerializeCustomerFieldsResult {
  const errors: Record<string, string> = {};
  const rowsWithValues = rows.filter((row) => row.value.trim().length > 0);
  const trimmedKeys = rowsWithValues.map((row) => row.key.trim());
  const keyCounts = new Map<string, number>();
  for (const key of trimmedKeys) {
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  for (const [index, row] of rowsWithValues.entries()) {
    const key = trimmedKeys[index];
    if (!key) {
      errors[row.id] = "Field key is required";
    } else if (key.length > 64) {
      errors[row.id] = "Field key must be 64 characters or fewer";
    } else if ((keyCounts.get(key) ?? 0) > 1) {
      errors[row.id] = "Field keys must be unique";
    } else if (row.value.length > 500) {
      errors[row.id] = "Text value must be 500 characters or fewer";
    }
  }
  if (Object.keys(errors).length > 0) return { success: false, errors };

  const customFields: Record<string, string> = {};
  for (const [index, row] of rowsWithValues.entries()) {
    const key = trimmedKeys[index];
    customFields[key] = row.value;
  }
  return { success: true, customFields };
}

export function appendCustomerPage(
  existing: CustomerListItem[],
  page: CustomerListResult,
): CustomerListItem[] {
  const knownIds = new Set(existing.map((customer) => customer.id));
  return [
    ...existing,
    ...page.customers.filter((customer) => !knownIds.has(customer.id)),
  ];
}

export function applyConversationCustomerResult<
  T extends { id: string; customerId: string | null },
>(
  conversations: T[],
  result: ConversationCustomerResponse,
): T[] {
  const changedIds = new Set(result.conversationIds);
  return conversations.map((conversation) =>
    changedIds.has(conversation.id)
      ? { ...conversation, customerId: result.customer.id }
      : conversation,
  );
}

async function readErrorPayload(response: Response): Promise<CustomerApiErrorPayload> {
  try {
    return (await response.json()) as CustomerApiErrorPayload;
  } catch {
    return {};
  }
}

async function assertCustomerResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const payload = await readErrorPayload(response);
  throw new CustomerApiError(
    payload.error ?? "Customer request failed",
    response.status,
    payload,
  );
}

export async function fetchCustomers(
  projectId: string,
  request: CustomerListRequest = {},
): Promise<CustomerListResult> {
  const params = new URLSearchParams();
  if (request.query?.trim()) params.set("query", request.query.trim());
  if (request.cursor) params.set("cursor", request.cursor);
  params.set("limit", String(request.limit ?? 25));
  const response = await fetch(
    `/api/projects/${projectId}/customers?${params.toString()}`,
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<CustomerListResult>;
}

export async function fetchCustomer(
  projectId: string,
  customerId: string,
): Promise<CustomerDetail> {
  const response = await fetch(
    `/api/projects/${projectId}/customers/${customerId}`,
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<CustomerDetail>;
}

export async function createCustomer(
  projectId: string,
  input: CustomerInput,
): Promise<CustomerDetail> {
  const response = await fetch(`/api/projects/${projectId}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await assertCustomerResponse(response);
  return response.json() as Promise<CustomerDetail>;
}

export async function updateCustomer(
  projectId: string,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerDetail> {
  const response = await fetch(
    `/api/projects/${projectId}/customers/${customerId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<CustomerDetail>;
}

export async function setConversationCustomer(
  projectId: string,
  conversationId: string,
  input: ConversationCustomerInput,
): Promise<ConversationCustomerResponse> {
  const response = await fetch(
    `/api/projects/${projectId}/conversations/${conversationId}/customer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<ConversationCustomerResponse>;
}

export async function createCustomerFromConversation(
  projectId: string,
  conversationId: string,
  customer: CustomerInput,
): Promise<ConversationCustomerResponse> {
  return setConversationCustomer(projectId, conversationId, {
    action: "create",
    customer,
  });
}

export async function deleteCustomer(
  projectId: string,
  customerId: string,
): Promise<{ customerId: string; conversationIds: string[] }> {
  const response = await fetch(
    `/api/projects/${projectId}/customers/${customerId}`,
    { method: "DELETE" },
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<{
    customerId: string;
    conversationIds: string[];
  }>;
}

export async function mergeCustomers(
  projectId: string,
  targetCustomerId: string,
  sourceCustomerId: string,
): Promise<{
  customerId: string;
  conversationIds: string[];
}> {
  const response = await fetch(
    `/api/projects/${projectId}/customers/${targetCustomerId}/merge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceCustomerId }),
    },
  );
  await assertCustomerResponse(response);
  return response.json() as Promise<{
    customerId: string;
    conversationIds: string[];
  }>;
}
