import { tool, type ToolSet } from "ai";
import { z } from "zod";

// Sidechat tools that act on the public conversation. Each execute calls the
// parent agent, which reuses the same functions as the dashboard routes.

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
  | { error: "conversation_unavailable" };

export type SidechatEmailResult =
  | { emailed: true; to: string; messageId: string }
  | { blocked: "assigned_to"; assigneeName: string }
  | { blocked: "unknown_author" }
  | {
    error:
      | "no_email"
      | "conversation_unavailable"
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
      | "conversation_unavailable"
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
        // Plain pattern: .email() emits a lookaround regex OpenAI rejects.
        email: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).max(320)
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
