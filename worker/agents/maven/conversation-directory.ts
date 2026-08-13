import type {
  MavenConversationFilter,
  MavenConversationListQuery,
  MavenConversationListResult,
  MavenConversationSort,
  MavenConversationSummary,
  MavenInboxCounts,
  SidechatStatus,
  SidechatSummary,
} from "../../../shared/sidechat-agent";

type SqlBinding = string | number | null;

export interface ConversationDirectorySql {
  execute<T>(query: string, bindings: SqlBinding[]): T[];
}

interface ConversationDirectoryRow {
  conversation_id: string;
  public_child_name: string;
  sidechat_child_name: string | null;
  sidechat_status: string | null;
  customer_id: string | null;
  visitor_id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  telegram_thread_id: string | null;
  status: string;
  close_reason: string | null;
  metadata_json: string;
  priority: string;
  assignee_id: string | null;
  snoozed_until: number | null;
  archived_at: number | null;
  purge_started_at: number | null;
  visitor_last_seen_at: number | null;
  visitor_presence: string;
  visitor_last_online_at: number | null;
  last_message_id: string | null;
  last_message_author: string | null;
  last_message_preview: string | null;
  last_activity_at: number;
  message_count: number;
  bot_message_count: number;
  child_revision: number;
  created_at: number;
  updated_at: number;
}

interface DirectoryCursor {
  primary: number;
  secondary: number;
  conversationId: string;
}

interface SortDefinition {
  primaryExpression: string;
  secondaryExpression: string;
  direction: "ASC" | "DESC";
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapDirectoryRow(row: ConversationDirectoryRow): MavenConversationSummary {
  return {
    conversationId: row.conversation_id,
    publicChildName: row.public_child_name as `pub_${string}`,
    sidechatChildName: row.sidechat_child_name as `sc_${string}` | null,
    sidechatStatus: row.sidechat_status as SidechatStatus | null,
    customerId: row.customer_id,
    visitorId: row.visitor_id,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    telegramThreadId: row.telegram_thread_id,
    status: row.status as MavenConversationSummary["status"],
    closeReason: row.close_reason as MavenConversationSummary["closeReason"],
    metadata: parseMetadata(row.metadata_json),
    priority: row.priority as MavenConversationSummary["priority"],
    assigneeId: row.assignee_id,
    snoozedUntil: row.snoozed_until,
    archivedAt: row.archived_at,
    purgeStartedAt: row.purge_started_at,
    visitorLastSeenAt: row.visitor_last_seen_at,
    visitorPresence: row.visitor_presence as MavenConversationSummary["visitorPresence"],
    visitorLastOnlineAt: row.visitor_last_online_at,
    lastMessageId: row.last_message_id,
    lastMessageAuthor: row.last_message_author as MavenConversationSummary["lastMessageAuthor"],
    lastMessagePreview: row.last_message_preview,
    lastActivityAt: row.last_activity_at,
    messageCount: row.message_count,
    botMessageCount: row.bot_message_count,
    childRevision: row.child_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(cursor: DirectoryCursor): string {
  return btoa(JSON.stringify(cursor))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeCursor(value: string | undefined): DirectoryCursor | null {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.primary !== "number" ||
      !Number.isFinite(cursor.primary) ||
      typeof cursor.secondary !== "number" ||
      !Number.isFinite(cursor.secondary) ||
      typeof cursor.conversationId !== "string" ||
      !cursor.conversationId
    ) {
      return null;
    }
    return {
      primary: cursor.primary,
      secondary: cursor.secondary,
      conversationId: cursor.conversationId,
    };
  } catch {
    return null;
  }
}

function getSortDefinition(sort: MavenConversationSort): SortDefinition {
  switch (sort) {
    case "oldest":
      return {
        primaryExpression: "last_activity_at",
        secondaryExpression: "last_activity_at",
        direction: "ASC",
      };
    case "priority":
      return {
        primaryExpression:
          "CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
        secondaryExpression: "last_activity_at",
        direction: "DESC",
      };
    case "botMessages":
      return {
        primaryExpression: "bot_message_count",
        secondaryExpression: "created_at",
        direction: "DESC",
      };
    case "newest":
      return {
        primaryExpression: "last_activity_at",
        secondaryExpression: "last_activity_at",
        direction: "DESC",
      };
  }
}

function addInboxFilter(
  conditions: string[],
  bindings: SqlBinding[],
  filter: MavenConversationFilter,
  now: number,
): void {
  switch (filter) {
    case "needs-you":
      conditions.push(
        "status = 'waiting_agent'",
        "(snoozed_until IS NULL OR snoozed_until <= ?)",
        "archived_at IS NULL",
      );
      bindings.push(now);
      return;
    case "all":
      conditions.push(
        "(snoozed_until IS NULL OR snoozed_until <= ?)",
        "(close_reason IS NULL OR close_reason != 'spam')",
        "archived_at IS NULL",
      );
      bindings.push(now);
      return;
    case "snoozed":
      conditions.push("snoozed_until > ?", "archived_at IS NULL");
      bindings.push(now);
      return;
    case "resolved":
      conditions.push(
        "status = 'closed'",
        "(close_reason IS NULL OR close_reason != 'spam')",
        "archived_at IS NULL",
      );
      return;
    case "archived":
      conditions.push("archived_at IS NOT NULL");
      return;
    case "flagged":
      conditions.push("close_reason = 'spam'", "archived_at IS NULL");
  }
}

function serializeMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

export class ConversationDirectory {
  constructor(private readonly sql: ConversationDirectorySql) {
    this.ensureSchema();
  }

  listConversations(
    query: MavenConversationListQuery,
  ): MavenConversationListResult {
    const filter = query.filter ?? "all";
    const sort = query.sort ?? "newest";
    const now = query.now ?? Date.now();
    const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
    const conditions: string[] = [];
    const bindings: SqlBinding[] = [];
    addInboxFilter(conditions, bindings, filter, now);

    const search = query.search?.trim().toLowerCase();
    if (search) {
      conditions.push(
        "(LOWER(visitor_name) LIKE ? ESCAPE '\\' OR LOWER(visitor_email) LIKE ? ESCAPE '\\')",
      );
      const escaped = search.replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      bindings.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (query.metadataKey !== undefined && query.metadataValue !== undefined) {
      conditions.push("json_extract(metadata_json, '$.' || ?) = ?");
      bindings.push(query.metadataKey, query.metadataValue);
    }

    const definition = getSortDefinition(sort);
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      const comparator = definition.direction === "DESC" ? "<" : ">";
      conditions.push(
        `(${definition.primaryExpression} ${comparator} ? OR ` +
          `(${definition.primaryExpression} = ? AND ` +
          `(${definition.secondaryExpression} ${comparator} ? OR ` +
          `(${definition.secondaryExpression} = ? AND conversation_id ${comparator} ?))))`,
      );
      bindings.push(
        cursor.primary,
        cursor.primary,
        cursor.secondary,
        cursor.secondary,
        cursor.conversationId,
      );
    }

    const rows = this.sql.execute<ConversationDirectoryRow>(
      `SELECT * FROM conversation_directory
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${definition.primaryExpression} ${definition.direction},
                ${definition.secondaryExpression} ${definition.direction},
                conversation_id ${definition.direction}
       LIMIT ?`,
      [...bindings, limit + 1],
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    const lastSummary = last ? mapDirectoryRow(last) : null;
    const primary = last && lastSummary
      ? sort === "priority"
        ? lastSummary.priority === "high" ? 3 : lastSummary.priority === "medium" ? 2 : 1
        : sort === "botMessages"
          ? lastSummary.botMessageCount
          : lastSummary.lastActivityAt
      : 0;
    const secondary = lastSummary
      ? sort === "botMessages" ? lastSummary.createdAt : lastSummary.lastActivityAt
      : 0;
    return {
      conversations: pageRows.map(mapDirectoryRow),
      nextCursor: hasMore && lastSummary
        ? encodeCursor({
            primary,
            secondary,
            conversationId: lastSummary.conversationId,
          })
        : null,
    };
  }

  getConversation(conversationId: string): MavenConversationSummary | null {
    const rows = this.sql.execute<ConversationDirectoryRow>(
      "SELECT * FROM conversation_directory WHERE conversation_id = ? LIMIT 1",
      [conversationId],
    );
    return rows[0] ? mapDirectoryRow(rows[0]) : null;
  }

  getInboxCounts(now = Date.now()): MavenInboxCounts {
    const counts = {} as MavenInboxCounts;
    for (const filter of [
      "needs-you",
      "all",
      "snoozed",
      "resolved",
      "archived",
      "flagged",
    ] as const) {
      const conditions: string[] = [];
      const bindings: SqlBinding[] = [];
      addInboxFilter(conditions, bindings, filter, now);
      const rows = this.sql.execute<{ count: number }>(
        `SELECT COUNT(*) AS count FROM conversation_directory WHERE ${conditions.join(" AND ")}`,
        bindings,
      );
      counts[filter] = rows[0]?.count ?? 0;
    }
    return counts;
  }

  upsertConversationSummary(summary: MavenConversationSummary): {
    applied: boolean;
    revision: number;
  } {
    const rows = this.sql.execute<{ child_revision: number }>(
      `INSERT INTO conversation_directory (
         conversation_id, public_child_name, sidechat_child_name,
         sidechat_status, customer_id, visitor_id, visitor_name,
         visitor_email, telegram_thread_id, status, close_reason,
         metadata_json, priority, assignee_id, snoozed_until, archived_at,
         purge_started_at, visitor_last_seen_at, visitor_presence,
         visitor_last_online_at, last_message_id, last_message_author,
         last_message_preview, last_activity_at, message_count,
         bot_message_count, child_revision, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?
       )
       ON CONFLICT(conversation_id) DO UPDATE SET
         public_child_name = excluded.public_child_name,
         sidechat_child_name = COALESCE(
           excluded.sidechat_child_name,
           conversation_directory.sidechat_child_name
         ),
         sidechat_status = COALESCE(
           excluded.sidechat_status,
           conversation_directory.sidechat_status
         ),
         customer_id = excluded.customer_id,
         visitor_id = excluded.visitor_id,
         visitor_name = excluded.visitor_name,
         visitor_email = excluded.visitor_email,
         telegram_thread_id = excluded.telegram_thread_id,
         status = excluded.status,
         close_reason = excluded.close_reason,
         metadata_json = excluded.metadata_json,
         priority = excluded.priority,
         assignee_id = excluded.assignee_id,
         snoozed_until = excluded.snoozed_until,
         archived_at = excluded.archived_at,
         purge_started_at = excluded.purge_started_at,
         visitor_last_seen_at = excluded.visitor_last_seen_at,
         visitor_presence = excluded.visitor_presence,
         visitor_last_online_at = excluded.visitor_last_online_at,
         last_message_id = excluded.last_message_id,
         last_message_author = excluded.last_message_author,
         last_message_preview = excluded.last_message_preview,
         last_activity_at = excluded.last_activity_at,
         message_count = excluded.message_count,
         bot_message_count = excluded.bot_message_count,
         child_revision = excluded.child_revision,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at
       WHERE excluded.child_revision > conversation_directory.child_revision
       RETURNING child_revision`,
      [
        summary.conversationId,
        summary.publicChildName,
        summary.sidechatChildName,
        summary.sidechatStatus,
        summary.customerId,
        summary.visitorId,
        summary.visitorName,
        summary.visitorEmail,
        summary.telegramThreadId,
        summary.status,
        summary.closeReason,
        serializeMetadata(summary.metadata),
        summary.priority,
        summary.assigneeId,
        summary.snoozedUntil,
        summary.archivedAt,
        summary.purgeStartedAt,
        summary.visitorLastSeenAt,
        summary.visitorPresence,
        summary.visitorLastOnlineAt,
        summary.lastMessageId,
        summary.lastMessageAuthor,
        summary.lastMessagePreview,
        summary.lastActivityAt,
        summary.messageCount,
        summary.botMessageCount,
        summary.childRevision,
        summary.createdAt,
        summary.updatedAt,
      ],
    );
    if (rows[0]) {
      return { applied: true, revision: rows[0].child_revision };
    }
    return {
      applied: false,
      revision: this.getConversation(summary.conversationId)?.childRevision ?? 0,
    };
  }

  updateSidechatSummary(
    conversationId: string,
    childName: `sc_${string}`,
    status: SidechatStatus,
    updatedAt = Date.now(),
  ): boolean {
    const rows = this.sql.execute<{ conversation_id: string }>(
      `INSERT INTO conversation_directory (
         conversation_id, public_child_name, sidechat_child_name,
         sidechat_status, visitor_id, status, metadata_json, priority,
         visitor_presence, last_activity_at, message_count,
         bot_message_count, child_revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '', 'active', '{}', 'medium', 'active', ?, 0, 0, 0, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         sidechat_child_name = excluded.sidechat_child_name,
         sidechat_status = excluded.sidechat_status,
         updated_at = excluded.updated_at
       RETURNING conversation_id`,
      [
        conversationId,
        `pub_${conversationId}`,
        childName,
        status,
        updatedAt,
        updatedAt,
        updatedAt,
      ],
    );
    return rows.length === 1;
  }

  removeSidechat(conversationId: string): boolean {
    const rows = this.sql.execute<{ conversation_id: string }>(
      `UPDATE conversation_directory
       SET sidechat_child_name = NULL, sidechat_status = NULL,
           updated_at = ?
       WHERE conversation_id = ? AND sidechat_child_name IS NOT NULL
       RETURNING conversation_id`,
      [Date.now(), conversationId],
    );
    return rows.length === 1;
  }

  getSidechatSummaries(): SidechatSummary[] {
    return this.sql.execute<ConversationDirectoryRow>(
      `SELECT * FROM conversation_directory
       WHERE sidechat_child_name IS NOT NULL
       ORDER BY updated_at DESC, conversation_id DESC`,
      [],
    ).map((row) => ({
      conversationId: row.conversation_id,
      childName: row.sidechat_child_name!,
      status: row.sidechat_status as SidechatStatus,
      updatedAt: row.updated_at,
    }));
  }

  findByTelegramThreadId(
    telegramThreadId: string,
  ): MavenConversationSummary | null {
    const rows = this.sql.execute<ConversationDirectoryRow>(
      `SELECT * FROM conversation_directory
       WHERE telegram_thread_id = ? LIMIT 1`,
      [telegramThreadId],
    );
    return rows[0] ? mapDirectoryRow(rows[0]) : null;
  }

  private ensureSchema(): void {
    this.sql.execute(`CREATE TABLE IF NOT EXISTS conversation_directory (
      conversation_id TEXT PRIMARY KEY,
      public_child_name TEXT NOT NULL UNIQUE,
      sidechat_child_name TEXT,
      sidechat_status TEXT,
      customer_id TEXT,
      visitor_id TEXT NOT NULL,
      visitor_name TEXT,
      visitor_email TEXT,
      telegram_thread_id TEXT,
      status TEXT NOT NULL,
      close_reason TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      priority TEXT NOT NULL,
      assignee_id TEXT,
      snoozed_until INTEGER,
      archived_at INTEGER,
      purge_started_at INTEGER,
      visitor_last_seen_at INTEGER,
      visitor_presence TEXT NOT NULL DEFAULT 'active',
      visitor_last_online_at INTEGER,
      last_message_id TEXT,
      last_message_author TEXT,
      last_message_preview TEXT,
      last_activity_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      bot_message_count INTEGER NOT NULL DEFAULT 0,
      child_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`, []);
    for (const statement of [
      "CREATE INDEX IF NOT EXISTS idx_directory_activity ON conversation_directory(last_activity_at DESC, conversation_id DESC)",
      "CREATE INDEX IF NOT EXISTS idx_directory_status_activity ON conversation_directory(status, last_activity_at DESC, conversation_id DESC)",
      "CREATE INDEX IF NOT EXISTS idx_directory_customer_activity ON conversation_directory(customer_id, last_activity_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_directory_visitor_activity ON conversation_directory(visitor_id, last_activity_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_directory_telegram_thread ON conversation_directory(telegram_thread_id)",
      "CREATE INDEX IF NOT EXISTS idx_directory_created ON conversation_directory(created_at DESC, conversation_id DESC)",
    ]) {
      this.sql.execute(statement, []);
    }
  }
}
