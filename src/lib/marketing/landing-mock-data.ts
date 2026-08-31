import type {
  Conversation,
  InboxCounts,
  Message,
} from "@/lib/inbox/types";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function conversation(input: {
  id: string;
  name: string;
  email: string;
  country: string;
  status?: string;
  priority?: Conversation["priority"];
  last: { role: Message["role"]; content: string; senderName?: string; at: string };
  createdAt: string;
}): Conversation {
  return {
    id: input.id,
    customerId: null,
    visitorId: `vis_${input.id}`,
    visitorName: input.name,
    visitorEmail: input.email,
    status: input.status ?? "active",
    closeReason: null,
    priority: input.priority ?? "medium",
    snoozedUntil: null,
    archivedAt: null,
    purgeStartedAt: null,
    assigneeId: null,
    visitorBlocked: false,
    metadata: JSON.stringify({ country: input.country }),
    visitorLastSeenAt: input.last.at,
    visitorPresence: input.id === "marcus" ? "online" : "offline",
    visitorLastOnlineAt: input.last.at,
    createdAt: input.createdAt,
    updatedAt: input.last.at,
    lastActivityAt: input.last.at,
    lastMessage: {
      id: `${input.id}-last`,
      role: input.last.role,
      content: input.last.content,
      senderName: input.last.senderName ?? null,
      emailedAt: null,
      createdAt: input.last.at,
    },
  };
}

function message(
  id: string,
  role: Message["role"],
  content: string,
  at: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    role,
    content,
    senderName:
      extra.senderName ??
      (role === "bot" ? "Maven" : role === "visitor" ? "Marcus Bennett" : extra.senderName),
    createdAt: at,
    ...extra,
  };
}

export const LANDING_INBOX_COUNTS: InboxCounts = {
  "needs-you": 3,
  inbox: 12,
  snoozed: 0,
  resolved: 871,
  archived: 0,
  flagged: 1,
};

export const MARCUS = conversation({
  id: "marcus",
  name: "Marcus Bennett",
  email: "marcus@brightlabs.io",
  country: "US",
  status: "waiting_agent",
  last: {
    role: "visitor",
    content: "I was charged $90 but my plan is $49. Can you check?",
    at: minutesAgo(12),
  },
  createdAt: minutesAgo(80),
});

export const PRIYA = conversation({
  id: "priya",
  name: "Priya Shah",
  email: "priya@oakhouse.co",
  country: "GB",
  last: {
    role: "bot",
    content: "Maven drafted a reply from your docs",
    senderName: "Maven",
    at: minutesAgo(22 * 60),
  },
  createdAt: minutesAgo(26 * 60),
});

export const LUKAS = conversation({
  id: "lukas",
  name: "Lukas Weber",
  email: "lukas@finchpay.de",
  country: "DE",
  last: {
    role: "visitor",
    content: "Can you help me connect a custom domain to my app?",
    at: minutesAgo(26 * 60),
  },
  createdAt: minutesAgo(30 * 60),
});

export const ANNA = conversation({
  id: "anna",
  name: "Anna Lindqvist",
  email: "anna@nordipanel.se",
  country: "SE",
  last: {
    role: "visitor",
    content: "I think I was double-charged on the Pro plan this month.",
    at: minutesAgo(22 * 60),
  },
  createdAt: minutesAgo(24 * 60),
});

export const CAMILLE = conversation({
  id: "camille",
  name: "Camille Laurent",
  email: "camille@belleve.fr",
  country: "FR",
  last: {
    role: "visitor",
    content: "How do I add a second teammate to my workspace?",
    at: minutesAgo(4 * 24 * 60),
  },
  createdAt: minutesAgo(4 * 24 * 60 + 40),
});

export const OWEN = conversation({
  id: "owen",
  name: "Owen Clarke",
  email: "owen@maplestack.ca",
  country: "CA",
  last: {
    role: "bot",
    content: "The widget is live. Hard-refresh the mobile page and try again.",
    senderName: "Maven",
    at: minutesAgo(4 * 24 * 60),
  },
  createdAt: minutesAgo(4 * 24 * 60 + 80),
});

export const DAAN = conversation({
  id: "daan",
  name: "Daan Visser",
  email: "daan@tulipgrid.nl",
  country: "NL",
  last: {
    role: "visitor",
    content: "Is there a way to export all conversations to CSV?",
    at: minutesAgo(5 * 24 * 60),
  },
  createdAt: minutesAgo(5 * 24 * 60 + 20),
});

export const LANDING_INBOX_ROWS: Conversation[] = [
  MARCUS,
  PRIYA,
  LUKAS,
  ANNA,
  CAMILLE,
  OWEN,
  DAAN,
];

export function isLandingUnread(row: Conversation): boolean {
  return row.lastMessage?.role === "visitor";
}

const t0 = minutesAgo(14);
const t1 = minutesAgo(12);
const t2 = minutesAgo(11);
const t3 = minutesAgo(8);
const t4 = minutesAgo(6);
const t5 = minutesAgo(3);

export const MARCUS_VISITOR: Message = message(
  "m1",
  "visitor",
  "I was charged $90 but my plan is $49. Can you check?",
  t0,
);

export const MARCUS_BOT_LOOKUP: Message = message(
  "m2",
  "bot",
  "Found it. You upgraded from Starter to Pro mid-cycle, so this invoice is $49 plus a $41 prorate. Next month is $49. I need a teammate for the refund.",
  t1,
);

export const MARCUS_HANDOFF_PILL: Message = message(
  "m3",
  "system",
  "Flagged for human review",
  t2,
  { sources: JSON.stringify({ systemKind: "review_summary" }), senderName: null },
);

export const MARCUS_ASSIGNED_MAVEN: Message = message(
  "m4",
  "system",
  "Alex assigned Maven",
  t3,
  { sources: JSON.stringify({ systemKind: "assigned" }), senderName: null },
);

export const MARCUS_BOT_REFUND: Message = message(
  "m5",
  "bot",
  "Refund sent. I told Marcus next month is a flat $49.",
  t4,
);

export const MARCUS_REFUND_ASK: Message = message(
  "m6",
  "visitor",
  "Can you refund the $41?",
  t1,
);

export const SIDECHAT_ASK: Message = message(
  "s1",
  "agent",
  "Is this refund allowed on a mid-cycle upgrade?",
  t3,
  { senderName: "Alex" },
);

export const SIDECHAT_ANSWER: Message = {
  id: "s2",
  role: "bot",
  content:
    "Policy allows goodwill under $50 on a first upgrade. Draft is ready for the visitor.",
  senderName: "Maven",
  createdAt: t5,
  sidechatTrace: [
    {
      type: "tool",
      id: "trace-docs",
      toolCallId: "search-1",
      state: "output-available",
      tool: {
        displayName: "Search",
        source: { kind: "http", name: "Docs", icon: null },
        safety: "read",
      },
    },
    {
      type: "tool",
      id: "trace-stripe",
      toolCallId: "stripe-1",
      state: "output-available",
      tool: {
        displayName: "Lookup invoice",
        source: { kind: "http", name: "Stripe", icon: null },
        safety: "read",
      },
    },
  ],
  replyDraft: {
    text: "I issued the $41 refund. Your next invoice is $49.",
    sourceMessageId: "s2",
  },
};

export const PRIYA_THREAD: Message[] = [
  message(
    "p1",
    "visitor",
    "Where do I change the seats on our plan?",
    minutesAgo(23 * 60),
    { senderName: "Priya Shah" },
  ),
  message(
    "p2",
    "bot",
    "Seats live under Billing. I drafted a reply from Invite a teammate.",
    minutesAgo(22 * 60),
  ),
];

export const LUKAS_THREAD: Message[] = [
  message(
    "l1",
    "visitor",
    "Can you help me connect a custom domain to my app?",
    minutesAgo(26 * 60),
    { senderName: "Lukas Weber" },
  ),
];

export const ANNA_THREAD: Message[] = [
  message(
    "a1",
    "visitor",
    "I think I was double-charged on the Pro plan this month.",
    minutesAgo(22 * 60),
    { senderName: "Anna Lindqvist" },
  ),
];

export const CAMILLE_THREAD: Message[] = [
  message(
    "c1",
    "visitor",
    "How do I add a second teammate to my workspace?",
    minutesAgo(4 * 24 * 60),
    { senderName: "Camille Laurent" },
  ),
];

export const OWEN_THREAD: Message[] = [
  message(
    "o1",
    "visitor",
    "The chat widget isn’t loading on mobile. Any ideas?",
    minutesAgo(4 * 24 * 60 + 10),
    { senderName: "Owen Clarke" },
  ),
  message(
    "o2",
    "bot",
    "The widget is live. Hard-refresh the mobile page and try again.",
    minutesAgo(4 * 24 * 60),
  ),
];

export const DAAN_THREAD: Message[] = [
  message(
    "d1",
    "visitor",
    "Is there a way to export all conversations to CSV?",
    minutesAgo(5 * 24 * 60),
    { senderName: "Daan Visser" },
  ),
];

export const THREADS_BY_ID: Record<string, Message[]> = {
  marcus: [MARCUS_VISITOR, MARCUS_BOT_LOOKUP, MARCUS_HANDOFF_PILL],
  priya: PRIYA_THREAD,
  lukas: LUKAS_THREAD,
  anna: ANNA_THREAD,
  camille: CAMILLE_THREAD,
  owen: OWEN_THREAD,
  daan: DAAN_THREAD,
};

export const SUMMON_THREAD: Message[] = [
  MARCUS_VISITOR,
  MARCUS_BOT_LOOKUP,
  MARCUS_HANDOFF_PILL,
];

export const COMMAND_THREAD: Message[] = [
  MARCUS_VISITOR,
  MARCUS_BOT_LOOKUP,
  MARCUS_HANDOFF_PILL,
  MARCUS_ASSIGNED_MAVEN,
  MARCUS_BOT_REFUND,
];

export const PUBLIC_SIDECHAT_THREAD: Message[] = [
  MARCUS_REFUND_ASK,
  message(
    "pub-hold",
    "bot",
    "I have the invoice. A teammate is checking the policy now.",
    t2,
  ),
];

export const MCP_REPLY_THREAD: Message[] = [MARCUS_VISITOR];

export const MCP_REPLY_DRAFT =
  "You upgraded mid-cycle, so this invoice is $49 plus a $41 prorate. Next month is $49.";

export const HELP_ARTICLE_STALE = `# Invite a teammate

Pro includes 5 seats. Invite someone as soon as a seat is free.

Open Workspace settings → Members.`;

export const HELP_ARTICLE_UPDATED = `# Invite a teammate

Pro includes 5 seats. Invite someone as soon as a seat is free.

Open Billing → Seats, then send the invite.`;
