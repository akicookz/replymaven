import { tool, type ToolSet } from "ai";
import { z } from "zod";

// Sidechat tools that act on the public conversation. Each execute calls the
// parent agent, which reuses the same functions as the dashboard routes.

// target_* only come from a teammate thread, where every action names its
// conversation.
export type SidechatScopeError =
  | "conversation_unavailable"
  | "target_unavailable"
  | "target_mismatch";

export type SidechatReplyResult =
  | {
    sent: true;
    messageId: string;
    // Facts for deciding whether to offer an email; the reply itself stays
    // in the chat.
    customerOnline: boolean;
    customerWroteByEmail: boolean;
    customerEmailOnFile: boolean;
  }
  | { blocked: "assigned_to"; assigneeName: string }
  | { blocked: "unknown_author" }
  | { error: SidechatScopeError };

export type SidechatEmailResult =
  | { emailed: true; to: string; messageId: string }
  | { blocked: "assigned_to"; assigneeName: string }
  | { blocked: "unknown_author" }
  | {
    error:
      | SidechatScopeError
      | "no_email"
      | "failed"
      | "message_not_found"
      | "already_emailed";
  };

// Exactly one: an existing chat message to email as it is, or new text.
export type SidechatEmailInput =
  | { messageId: string; text: null }
  | { messageId: null; text: string };

export type SidechatActionResult =
  | { ok: true }
  | { error: string };

export type SidechatDecideResult =
  | { ok: true; willRun: boolean }
  | { error: "unknown_author" | "nothing_pending" };

export type SidechatContactResult =
  | { ok: true }
  | {
    error:
      | "already_set"
      | "nothing_given"
      | SidechatScopeError
      | "unknown_author";
  };

export interface SidechatActionDeps {
  replyToConversation(text: string, toolCallId: string): Promise<SidechatReplyResult>;
  emailCustomer(
    input: SidechatEmailInput,
    toolCallId: string,
  ): Promise<SidechatEmailResult>;
  setCustomerContact(input: {
    name: string | null;
    email: string | null;
  }): Promise<SidechatContactResult>;
  assignConversation(
    assigneeId: string,
    instructions: string | null,
  ): Promise<SidechatActionResult>;
  closeConversation(): Promise<SidechatActionResult>;
  blockCustomer(reason: string): Promise<SidechatActionResult>;
  decidePendingAction?: (
    decision: "approve" | "reject",
  ) => Promise<SidechatDecideResult>;
}

export const REPLY_TO_CONVERSATION_TOOL_NAME = "reply_to_conversation";
export const EMAIL_CUSTOMER_TOOL_NAME = "email_customer";
export const ASSIGN_CONVERSATION_TOOL_NAME = "assign_conversation";
export const CLOSE_CONVERSATION_TOOL_NAME = "close_conversation";
export const BLOCK_CUSTOMER_TOOL_NAME = "block_customer";
export const DECIDE_PENDING_ACTION_TOOL_NAME = "decide_pending_action";
export const SET_CUSTOMER_CONTACT_TOOL_NAME = "set_customer_contact";

export const SIDECHAT_ACTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  REPLY_TO_CONVERSATION_TOOL_NAME,
  EMAIL_CUSTOMER_TOOL_NAME,
  ASSIGN_CONVERSATION_TOOL_NAME,
  CLOSE_CONVERSATION_TOOL_NAME,
  BLOCK_CUSTOMER_TOOL_NAME,
  DECIDE_PENDING_ACTION_TOOL_NAME,
  SET_CUSTOMER_CONTACT_TOOL_NAME,
]);

export function buildSidechatActionTools(deps: SidechatActionDeps): ToolSet {
  const tools: ToolSet = {
    [REPLY_TO_CONVERSATION_TOOL_NAME]: tool({
      description:
        "Post this text to the customer in the conversation's chat now. Use when the teammate asked you to answer, or the conversation is assigned to you. It does not send an email.",
      inputSchema: z.object({
        text: z.string().trim().min(1).max(5_000),
      }),
      async execute({ text }, context) {
        return deps.replyToConversation(text, context.toolCallId);
      },
    }),
    [EMAIL_CUSTOMER_TOOL_NAME]: tool({
      description:
        "Email the customer. Give messageId to email a message already in the chat as it is (no new chat message), or text to post a new message in the chat and email it. Give exactly one. It cannot be taken back.",
      inputSchema: z.object({
        messageId: z.string().trim().min(1).max(200).nullable().optional(),
        text: z.string().trim().min(1).max(5_000).nullable().optional(),
      }).refine(
        (value) => Boolean(value.messageId) !== Boolean(value.text),
        "Give exactly one of messageId or text.",
      ),
      async execute({ messageId, text }, context) {
        const input: SidechatEmailInput = messageId
          ? { messageId, text: null }
          : { messageId: null, text: text ?? "" };
        return deps.emailCustomer(input, context.toolCallId);
      },
    }),
    [ASSIGN_CONVERSATION_TOOL_NAME]: tool({
      description:
        "Assign the conversation to a teammate or to yourself. Use an id from teammates in the context. When assigning to yourself, instructions are what you must follow with this customer from now on.",
      inputSchema: z.object({
        assigneeId: z.string().trim().min(1).max(100),
        instructions: z.string().trim().max(2_000).nullable().optional(),
      }),
      async execute({ assigneeId, instructions }) {
        return deps.assignConversation(assigneeId, instructions ?? null);
      },
    }),
    [CLOSE_CONVERSATION_TOOL_NAME]: tool({
      description: "Mark the conversation resolved.",
      inputSchema: z.object({}),
      async execute() {
        return deps.closeConversation();
      },
    }),
    [SET_CUSTOMER_CONTACT_TOOL_NAME]: tool({
      description:
        "Record who the customer is when the conversation has no customer email yet, for example from the From line of a forwarded email. Refused once an email is set.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100).nullable().optional(),
        email: z.string().trim().regex(EMAIL_PATTERN).max(320)
          .nullable()
          .optional(),
      }),
      async execute({ name, email }) {
        return deps.setCustomerContact({ name: name ?? null, email: email ?? null });
      },
    }),
    [BLOCK_CUSTOMER_TOOL_NAME]: tool({
      description:
        "Block the customer and close all their open conversations as spam.",
      inputSchema: z.object({
        reason: z.string().trim().min(1).max(500),
      }),
      async execute({ reason }) {
        return deps.blockCustomer(reason);
      },
    }),
  };
  if (deps.decidePendingAction) {
    const decide = deps.decidePendingAction;
    tools[DECIDE_PENDING_ACTION_TOOL_NAME] = tool({
      description:
        "Record the teammate's decision on the action waiting for approval. Only call this after the teammate answered.",
      inputSchema: z.object({
        decision: z.enum(["approve", "reject"]),
      }),
      async execute({ decision }) {
        return decide(decision);
      },
    });
  }
  return tools;
}

// ─── Teammate threads ─────────────────────────────────────────────────────
// A teammate's own thread has no conversation of its own, so every customer
// action names its target, and sends wait for approval.

export interface SidechatTarget {
  conversationId: string;
  // The customer's name or email as the conversation shows it.
  customer: string;
}

export type SidechatTargetCheck =
  | { ok: true; customerName: string | null; customerEmail: string | null }
  | { error: "target_unavailable" | "target_mismatch" };

export type SidechatStartConversationResult =
  | { started: true; conversationId: string; customerName: string | null; customerEmail: string }
  | { existing: true; conversationId: string }
  | {
    error:
      | "address_not_in_thread"
      | "message_not_in_thread"
      | "teammate_address"
      | "unknown_author"
      | "failed";
  };

export interface ConversationSearchInput {
  text: string | null;
  scope: "needs-you" | "open" | "snoozed" | "resolved" | "all";
  assignee: string | null;
  activeWithinDays: number | null;
  limit: number;
}

export interface TeammateThreadActionDeps {
  verifyTarget(target: SidechatTarget): Promise<SidechatTargetCheck>;
  replyToConversation(
    target: SidechatTarget,
    text: string,
    toolCallId: string,
  ): Promise<SidechatReplyResult>;
  emailCustomer(
    target: SidechatTarget,
    input: SidechatEmailInput,
    toolCallId: string,
  ): Promise<SidechatEmailResult>;
  assignConversation(
    target: SidechatTarget,
    assigneeId: string,
    instructions: string | null,
  ): Promise<SidechatActionResult>;
  closeConversation(target: SidechatTarget): Promise<SidechatActionResult>;
  blockCustomer(
    target: SidechatTarget,
    reason: string,
  ): Promise<SidechatActionResult>;
  startCustomerConversation(input: {
    name: string | null;
    email: string;
    customerMessage: string;
    subject: string | null;
  }): Promise<SidechatStartConversationResult>;
  decidePendingAction?: (
    decision: "approve" | "reject",
  ) => Promise<SidechatDecideResult>;
}

export const SEARCH_CONVERSATIONS_TOOL_NAME = "search_conversations";
export const START_CUSTOMER_CONVERSATION_TOOL_NAME =
  "start_customer_conversation";

// Sends that cannot be taken back. From a teammate thread they always wait
// for approval.
export const TEAMMATE_THREAD_APPROVAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  REPLY_TO_CONVERSATION_TOOL_NAME,
  EMAIL_CUSTOMER_TOOL_NAME,
]);

// Plain pattern: .email() emits a lookaround regex OpenAI rejects.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const targetShape = {
  conversationId: z.string().trim().min(1).max(100).describe(
    "Copied exactly from openConversations or a search_conversations result. Never this thread's id.",
  ),
  customer: z.string().trim().min(1).max(320).describe(
    "The customer's name or email exactly as that conversation shows it.",
  ),
};

function readTarget(input: { conversationId: string; customer: string }): SidechatTarget {
  return { conversationId: input.conversationId, customer: input.customer };
}

export function buildTeammateThreadActionTools(
  deps: TeammateThreadActionDeps,
): ToolSet {
  // An approval card only appears for a target that passed the check; a bad
  // target fails at once with its error instead.
  const needsApprovalFor = async (input: unknown) => {
    const record = input as { conversationId?: unknown; customer?: unknown };
    if (
      typeof record.conversationId !== "string" ||
      typeof record.customer !== "string"
    ) {
      return false;
    }
    const check = await deps.verifyTarget({
      conversationId: record.conversationId,
      customer: record.customer,
    });
    return "ok" in check;
  };
  const tools: ToolSet = {
    [REPLY_TO_CONVERSATION_TOOL_NAME]: tool({
      description:
        "Post this text to the customer in the target conversation's chat. Waits for the teammate's approval. It does not send an email.",
      inputSchema: z.object({
        ...targetShape,
        text: z.string().trim().min(1).max(5_000),
      }),
      needsApproval: needsApprovalFor,
      async execute(input, context) {
        return deps.replyToConversation(
          readTarget(input),
          input.text,
          context.toolCallId,
        );
      },
    }),
    [EMAIL_CUSTOMER_TOOL_NAME]: tool({
      description:
        "Email the customer of the target conversation. Give messageId to email a message already in its chat, or text for a new message. Give exactly one. Waits for the teammate's approval and cannot be taken back.",
      inputSchema: z.object({
        ...targetShape,
        messageId: z.string().trim().min(1).max(200).nullable().optional(),
        text: z.string().trim().min(1).max(5_000).nullable().optional(),
      }).refine(
        (value) => Boolean(value.messageId) !== Boolean(value.text),
        "Give exactly one of messageId or text.",
      ),
      needsApproval: needsApprovalFor,
      async execute(input, context) {
        const email: SidechatEmailInput = input.messageId
          ? { messageId: input.messageId, text: null }
          : { messageId: null, text: input.text ?? "" };
        return deps.emailCustomer(readTarget(input), email, context.toolCallId);
      },
    }),
    [ASSIGN_CONVERSATION_TOOL_NAME]: tool({
      description:
        "Assign the target conversation to a teammate or to yourself. Use an id from teammates in the context. When assigning to yourself, instructions are what you must follow with this customer from now on.",
      inputSchema: z.object({
        ...targetShape,
        assigneeId: z.string().trim().min(1).max(100),
        instructions: z.string().trim().max(2_000).nullable().optional(),
      }),
      async execute(input) {
        return deps.assignConversation(
          readTarget(input),
          input.assigneeId,
          input.instructions ?? null,
        );
      },
    }),
    [CLOSE_CONVERSATION_TOOL_NAME]: tool({
      description: "Mark the target conversation resolved.",
      inputSchema: z.object(targetShape),
      async execute(input) {
        return deps.closeConversation(readTarget(input));
      },
    }),
    [BLOCK_CUSTOMER_TOOL_NAME]: tool({
      description:
        "Block the target conversation's customer and close all their open conversations as spam.",
      inputSchema: z.object({
        ...targetShape,
        reason: z.string().trim().min(1).max(500),
      }),
      async execute(input) {
        return deps.blockCustomer(readTarget(input), input.reason);
      },
    }),
    [START_CUSTOMER_CONVERSATION_TOOL_NAME]: tool({
      description:
        "Start a customer conversation from an email the teammate forwarded into this thread, when they want it handled. email and customerMessage must be copied from the forwarded text. It contacts nobody; reply or email afterwards with the new conversationId.",
      inputSchema: z.object({
        email: z.string().trim().regex(EMAIL_PATTERN).max(320),
        name: z.string().trim().min(1).max(100).nullable().optional(),
        customerMessage: z.string().trim().min(1).max(10_000).describe(
          "The customer's own words from the forwarded email, copied exactly.",
        ),
        subject: z.string().trim().min(1).max(200).nullable().optional(),
      }),
      async execute(input) {
        return deps.startCustomerConversation({
          email: input.email,
          name: input.name ?? null,
          customerMessage: input.customerMessage,
          subject: input.subject ?? null,
        });
      },
    }),
  };
  if (deps.decidePendingAction) {
    const decide = deps.decidePendingAction;
    tools[DECIDE_PENDING_ACTION_TOOL_NAME] = tool({
      description:
        "Record the teammate's decision on the action waiting for approval. Only call this after the teammate answered.",
      inputSchema: z.object({
        decision: z.enum(["approve", "reject"]),
      }),
      async execute({ decision }) {
        return decide(decision);
      },
    });
  }
  return tools;
}

export function buildConversationSearchTool(
  search: (input: ConversationSearchInput) => Promise<unknown>,
): ToolSet {
  return {
    [SEARCH_CONVERSATIONS_TOOL_NAME]: tool({
      description:
        "Find customer conversations. Results are ranked: exact email, exact name, partial name or email, then subject or latest message. Text search covers the customer's name and email, the subject, and the latest message, not whole transcripts.",
      inputSchema: z.object({
        text: z.string().trim().max(200).nullable().optional().describe(
          "Words to match. Omit to list by recency.",
        ),
        scope: z.enum(["needs-you", "open", "snoozed", "resolved", "all"])
          .optional()
          .describe("Defaults to open."),
        assignee: z.string().trim().max(100).nullable().optional().describe(
          "me, unassigned, maven, or a teammate id. Omit for anyone.",
        ),
        activeWithinDays: z.number().int().min(1).max(365).nullable().optional(),
        limit: z.number().int().min(1).max(20).optional().describe(
          "Defaults to 5.",
        ),
      }),
      async execute(input) {
        return search({
          text: input.text?.trim() || null,
          scope: input.scope ?? "open",
          assignee: input.assignee?.trim() || null,
          activeWithinDays: input.activeWithinDays ?? null,
          limit: input.limit ?? 5,
        });
      },
    }),
  };
}
