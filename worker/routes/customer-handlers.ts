import { type ZodError } from "zod";
import type {
  CustomerIdentityTokenPayload,
  CustomerInput,
  UpdateCustomerInput,
} from "../../shared/customer-types";
import { logInfo } from "../observability";
import { verifyCustomerIdentityToken } from "../security/customer-identity-token";
import type {
  ConversationCustomerResult,
  CreateCustomerResult,
  MergeCustomerResult,
  SignedVisitorIdentifyResult,
  UpdateCustomerResult,
} from "../services/customer-identity-service";
import type {
  CustomerListOptions,
  CustomerService,
  DeleteCustomerResult,
} from "../services/customer-service";
import {
  conversationCustomerSchema,
  createCustomerSchema,
  customerListQuerySchema,
  mergeCustomerSchema,
  signedWidgetIdentifySchema,
  updateCustomerSchema,
} from "../validation";

export function serializeProjectSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = { ...settings };
  const configured = Boolean(serialized.customerIdentitySecret);
  delete serialized.customerIdentitySecret;
  return {
    ...serialized,
    customerIdentitySecretConfigured: configured,
  };
}

interface CustomerIdentityCreateService {
  createCustomer(
    projectId: string,
    input: CustomerInput,
  ): Promise<CreateCustomerResult>;
}

interface CustomerIdentityUpdateService {
  updateCustomer(
    projectId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<UpdateCustomerResult>;
}

interface CustomerIdentityDeleteService {
  deleteCustomer(
    projectId: string,
    customerId: string,
  ): Promise<DeleteCustomerResult | null>;
}

interface CustomerIdentityMergeService {
  mergeCustomers(
    projectId: string,
    targetCustomerId: string,
    sourceCustomerId: string,
  ): Promise<MergeCustomerResult>;
}

interface ConversationCustomerService {
  promoteConversation(
    projectId: string,
    conversationId: string,
    input: CustomerInput,
  ): Promise<ConversationCustomerResult>;
  linkConversation(
    projectId: string,
    conversationId: string,
    customerId: string,
  ): Promise<ConversationCustomerResult>;
}

interface HandlerEffects {
  onConversationsChanged?: (conversationIds: string[]) => void;
  onCustomersChanged?: (customerIds: string[]) => void;
  logOperation?: (event: string, context: Record<string, unknown>) => void;
}

function validationError(error: ZodError): Response {
  const flattened = error.flatten();
  return Response.json(
    {
      error: "validation_failed",
      fieldErrors: flattened.fieldErrors,
      formErrors: flattened.formErrors,
    },
    { status: 400 },
  );
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function logCustomerOperation(
  effects: HandlerEffects,
  event: string,
  context: Record<string, unknown>,
): void {
  (effects.logOperation ?? logInfo)(event, context);
}

function notifyConversationChanges(
  effects: HandlerEffects,
  conversationIds: string[],
): void {
  if (conversationIds.length > 0) {
    effects.onConversationsChanged?.(conversationIds);
  }
}

function notifyCustomerChanges(
  effects: HandlerEffects,
  customerIds: string[],
): void {
  if (customerIds.length > 0) {
    effects.onCustomersChanged?.(customerIds);
  }
}

export async function handleListCustomers(options: {
  projectId: string;
  query: Record<string, string | undefined>;
  customerService: Pick<CustomerService, "listCustomers">;
}): Promise<Response> {
  const parsed = customerListQuerySchema.safeParse(options.query);
  if (!parsed.success) return validationError(parsed.error);
  const listOptions: CustomerListOptions = {
    query: parsed.data.query,
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
  };
  const result = await options.customerService.listCustomers(
    options.projectId,
    listOptions,
  );
  return Response.json(result);
}

export async function handleCreateCustomer(options: {
  projectId: string;
  body: unknown;
  identityService: CustomerIdentityCreateService;
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const parsed = createCustomerSchema.safeParse(options.body);
  if (!parsed.success) return validationError(parsed.error);
  const result = await options.identityService.createCustomer(
    options.projectId,
    parsed.data,
  );
  if (result.kind === "existing_customer") {
    return Response.json(
      { error: "customer_exists", customerId: result.customerId },
      { status: 409 },
    );
  }
  if (result.kind === "conflict") {
    return Response.json(
      { error: "identity_conflict", customerIds: result.customerIds },
      { status: 409 },
    );
  }
  notifyCustomerChanges(options, [result.customer.id]);
  logCustomerOperation(options, "customer.created", {
    projectId: options.projectId,
    customerId: result.customer.id,
  });
  return Response.json(result.customer, { status: 201 });
}

export async function handleGetCustomer(options: {
  projectId: string;
  customerId: string;
  customerService: Pick<CustomerService, "getCustomerDetail">;
}): Promise<Response> {
  const customer = await options.customerService.getCustomerDetail(
    options.projectId,
    options.customerId,
  );
  return customer ? Response.json(customer) : notFound();
}

export async function handleUpdateCustomer(options: {
  projectId: string;
  customerId: string;
  body: unknown;
  identityService: CustomerIdentityUpdateService;
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const parsed = updateCustomerSchema.safeParse(options.body);
  if (!parsed.success) return validationError(parsed.error);
  const result = await options.identityService.updateCustomer(
    options.projectId,
    options.customerId,
    parsed.data,
  );
  if (result.kind === "not_found") return notFound();
  if (result.kind === "conflict") {
    return Response.json(
      { error: "identity_conflict", customerIds: result.customerIds },
      { status: 409 },
    );
  }
  notifyCustomerChanges(options, [result.customer.id]);
  logCustomerOperation(options, "customer.updated", {
    projectId: options.projectId,
    customerId: options.customerId,
  });
  return Response.json(result.customer);
}

export async function handleDeleteCustomer(options: {
  projectId: string;
  customerId: string;
  identityService: CustomerIdentityDeleteService;
  onConversationsChanged?: HandlerEffects["onConversationsChanged"];
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const result = await options.identityService.deleteCustomer(
    options.projectId,
    options.customerId,
  );
  if (!result) return notFound();
  notifyConversationChanges(options, result.conversationIds);
  notifyCustomerChanges(options, [result.customerId]);
  logCustomerOperation(options, "customer.deleted", {
    projectId: options.projectId,
    customerId: options.customerId,
    conversationIds: result.conversationIds,
  });
  return Response.json({
    customerId: result.customerId,
    conversationIds: result.conversationIds,
  });
}

export async function handleMergeCustomers(options: {
  projectId: string;
  targetCustomerId: string;
  body: unknown;
  identityService: CustomerIdentityMergeService;
  onConversationsChanged?: HandlerEffects["onConversationsChanged"];
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const parsed = mergeCustomerSchema.safeParse(options.body);
  if (!parsed.success) return validationError(parsed.error);
  if (parsed.data.sourceCustomerId === options.targetCustomerId) {
    return Response.json(
      {
        error: "validation_failed",
        fieldErrors: {
          sourceCustomerId: ["Source and target customers must differ"],
        },
        formErrors: [],
      },
      { status: 400 },
    );
  }
  const result = await options.identityService.mergeCustomers(
    options.projectId,
    options.targetCustomerId,
    parsed.data.sourceCustomerId,
  );
  if (result.kind === "not_found") return notFound();
  notifyConversationChanges(options, result.conversationIds);
  notifyCustomerChanges(options, [
    options.targetCustomerId,
    parsed.data.sourceCustomerId,
  ]);
  logCustomerOperation(options, "customer.merged", {
    projectId: options.projectId,
    targetCustomerId: options.targetCustomerId,
    sourceCustomerId: parsed.data.sourceCustomerId,
    conversationIds: result.conversationIds,
  });
  return Response.json({
    customerId: result.customerId,
    conversationIds: result.conversationIds,
  });
}

export async function handleConversationCustomer(options: {
  projectId: string;
  conversationId: string;
  body: unknown;
  identityService: ConversationCustomerService;
  onConversationsChanged?: HandlerEffects["onConversationsChanged"];
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const parsed = conversationCustomerSchema.safeParse(options.body);
  if (!parsed.success) return validationError(parsed.error);
  const result =
    parsed.data.action === "create"
      ? await options.identityService.promoteConversation(
          options.projectId,
          options.conversationId,
          parsed.data.customer,
        )
      : await options.identityService.linkConversation(
          options.projectId,
          options.conversationId,
          parsed.data.customerId,
        );
  if (result.kind === "not_found") return notFound();
  if (result.kind === "conflict") {
    return Response.json(
      { error: "identity_conflict", customerIds: result.customerIds },
      { status: 409 },
    );
  }
  notifyConversationChanges(options, result.conversationIds);
  notifyCustomerChanges(options, [result.customer.id]);
  logCustomerOperation(options, "conversation.customer_linked", {
    projectId: options.projectId,
    customerId: result.customer.id,
    conversationId: options.conversationId,
    conversationIds: result.conversationIds,
    operation: parsed.data.action,
  });
  return Response.json({
    customer: result.customer,
    conversationIds: result.conversationIds,
  });
}

export async function handleSignedWidgetIdentify(options: {
  projectId: string;
  body: unknown;
  encryptedSecret: string | null;
  encryptionKey: string;
  nowSeconds: number;
  verifyToken?: (input: {
    token: string;
    encryptedSecret: string;
    encryptionKey: string;
    expectedProjectId: string;
    nowSeconds: number;
  }) => Promise<CustomerIdentityTokenPayload>;
  getConversation: (
    projectId: string,
    conversationId: string,
  ) => Promise<{ visitorId: string } | null>;
  identityService: {
    identifySignedVisitor(
      projectId: string,
      visitorId: string,
      payload: CustomerIdentityTokenPayload,
    ): Promise<SignedVisitorIdentifyResult>;
  };
  onConversationsChanged?: HandlerEffects["onConversationsChanged"];
  onCustomersChanged?: HandlerEffects["onCustomersChanged"];
  logOperation?: HandlerEffects["logOperation"];
}): Promise<Response> {
  const parsed = signedWidgetIdentifySchema.safeParse(options.body);
  if (!parsed.success) return validationError(parsed.error);
  if (!options.encryptedSecret) {
    return Response.json({ error: "invalid_identity_token" }, { status: 401 });
  }

  let payload: CustomerIdentityTokenPayload;
  try {
    payload = await (options.verifyToken ?? verifyCustomerIdentityToken)({
      token: parsed.data.token,
      encryptedSecret: options.encryptedSecret,
      encryptionKey: options.encryptionKey,
      expectedProjectId: options.projectId,
      nowSeconds: options.nowSeconds,
    });
  } catch {
    logCustomerOperation(options, "customer.signed_identify_rejected", {
      projectId: options.projectId,
      reason: "invalid_token",
    });
    return Response.json({ error: "invalid_identity_token" }, { status: 401 });
  }

  if (parsed.data.conversationId) {
    const conversation = await options.getConversation(
      options.projectId,
      parsed.data.conversationId,
    );
    if (!conversation || conversation.visitorId !== parsed.data.visitorId) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
  }

  const result = await options.identityService.identifySignedVisitor(
    options.projectId,
    parsed.data.visitorId,
    payload,
  );
  if (result.kind === "conflict" || result.kind === "not_found") {
    logCustomerOperation(options, "customer.signed_identify_conflicted", {
      projectId: options.projectId,
    });
    return Response.json({ error: "identity_conflict" }, { status: 409 });
  }
  logCustomerOperation(options, "customer.signed_identify_accepted", {
    projectId: options.projectId,
    customerId: result.customer.id,
    conversationIds: result.conversationIds,
  });
  notifyConversationChanges(options, result.conversationIds);
  notifyCustomerChanges(options, [result.customer.id]);
  return Response.json({ identified: true });
}
