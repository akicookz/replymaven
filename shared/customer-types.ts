export type CustomerFieldValue = string | number | boolean | null;

export interface CustomerInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  customFields: Record<string, CustomerFieldValue>;
}

export interface UpdateCustomerInput {
  externalId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customFields?: Record<string, CustomerFieldValue>;
}

export type ConversationCustomerInput =
  | { action: "create"; customer: CustomerInput }
  | { action: "link"; customerId: string };

export interface CustomerIdentityTokenPayload {
  v: 1;
  projectId: string;
  externalId?: string;
  email?: string;
  name?: string;
  phone?: string;
  customFields?: Record<string, CustomerFieldValue>;
  iat: number;
  exp: number;
}

export type CustomerVisitorLinkSource = "dashboard" | "signed_widget";

export interface CustomerVisitorDto {
  id: string;
  visitorId: string;
  linkedBy: CustomerVisitorLinkSource;
  createdAt: string;
}

export interface CustomerConversationDto {
  id: string;
  visitorName: string | null;
  visitorEmail: string | null;
  status: "active" | "waiting_agent" | "agent_replied" | "closed";
  closeReason: "resolved" | "ended" | "spam" | "bot_resolved" | null;
  lastActivityAt: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface CustomerListItem {
  id: string;
  externalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  customFields: Record<string, CustomerFieldValue>;
  conversationCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  visitors: CustomerVisitorDto[];
  conversations: CustomerConversationDto[];
}

export interface CustomerListResult {
  customers: CustomerListItem[];
  nextCursor: string | null;
}

export interface ConversationCustomerResponse {
  customer: CustomerDetail;
  conversationIds: string[];
}
