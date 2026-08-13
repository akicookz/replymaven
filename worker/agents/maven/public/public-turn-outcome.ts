import type { InternalToken } from "../../../chat-runtime/streaming/internal-tokens";

type SqlBinding = string | number | null;

export interface PublicTurnOutcomeSql {
  execute<T>(query: string, bindings: SqlBinding[]): T[];
}

export interface PublicTurnOutcome {
  messageId: string;
  ownershipRevision: number;
  internalTokens: InternalToken[];
  httpExecutionIds: string[];
  status: "pending" | "completed";
  humanTakeover: boolean;
  aiInvoked: boolean;
  createdAt: number;
}

export interface BeginPublicTurnOutcome {
  messageId: string;
  ownershipRevision: number;
  aiInvoked: boolean;
  createdAt: number;
}

export interface CompletePublicTurnOutcome {
  messageId: string;
  ownershipRevision: number;
  internalTokens: InternalToken[];
  httpExecutionIds: string[];
  createdAt: number;
}

interface PublicTurnOutcomeRow {
  message_id: string;
  ownership_revision: number;
  internal_tokens_json: string;
  http_execution_ids_json: string;
  status: string;
  human_takeover: number;
  ai_invoked: number;
  created_at: number;
}

function mapOutcome(row: PublicTurnOutcomeRow): PublicTurnOutcome {
  let internalTokens: InternalToken[] = [];
  let httpExecutionIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.internal_tokens_json);
    if (Array.isArray(parsed)) {
      internalTokens = parsed.filter((value): value is InternalToken =>
        value === "[HANDOFF_REQUESTED]" ||
        value === "[RESOLVED]" ||
        value === "[INQUIRY_CREATED]" ||
        value === "[INQUIRY_UPDATED]" ||
        value === "[CONTACT_REQUESTED]"
      );
    }
  } catch {
    internalTokens = [];
  }
  try {
    const parsed: unknown = JSON.parse(row.http_execution_ids_json ?? "[]");
    if (Array.isArray(parsed)) {
      httpExecutionIds = parsed.filter((value): value is string =>
        typeof value === "string" && value.length > 0
      );
    }
  } catch {
    httpExecutionIds = [];
  }
  return {
    messageId: row.message_id,
    ownershipRevision: row.ownership_revision,
    internalTokens,
    httpExecutionIds,
    status: row.status === "pending" ? "pending" : "completed",
    humanTakeover: row.human_takeover === 1,
    aiInvoked: row.ai_invoked === 1,
    createdAt: row.created_at,
  };
}

export class PublicTurnOutcomeStore {
  constructor(private readonly sql: PublicTurnOutcomeSql) {
    this.sql.execute(`CREATE TABLE IF NOT EXISTS public_turn_outcomes (
      message_id TEXT PRIMARY KEY NOT NULL,
      ownership_revision INTEGER NOT NULL,
      internal_tokens_json TEXT NOT NULL,
      http_execution_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'completed',
      human_takeover INTEGER NOT NULL DEFAULT 0,
      ai_invoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`, []);
    const columns = this.sql.execute<{ name: string }>(
      "PRAGMA table_info(public_turn_outcomes)",
      [],
    );
    if (!columns.some((column) => column.name === "status")) {
      this.sql.execute(
        "ALTER TABLE public_turn_outcomes ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'",
        [],
      );
    }
    if (!columns.some((column) => column.name === "http_execution_ids_json")) {
      this.sql.execute(
        "ALTER TABLE public_turn_outcomes ADD COLUMN http_execution_ids_json TEXT NOT NULL DEFAULT '[]'",
        [],
      );
    }
    if (!columns.some((column) => column.name === "human_takeover")) {
      this.sql.execute(
        "ALTER TABLE public_turn_outcomes ADD COLUMN human_takeover INTEGER NOT NULL DEFAULT 0",
        [],
      );
    }
    if (!columns.some((column) => column.name === "ai_invoked")) {
      this.sql.execute(
        "ALTER TABLE public_turn_outcomes ADD COLUMN ai_invoked INTEGER NOT NULL DEFAULT 0",
        [],
      );
    }
  }

  begin(outcome: BeginPublicTurnOutcome): void {
    this.sql.execute(
      `INSERT INTO public_turn_outcomes (
         message_id, ownership_revision, internal_tokens_json, status,
         http_execution_ids_json, human_takeover, ai_invoked, created_at
       ) VALUES (?, ?, '[]', 'pending', '[]', 0, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         ownership_revision = excluded.ownership_revision,
         internal_tokens_json = '[]',
         http_execution_ids_json = '[]',
         status = 'pending',
         human_takeover = 0,
         ai_invoked = excluded.ai_invoked,
         created_at = excluded.created_at`,
      [
        outcome.messageId,
        outcome.ownershipRevision,
        outcome.aiInvoked ? 1 : 0,
        outcome.createdAt,
      ],
    );
  }

  complete(outcome: CompletePublicTurnOutcome): void {
    this.sql.execute(
      `INSERT INTO public_turn_outcomes (
         message_id, ownership_revision, internal_tokens_json, status,
         http_execution_ids_json, human_takeover, ai_invoked, created_at
       ) VALUES (?, ?, ?, 'completed', ?, 0, 0, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         ownership_revision = excluded.ownership_revision,
         internal_tokens_json = excluded.internal_tokens_json,
         http_execution_ids_json = excluded.http_execution_ids_json,
         status = 'completed'`,
      [
        outcome.messageId,
        outcome.ownershipRevision,
        JSON.stringify(outcome.internalTokens),
        JSON.stringify(outcome.httpExecutionIds),
        outcome.createdAt,
      ],
    );
  }

  markPendingHumanTakeover(): string[] {
    return this.sql.execute<{ message_id: string }>(
      `UPDATE public_turn_outcomes
       SET human_takeover = 1
       WHERE status = 'pending'
       RETURNING message_id`,
      [],
    ).map((row) => row.message_id);
  }

  get(messageId: string): PublicTurnOutcome | null {
    const rows = this.sql.execute<PublicTurnOutcomeRow>(
      "SELECT * FROM public_turn_outcomes WHERE message_id = ? LIMIT 1",
      [messageId],
    );
    return rows[0] ? mapOutcome(rows[0]) : null;
  }

  take(messageId: string): PublicTurnOutcome | null {
    const outcome = this.get(messageId);
    if (!outcome) return null;
    this.sql.execute(
      "DELETE FROM public_turn_outcomes WHERE message_id = ?",
      [messageId],
    );
    return outcome;
  }
}
